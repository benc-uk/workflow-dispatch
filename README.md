# GitHub Action for Dispatching Workflows

This action triggers another GitHub Actions workflow, using the `workflow_dispatch` event.  
The workflow must be configured for this event type e.g. `on: [workflow_dispatch]`

This allows you to chain workflows, the classic use case is have a CI build workflow, trigger a CD release/deploy workflow when it completes. Allowing you to maintain separate workflows for CI and CD, and pass data between them as required.

For details of the `workflow_dispatch` even see [this blog post introducing this type of trigger](https://github.blog/changelog/2020-07-06-github-actions-manual-triggers-with-workflow_dispatch/)

*Note 1.* The GitHub UI will report flows triggered by this action as "manually triggered" even though they have been run programmatically via another workflow and the API

*Note 2.* If you want to reference the target workflow by ID, you will need to list them with the following REST API call `curl https://api.github.com/repos/{{owner}}/{{repo}}/actions/workflows -H "Authorization: token {{pat-token}}"`

## Inputs
### `workflow`
**Required.** The name or ID of the workflow to trigger and run. This is the name declared in the YAML, not the filename

### `token`

**Required.** A GitHub access token (PAT) with write access to the repo in question. **NOTE.** The automatically provided token e.g. `${{ secrets.GITHUB_TOKEN }}` may need explicit workflow permissions in order to trigger `workflow_dispatch` and `repository_dispatch` events. [More here.](https://github.blog/changelog/2022-09-08-github-actions-use-github_token-with-workflow_dispatch-and-repository_dispatch/).

```yaml
permissions:
      actions: write
```      

Another solution is to manually create a PAT and store it as a secret e.g. `${{ secrets.PERSONAL_TOKEN }}`

### `inputs`
**Optional.** The inputs to pass to the workflow (if any are configured), this must be a JSON encoded string, e.g. `{ "myInput": "foobar" }`

### `ref`
**Optional.** The Git reference used with the triggered workflow run. The reference can be a branch, tag, or a commit SHA. If omitted the context ref of the triggering workflow is used. If you want to trigger on pull requests and run the target workflow in the context of the pull request branch, set the ref to `${{ github.event.pull_request.head.ref }}`

### `repo`
**Optional.** The default behavior is to trigger workflows in the same repo as the triggering workflow, if you wish to trigger in another GitHub repo "externally", then provide the owner + repo name with slash between them e.g. `microsoft/vscode`


## Outputs
None


## Example usage
```yaml
- name: Invoke workflow without inputs
  uses: benc-uk/workflow-dispatch@v1
  with:
    workflow: My Workflow
    token: ${{ secrets.PERSONAL_TOKEN }}
```

```yaml
- name: Invoke workflow with inputs
  uses: benc-uk/workflow-dispatch@v1
  with:
    workflow: Another Workflow
    token: ${{ secrets.PERSONAL_TOKEN }}
    inputs: '{ "message": "blah blah", "debug": true }'
```

```yaml
- name: Invoke workflow in another repo with inputs
  uses: benc-uk/workflow-dispatch@v1
  with:
    workflow: Some Workflow
    repo: benc-uk/example
    token: ${{ secrets.PERSONAL_TOKEN }}
    inputs: '{ "message": "blah blah", "debug": true }'
```
