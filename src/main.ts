// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020-2026
// Licensed under the MIT License.
//
// Workflow Dispatch Action - Main task code
// ----------------------------------------------------------------------------

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as PackageJSON from '../package.json'
import { createOctokit, NO_RETRY_REQUEST_OPTIONS } from './octokit-client.ts'
import { TIMED_OUT, waitForRunCompletion } from './wait-for-run.ts'

const API_VERSION = '2026-03-10' // Latest API version as of March 2026, update as needed

type Workflow = {
  id: number
  name: string
  path: string
}

// =============================================================================
// Main task function (async wrapper)
// =============================================================================
async function run(): Promise<void> {
  core.info(`🏃 Workflow Dispatch Action v${PackageJSON.version}`)
  try {
    // Required inputs
    const workflowRef = core.getInput('workflow')

    // Optional inputs, with defaults
    const token = core.getInput('token')
    const ref = core.getInput('ref')
    const [owner, repo] = core.getInput('repo')
      ? core.getInput('repo').split('/')
      : [github.context.repo.owner, github.context.repo.repo]

    // Decode inputs, this MUST be a valid JSON string
    let inputs = {}
    const inputsJson = core.getInput('inputs')
    if (inputsJson) {
      try {
        inputs = JSON.parse(inputsJson)
      } catch (e) {
        throw new Error(`Failed to parse 'inputs' JSON string: ${e instanceof Error ? e.message : String(e)}`, {
          cause: e,
        })
      }
    }

    // Get octokit client for making API calls (with retry + throttling plugins)
    const octokit = createOctokit(token)

    // List workflows via API, and handle paginated results
    const workflows: Workflow[] = await octokit.paginate(
      octokit.rest.actions.listRepoWorkflows.endpoint.merge({
        owner,
        repo,
      }),
    )

    // Debug response if ACTIONS_STEP_DEBUG is enabled
    core.debug('### START List Workflows response data')
    core.debug(JSON.stringify(workflows, null, 3))
    core.debug('### END:  List Workflows response data')

    // Locate workflow either by name, id or filename
    const foundWorkflow = workflows.find((workflow) => {
      return (
        workflow.name === workflowRef ||
        workflow.id.toString() === workflowRef ||
        workflow.path.endsWith(`/${workflowRef}`) || // Add a leading / to avoid matching workflow with same suffix
        workflow.path == workflowRef
      ) // Or it stays in top level directory
    })

    if (!foundWorkflow) throw new Error(`Unable to find workflow '${workflowRef}' in ${owner}/${repo} 😥`)

    core.info(`🔎 Found workflow, id: ${foundWorkflow.id}, name: ${foundWorkflow.name}, path: ${foundWorkflow.path}`)

    // Call workflow_dispatch API, never retried on server errors as that could trigger a duplicate run
    core.info('🚀 Calling GitHub API to dispatch workflow...')
    const dispatchResp = await octokit.request(
      `POST /repos/${owner}/${repo}/actions/workflows/${foundWorkflow.id}/dispatches`,
      {
        ref: ref,
        inputs: inputs,
        return_run_details: true,
        headers: { 'x-github-api-version': API_VERSION },
        request: NO_RETRY_REQUEST_OPTIONS,
      },
    )

    core.info(`🏆 API response status: ${dispatchResp.status}`)
    core.info(`🌐 Run URL: ${dispatchResp.data.html_url}`)

    // Handle wait for completion
    const waitForCompletion = core.getInput('wait-for-completion') === 'true'
    const syncStatus = core.getInput('sync-status') === 'true'
    const timeoutSeconds = parseInt(core.getInput('wait-timeout-seconds') || '900', 10) // Default to 15 minutes
    const waitIntervalSeconds = parseInt(core.getInput('wait-interval-seconds') || '5', 10) // Default to 5 seconds

    // Poll the workflow run status until it completes or times out
    if (waitForCompletion) {
      core.info(`⏳ Waiting for workflow run to complete with a timeout of ${timeoutSeconds} seconds...`)
      const runStatus = await waitForRunCompletion({
        getStatus: async () => {
          const { data: runData } = await octokit.request(
            `GET /repos/${owner}/${repo}/actions/runs/${dispatchResp.data.workflow_run_id}`,
            {
              headers: { 'x-github-api-version': API_VERSION },
            },
          )
          return runData.status
        },
        timeoutSeconds,
        intervalSeconds: waitIntervalSeconds,
      })

      if (runStatus === 'completed') {
        core.info('✅ Workflow run completed, the final status can be found in the workflow run details.')
      } else if (runStatus === TIMED_OUT) {
        core.warning(
          `⚠️ Workflow run did not complete within ${timeoutSeconds} seconds, timing out.\nNote: The workflow is still running but we have stopped waiting. You can check the run status here: ${dispatchResp.data.html_url}`,
        )
        core.warning(`⚠️ Workflow run did not complete within the timeout period.`)
      } else {
        core.warning(`⚠️ Workflow run completed with status: ${runStatus}`)
      }
    }

    core.setOutput('runId', dispatchResp.data.workflow_run_id)
    core.setOutput('runUrl', dispatchResp.data.run_url)
    core.setOutput('runUrlHtml', dispatchResp.data.html_url)
    core.setOutput('workflowId', foundWorkflow.id)

    // Sync the status of this action with the triggered workflow run if requested
    if (syncStatus && waitForCompletion) {
      // Get the final conclusion of the workflow run if we were waiting for completion
      const { data: finalRunData } = await octokit.request(
        `GET /repos/${owner}/${repo}/actions/runs/${dispatchResp.data.workflow_run_id}`,
        {
          headers: { 'x-github-api-version': API_VERSION },
        },
      )
      const conclusion = finalRunData.conclusion

      // Set this action to failed if the triggered workflow run failed or was cancelled
      if (conclusion === 'failure') {
        core.setFailed(`Workflow run failed. Check the run details here: ${dispatchResp.data.html_url}`)
      } else if (conclusion === 'cancelled') {
        core.setFailed(`Workflow run was cancelled. Check the run details here: ${dispatchResp.data.html_url}`)
      } else {
        core.info(`🎉 Workflow conclusion: ${conclusion}`)
      }
    }
  } catch (error) {
    const e = error as Error

    if (e.message.endsWith('a disabled workflow')) {
      core.warning('Workflow is disabled, no action was taken')
      return
    }

    core.setFailed(e.message)
  }
}

// =============================================================================
// Call the main task run function
// =============================================================================
run()
