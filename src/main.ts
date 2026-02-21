// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020-2026
// Licensed under the MIT License.
//
// Workflow Dispatch Action - Main task code
// ----------------------------------------------------------------------------

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as PackageJSON from '../package.json'

type Workflow = {
  id: number
  name: string
  path: string
}

//
// Main task function (async wrapper)
//
async function run(): Promise<void> {
  core.info(`🏃 Workflow Dispatch Action v${PackageJSON.version}`)
  try {
    // Required inputs
    const workflowRef = core.getInput('workflow')

    // Optional inputs, with defaults
    const token = core.getInput('token')
    const ref = core.getInput('ref') || github.context.ref
    const [owner, repo] = core.getInput('repo')
      ? core.getInput('repo').split('/')
      : [github.context.repo.owner, github.context.repo.repo]

    // Decode inputs, this MUST be a valid JSON string
    let inputs = {}
    const inputsJson = core.getInput('inputs')
    if (inputsJson) {
      inputs = JSON.parse(inputsJson)
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
      },
    )

    core.info(`🏆 API response status: ${dispatchResp.status}`)
    core.info(`🌐 Run URL: ${dispatchResp.data.html_url}`)

    // Handle wait for completion
    const waitForCompletion = core.getInput('wait-for-completion') === 'true'
    const timeoutSeconds = parseInt(core.getInput('wait-timeout-seconds') || '900', 10) // Default to 15 minutes
    if (waitForCompletion) {
      core.info(`⏳ Waiting for workflow run to complete with a timeout of ${timeoutSeconds} seconds...`)
      let runStatus = 'in_progress'
      const startTime = Date.now()
      while (runStatus === 'in_progress' || runStatus === 'queued' || runStatus === 'waiting') {
        if ((Date.now() - startTime) / 1000 > timeoutSeconds) {
          core.warning(
            `⚠️ Workflow run did not complete within ${timeoutSeconds} seconds, timing out.\nNote: The workflow is still running but we have stopped waiting. You can check the run status here: ${dispatchResp.data.html_url}`,
          )
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait for 5 seconds before polling again

        const { data: runData } = await octokit.request(
          `GET /repos/${owner}/${repo}/actions/runs/${dispatchResp.data.workflow_run_id}`,
        )
        runStatus = runData.status
        core.info(`🔄 Current run status: ${runStatus}`)
      }

      if (runStatus === 'completed') {
        core.info('✅ Workflow run completed successfully!')
      } else {
        core.warning(`⚠️ Workflow run completed with status: ${runStatus}`)
      }
    }

    core.setOutput('runId', dispatchResp.data.workflow_run_id)
    core.setOutput('runUrl', dispatchResp.data.run_url)
    core.setOutput('runUrlHtml', dispatchResp.data.html_url)
    core.setOutput('workflowId', foundWorkflow.id)
  } catch (error) {
    const e = error as Error

    if (e.message.endsWith('a disabled workflow')) {
      core.warning('Workflow is disabled, no action was taken')
      return
    }

    core.setFailed(e.message)
  }
}

//
// Call the main task run function
//
run()
