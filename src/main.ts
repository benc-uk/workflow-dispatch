// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020-2026
// Licensed under the MIT License.
//
// Workflow Dispatch Action - Main task code
// ----------------------------------------------------------------------------

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as PackageJSON from '../package.json'

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
  let dispatchReqInFlightTo: string | undefined
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
        throw new Error(`🤯 Failed to parse 'inputs' JSON string: ${e instanceof Error ? e.message : String(e)}`, {
          cause: e,
        })
      }
    }

    // Get octokit client for making API calls
    const octokit = github.getOctokit(token)

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

    if (!foundWorkflow) throw new Error(`😥 Unable to find workflow '${workflowRef}' in ${owner}/${repo}`)

    core.info(`🔎 Found workflow, id: ${foundWorkflow.id}, name: ${foundWorkflow.name}, path: ${foundWorkflow.path}`)

    // Call workflow_dispatch API
    //
    // Retain where the dispatch request is going to in order for the exception
    // handler to distinguish a failed dispatch from a failure of a later step
    core.info('🚀 Calling GitHub API to dispatch workflow...')
    dispatchReqInFlightTo = `'${foundWorkflow.path}' (id: ${foundWorkflow.id}) in '${owner}/${repo}' on ref '${ref}'`
    const dispatchResp = await octokit.request(
      `POST /repos/${owner}/${repo}/actions/workflows/${foundWorkflow.id}/dispatches`,
      {
        ref: ref,
        inputs: inputs,
        return_run_details: true,
        headers: { 'x-github-api-version': API_VERSION },
      },
    )
    dispatchReqInFlightTo = undefined

    core.info(`🏆 API response status: ${dispatchResp.status}`)
    core.info(`🌐 Run URL: ${dispatchResp.data.html_url}`)

    // Handle wait for completion
    const waitForCompletion = core.getInput('wait-for-completion') === 'true'
    const syncStatus = core.getInput('sync-status') === 'true'
    const timeoutSeconds = parseInt(core.getInput('wait-timeout-seconds') || '900', 10) // Default to 15 minutes
    const waitIntervalSeconds = parseInt(core.getInput('wait-interval-seconds') || '5', 10) // Default to 5 seconds
    let runStatus = 'in_progress'

    // Polling loop to check workflow run status until it completes or times out
    if (waitForCompletion) {
      core.info(`⏳ Waiting for workflow run to complete with a timeout of ${timeoutSeconds} seconds...`)
      const startTime = Date.now()
      while (
        runStatus === 'in_progress' ||
        runStatus === 'queued' ||
        runStatus === 'waiting' ||
        runStatus === 'pending'
      ) {
        if ((Date.now() - startTime) / 1000 > timeoutSeconds) {
          core.warning(
            `⚠️ Workflow run did not complete within ${timeoutSeconds} seconds, timing out.\n` +
              `Note: The workflow is still running but we have stopped waiting. You can check the run status here: ${dispatchResp.data.html_url}`,
          )
          runStatus = 'timed_out'
          break
        }

        await new Promise((resolve) => setTimeout(resolve, waitIntervalSeconds * 1000)) // Wait for waitIntervalSeconds before polling again

        const { data: runData } = await octokit.request(
          `GET /repos/${owner}/${repo}/actions/runs/${dispatchResp.data.workflow_run_id}`,
          {
            headers: { 'x-github-api-version': API_VERSION },
          },
        )
        runStatus = runData.status
        core.info(`🔄 Current run status: ${runStatus}`)
      }

      if (runStatus === 'completed') {
        core.info('✅ Workflow run completed, the final status can be found in the workflow run details.')
      } else if (runStatus === 'timed_out') {
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
        core.setFailed(`🤯 Workflow run failed. Check the run details here: ${dispatchResp.data.html_url}`)
      } else if (conclusion === 'cancelled') {
        core.setFailed(`🗑️ Workflow run was cancelled. Check the run details here: ${dispatchResp.data.html_url}`)
      } else {
        core.info(`🎉 Workflow conclusion: ${conclusion}`)
      }
    }
  } catch (error) {
    // Anything could have been caught here, including errors without a message and non-Error values
    const e = (error ?? {}) as {
      message?: unknown
      status?: unknown
      request?: { method?: unknown; url?: unknown }
      response?: { headers?: Record<string, unknown> }
    }
    const message = (typeof error === 'string' ? error : typeof e.message === 'string' ? e.message : '').trim()

    if (message.endsWith('a disabled workflow')) {
      core.warning('🚫 Workflow is disabled, no action was taken')
      return
    }

    // Octokit builds an error message from the response body, which is empty for many 5xx responses,
    // and empty 'error' messages are not retained in the logs; name the failure based on HTTP status as well
    //
    // The body is collapsed to one line and cut to a limit, as GitHub error pages can be several KiB of HTML
    const oneLine = message.replace(/\s+/g, ' ')
    const detail = oneLine.length > 512 ? `${oneLine.slice(0, 512)}…` : oneLine
    const status = typeof e.status === 'number' && e.status > 0 ? e.status : undefined
    let err: string
    if (status === undefined) {
      err =
        detail ||
        (error instanceof Error ? `❌ ${error.name} without a message` : '⁉️ Unknown error (no error message)') // Not an HTTP error, just a plain Error, or any other thrown non-Error value
    } else {
      // Octokit reports a network failure (no response at all) as status 500 without a response object
      err = status === 500 && !e.response ? '📡 Network error (no response)' : `🚨 HTTP ${status}`
      if (typeof e.request?.method === 'string' && typeof e.request?.url === 'string') {
        err += ` from '${e.request.method} ${e.request.url}'`
      }
      err += `: ${detail || '(response body remained empty)'}`
    }

    if (dispatchReqInFlightTo) {
      err = `💥 Failed to dispatch workflow ${dispatchReqInFlightTo}: ${err}`
      if (status === undefined || status >= 500) {
        // A server error or network failure does not tell whether GitHub processed the request!
        err +=
          '.\n' +
          'This was a server or network error, so GitHub may still have created the workflow run.\n' +
          'Check the run history of the workflow before dispatching again!'
      }
    }

    core.setFailed(err)
  }
}

// =============================================================================
// Call the main task run function
// =============================================================================
run()
