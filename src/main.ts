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

// Workflow run statuses that are considered still active/not yet finished
const ACTIVE_RUN_STATUSES = ['in_progress', 'queued', 'waiting', 'pending']

type Workflow = {
  id: number
  name: string
  path: string
}

// =============================================================================
// When a run is cancelled while pending/queued, it may have been superseded by a newer
// run in the same concurrency group (e.g. a higher priority dispatch on the same branch).
// GitHub's API has no direct link between the two, so we infer it: the newest still-active
// run for the same workflow + branch, created at or after the cancelled run.
// =============================================================================
async function findSupersedingRun(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  workflowId: number,
  cancelledRun: { id: number; head_branch: string; created_at: string },
) {
  const { data } = await octokit.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflowId,
    branch: cancelledRun.head_branch,
    per_page: 20,
    headers: { 'x-github-api-version': API_VERSION },
  })

  const candidates = data.workflow_runs
    .filter(
      (candidateRun) =>
        candidateRun.id !== cancelledRun.id &&
        new Date(candidateRun.created_at).getTime() >= new Date(cancelledRun.created_at).getTime() &&
        ACTIVE_RUN_STATUSES.includes(candidateRun.status ?? ''),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return candidates[0]
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
        core.error(`Failed to parse 'inputs' JSON string: ${e instanceof Error ? e.message : String(e)}`)
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

    if (!foundWorkflow) throw new Error(`Unable to find workflow '${workflowRef}' in ${owner}/${repo} 😥`)

    core.info(`🔎 Found workflow, id: ${foundWorkflow.id}, name: ${foundWorkflow.name}, path: ${foundWorkflow.path}`)

    // Call workflow_dispatch API
    core.info('🚀 Calling GitHub API to dispatch workflow...')
    const dispatchResp = await octokit.request(
      `POST /repos/${owner}/${repo}/actions/workflows/${foundWorkflow.id}/dispatches`,
      {
        ref: ref,
        inputs: inputs,
        return_run_details: true,
        headers: { 'x-github-api-version': API_VERSION },
      },
    )

    core.info(`🏆 API response status: ${dispatchResp.status}`)
    core.info(`🌐 Run URL: ${dispatchResp.data.html_url}`)

    // Handle wait for completion
    const waitForCompletion = core.getInput('wait-for-completion') === 'true'
    const syncStatus = core.getInput('sync-status') === 'true'
    const propagatePendingWait = core.getInput('propagate-pending-wait') === 'true'
    const timeoutSeconds = parseInt(core.getInput('wait-timeout-seconds') || '900', 10) // Default to 15 minutes
    const waitIntervalSeconds = parseInt(core.getInput('wait-interval-seconds') || '5', 10) // Default to 5 seconds
    let runStatus = 'in_progress'
    let currentRunId = dispatchResp.data.workflow_run_id
    let currentRunUrl = dispatchResp.data.run_url
    let currentRunHtmlUrl = dispatchResp.data.html_url

    // Polling loop to check workflow run status until it completes or times out
    if (waitForCompletion) {
      core.info(`⏳ Waiting for workflow run to complete with a timeout of ${timeoutSeconds} seconds...`)
      const startTime = Date.now()
      while (ACTIVE_RUN_STATUSES.includes(runStatus)) {
        if ((Date.now() - startTime) / 1000 > timeoutSeconds) {
          core.warning(
            `⚠️ Workflow run did not complete within ${timeoutSeconds} seconds, timing out.\nNote: The workflow is still running but we have stopped waiting. You can check the run status here: ${currentRunHtmlUrl}`,
          )
          runStatus = 'timed_out'
          break
        }

        await new Promise((resolve) => setTimeout(resolve, waitIntervalSeconds * 1000)) // Wait for waitIntervalSeconds before polling again

        const { data: runData } = await octokit.request(`GET /repos/${owner}/${repo}/actions/runs/${currentRunId}`, {
          headers: { 'x-github-api-version': API_VERSION },
        })
        runStatus = runData.status
        core.info(`🔄 Current run status: ${runStatus}`)

        // If the run was cancelled while still pending/queued, check whether a newer run in the
        // same concurrency group superseded it, and if so switch to waiting on that run instead.
        if (propagatePendingWait && runStatus === 'completed' && runData.conclusion === 'cancelled') {
          const supersedingRun = await findSupersedingRun(octokit, owner, repo, foundWorkflow.id, runData)
          if (supersedingRun) {
            core.warning(
              `⚠️ Run ${currentRunId} was cancelled, likely superseded by run ${supersedingRun.id}. Switching to wait on the new run: ${supersedingRun.html_url}`,
            )
            currentRunId = supersedingRun.id
            currentRunUrl = supersedingRun.url
            currentRunHtmlUrl = supersedingRun.html_url
            runStatus = supersedingRun.status ?? 'queued'
          }
        }
      }

      if (runStatus === 'completed') {
        core.info('✅ Workflow run completed, the final status can be found in the workflow run details.')
      } else if (runStatus === 'timed_out') {
        core.warning(`⚠️ Workflow run did not complete within the timeout period.`)
      } else {
        core.warning(`⚠️ Workflow run completed with status: ${runStatus}`)
      }
    }

    core.setOutput('runId', currentRunId)
    core.setOutput('runUrl', currentRunUrl)
    core.setOutput('runUrlHtml', currentRunHtmlUrl)
    core.setOutput('workflowId', foundWorkflow.id)

    // Sync the status of this action with the triggered workflow run if requested
    if (syncStatus && waitForCompletion) {
      // Get the final conclusion of the workflow run if we were waiting for completion
      const { data: finalRunData } = await octokit.request(`GET /repos/${owner}/${repo}/actions/runs/${currentRunId}`, {
        headers: { 'x-github-api-version': API_VERSION },
      })
      const conclusion = finalRunData.conclusion

      // Set this action to failed if the triggered workflow run failed or was cancelled
      if (conclusion === 'failure') {
        core.setFailed(`Workflow run failed. Check the run details here: ${currentRunHtmlUrl}`)
      } else if (conclusion === 'cancelled') {
        core.setFailed(`Workflow run was cancelled. Check the run details here: ${currentRunHtmlUrl}`)
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
