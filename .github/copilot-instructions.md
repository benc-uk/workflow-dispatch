# Copilot Instructions — workflow-dispatch

## Project Overview

This is a **GitHub Action** written in TypeScript that triggers other GitHub Actions workflows via the `workflow_dispatch` API event. It allows chaining workflows (e.g., CI triggers CD). The entire action logic lives in a single file: `src/main.ts`.

## Architecture

- **Single-file action**: All logic is in `src/main.ts` — there are no services, modules, or abstractions. The `run()` async function is the entry point.
- **Action definition**: `action.yaml` declares inputs/outputs and sets `runs.using: node24` with `dist/index.js` as the entry point.
- **Bundled output**: `dist/index.js` is a self-contained esbuild bundle checked into the repo. It **must** be rebuilt and committed after any code change.
- **No test framework**: There are no unit tests. Validation happens via CI workflows (`.github/workflows/build-test.yaml`) that invoke the action against echo workflows in the same repo.

## Build & Development

```bash
npm ci                # Install dependencies
npm run build         # Bundle with esbuild → dist/index.js
npm run lint          # ESLint + Prettier check
npm run lint-fix      # Auto-fix ESLint issues
npm run format        # Auto-format with Prettier
```

- Build uses **esbuild** (not tsc): `esbuild src/main.ts --bundle --platform=node --target=node22 --outfile=dist/index.js`
- TypeScript is configured with `moduleResolution: "bundler"` and `module: "ESNext"` — designed for esbuild, not direct Node execution.
- `dist/index.js` must be rebuilt and committed with every change to `src/` or `package.json` — CI will fail otherwise since the action runs the bundle directly.

## Code Patterns & Conventions

- **GitHub Actions SDK**: Uses `@actions/core` for inputs/outputs/logging and `@actions/github` for the Octokit client. Inputs are read via `core.getInput()`, outputs set via `core.setOutput()`.
- **Workflow lookup**: Workflows are resolved by name, numeric ID, or filename path — see the `workflows.find()` logic in `src/main.ts`.
- **Error handling**: Top-level try/catch in `run()` calls `core.setFailed()`. Special case: disabled workflows produce a warning instead of failure.
- **No classes or DI**: Plain functions and local variables only. Keep it simple.
- **Emoji logging**: Console output uses emoji prefixes (🏃, 🔎, 🚀, 🏆, ⏳, etc.) for readability in Actions logs.
- **Package version**: Imported from `package.json` via `resolveJsonModule` and logged at startup.

## Key Files

| File                                | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `src/main.ts`                       | All action logic — API calls, input handling, polling         |
| `action.yaml`                       | Action metadata: inputs, outputs, branding, runtime           |
| `dist/index.js`                     | Bundled output, committed to repo, executed by Actions runner |
| `package.json`                      | Scripts, version, devDependencies only (no runtime deps)      |
| `.github/workflows/build-test.yaml` | CI: lint, build, integration test against echo workflows      |

## Important Details

- All dependencies are **devDependencies** — they're bundled into `dist/index.js` at build time, not installed at runtime.
- The action supports **cross-repo dispatch** (via `repo` and `token` inputs) and **wait-for-completion** polling with configurable timeout.
- Action inputs/outputs must stay in sync between `action.yaml` and the `core.getInput()`/`core.setOutput()` calls in `src/main.ts`.
- ESLint uses flat config (`eslint.config.mjs`) with `typescript-eslint` strict preset.
