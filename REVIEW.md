# GitHub Action Best Practices Review

## Critical Issues

### 1. `console.log` mixed with `core.info`

**File:** `src/main.ts` (lines 73, 76)

Two calls use `console.log` instead of `core.info`. Actions should consistently use `@actions/core` logging so output respects log levels, grouping, and runner formatting.

### 2. Completed run doesn't check `conclusion`

**File:** `src/main.ts` (lines 107–111)

When `runStatus === 'completed'`, the code assumes success. A completed run can have conclusion `failure`, `cancelled`, `timed_out`, etc. The action should inspect `conclusion` and call `core.setFailed()` on failure.

### 3. Spurious parameters passed to `listRepoWorkflows`

**File:** `src/main.ts` (lines 48–53)

`ref` and `inputs` are passed to `listRepoWorkflows.endpoint.merge()`, but the [List repository workflows](https://docs.github.com/en/rest/actions/workflows#list-repository-workflows) API doesn't accept these parameters. They're silently ignored but the code is misleading.

### 4. esbuild target doesn't match runtime

**Files:** `package.json` (line 10), `action.yaml` (line 37)

Build targets `node22` but `action.yaml` declares `runs.using: node24`. The esbuild target should match to enable all available language features.

## Moderate Issues

### 5. No input validation on `inputs` JSON

**File:** `src/main.ts` (lines 38–41)

`JSON.parse(inputsJson)` throws a generic `SyntaxError` on bad input. Wrapping this in a targeted try/catch with a clear message (e.g. "The 'inputs' parameter is not valid JSON") would improve the user experience.

### 6. No validation on `repo` format

**File:** `src/main.ts` (lines 31–33)

If a user provides `repo: "not-a-slash-separated-value"`, the destructure `const [owner, repo] = ...split('/')` silently sets `repo` to `undefined`. A format check would prevent confusing downstream API errors.

### 7. Timeout path produces misleading message

**File:** `src/main.ts` (lines 107–111)

After a timeout `break`, the code falls through to log `"Workflow run completed with status: in_progress"` — but the run didn't complete; we stopped waiting. The post-loop check should distinguish timeout from actual completion.

### 8. Error type assertion

**File:** `src/main.ts` (line 115)

`error as Error` is a type assertion without a runtime check. If something non-Error is thrown, `e.message` would be `undefined`. Prefer:

```ts
const message = error instanceof Error ? error.message : String(error)
```

### 9. Fragile disabled-workflow detection

**File:** `src/main.ts` (lines 117–119)

`e.message.endsWith('a disabled workflow')` will break if GitHub changes the error message text. Checking the API response status code (409 Conflict) would be more robust.

## Minor / Stylistic

### 10. Quote boolean defaults in `action.yaml`

**File:** `action.yaml` (line 22)

`default: false` is parsed as YAML boolean `false`, then coerced to string `"false"` by the runner. Quoting it as `default: 'false'` makes the intent explicit and avoids YAML-type ambiguity.

### 11. No `package-lock.json` committed

CI runs `npm ci`, which requires a lockfile. If the lockfile exists but is gitignored, CI will fail. Ensure `package-lock.json` is committed to the repository.

### 12. Actions not pinned to SHA in CI

**File:** `.github/workflows/build-test.yaml` (lines 19, 23)

`actions/checkout@v6` and `actions/setup-node@v6` use tag references. GitHub's security hardening guide recommends pinning to full commit SHAs to prevent supply-chain attacks on mutable tags.

### 13. Hardcoded workflow ID in tests

**File:** `.github/workflows/build-test.yaml` (line 46)

`workflow: '1854247'` is brittle — if the echo workflow is ever recreated, this test breaks silently or confusingly.

### 14. No Dependabot / Renovate config

No `.github/dependabot.yml` for automated dependency updates. This is a recommended practice especially for actions that bundle their dependencies.

## Summary

| Severity | Count | Key themes                                                                             |
| -------- | ----- | -------------------------------------------------------------------------------------- |
| Critical | 4     | Logging consistency, missing conclusion check, wrong build target, spurious API params |
| Moderate | 5     | Input validation, error handling robustness                                            |
| Minor    | 5     | YAML hygiene, CI hardening, dependency management                                      |

The action's overall structure is sound — single-file design, proper bundling, `core.setFailed()` usage, and pagination support are all good. The most impactful fix would be checking `conclusion` on completed runs (#2), as the action currently reports success even when the dispatched workflow fails.
