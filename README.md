# GitHub Action for Dispatching Workflows

This action triggers another GitHub Actions workflow, using the `workflow_dispatch` event.  
The workflow must be configured for this event type e.g. `on: [workflow_dispatch]`

This allows you to chain workflows, the classic use case is have a CI build workflow, trigger a CD release/deploy workflow when it completes. Allowing you to maintain separate workflows for CI and CD, and pass data between them as required.

For details of the `workflow_dispatch` even see [this blog post introducing this type of trigger](https://github.blog/changelog/2020-07-06-github-actions-manual-triggers-with-workflow_dispatch/)

*Note 1.* The GitHub UI will report flows triggered by this action as "manually triggered" even though they have been run programmatically via another workflow and the API

*Note 2.* If you want to reference the target workflow by ID, you will need to list them with the following REST API call `curl https://api.github.com/repos/{{owner}}/{{repo}}/actions/workflows -H "Authorization: token {{pat-token}}"`

## Inputs
### `workflow`
**Required.** The name, filename or ID of the workflow to be triggered and run. All three possibilities are used when looking for the workflow. e.g.

```yaml
workflow: My Workflow
# or
workflow: my-workflow.yaml
# or
workflow: 1218419
```

### `inputs`
**Optional.** The inputs to pass to the workflow (if any are configured), this must be a JSON encoded string, e.g. `{ "myInput": "foobar" }`

### `ref`
**Optional.** The Git reference used with the triggered workflow run. The reference can be a branch, tag, or a commit SHA. If omitted the context ref of the triggering workflow is used. If you want to trigger on pull requests and run the target workflow in the context of the pull request branch, set the ref to `${{ github.event.pull_request.head.ref }}`

### `repo`
**Optional.** The default behavior is to trigger workflows in the same repo as the triggering workflow, if you wish to trigger in another GitHub repo "externally", then provide the owner + repo name with slash between them e.g. `microsoft/vscode`

### `token`
**Optional.** By default the standard `github.token` will be used and you no longer need to provide your own token here. It is left for backwards compatibility only, or in the rare case you want to provide your own token.


## Outputs
This Action emits a single output named `workflowId`.


## Example usage
```yaml
- name: Invoke workflow without inputs
  uses: benc-uk/workflow-dispatch@v1
  with:
    workflow: My Workflow
```

```yaml
- name: Invoke workflow with inputs
  uses: benc-uk/workflow-dispatch@v1
  with:
    workflow: Another Workflow
    inputs: '{ "message": "blah blah", "something": true }'
```

```yaml
- name: Invoke workflow in another repo with inputs
  uses: benc-uk/workflow-dispatch@v1
  with:
    workflow: my-workflow.yaml
    repo: benc-uk/example
    inputs: '{ "message": "blah blah", "something": false }'
```
