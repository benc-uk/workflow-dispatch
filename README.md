# Workflow Dispatch Action

This action triggers another GitHub Actions workflow, via the `workflow_dispatch` event

## Inputs

### `workflow-id`

**Required** The id of thw workflow to trgger and run.

## Outputs

### `time`

The time we greeted you.

## Example usage

uses: actions/hello-world-javascript-action@v1
with:
  who-to-greet: 'Mona the Octocat'