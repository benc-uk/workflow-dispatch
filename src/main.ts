// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020
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

type Run = {
  id: number
  created_at: string
  status: string
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
    if(inputsJson) {
      inputs = JSON.parse(inputsJson)
    }

    // Get octokit client for making API calls
    const octokit = github.getOctokit(token)

    // List workflows via API, and handle paginated results
    const workflows: Workflow[] = await octokit.paginate(
      octokit.rest.actions.listRepoWorkflows.endpoint.merge({ owner, repo, ref, inputs })
    )

    // Debug response if ACTIONS_STEP_DEBUG is enabled
    core.debug('### START List Workflows response data')
    core.debug(JSON.stringify(workflows, null, 3))
    core.debug('### END:  List Workflows response data')

    // Locate workflow either by name, id or filename
    const foundWorkflow = workflows.find((workflow) => {
      return workflow.name === workflowRef ||
        workflow.id.toString() === workflowRef ||
        workflow.path.endsWith(workflowRef)
    })

    if(!foundWorkflow) throw new Error(`Unable to find workflow '${workflowRef}' in ${owner}/${repo} 😥`)

    console.log(`🔎 Found workflow, id: ${foundWorkflow.id}, name: ${foundWorkflow.name}, path: ${foundWorkflow.path}`)

    // Call workflow_dispatch API
    console.log('🚀 Calling GitHub API to dispatch workflow...')
    const createdTime = Date.now() - 5000
    const dispatchResp = await octokit.request(`POST /repos/${owner}/${repo}/actions/workflows/${foundWorkflow.id}/dispatches`, {
      ref: ref,
      inputs: inputs
    })

    core.info(`🏆 API response status: ${dispatchResp.status}`)
    core.setOutput('workflowId', foundWorkflow.id)

    // New functionality to make this action synchronous and wait for the workflow to complete
    if (core.getInput('waitTime')) {
      await sleep(5000)
      // Find the run ID of the dispatched workflow
      core.info('🔎 Finding run ID for dispatched workflow...')

      // List workflows via API, and handle paginated results
      const runs: Run[] = await octokit.paginate(
        octokit.rest.actions.listWorkflowRuns.endpoint.merge({ owner, repo, workflow_id: foundWorkflow.id, event: 'workflow_dispatch' })
      )

      console.log(`🔎 First run is ${runs[0].status} and id ${runs[0].id} created at ${runs[0].created_at}`)

      // for (const run of runs) {
      //   console.log(`run.created_at: ${new Date(run.created_at).setMilliseconds(0)}, createdTime: ${createdTime}`)

      //   if (new Date(run.created_at).setMilliseconds(0) >= createdTime) {
      //     core.info(`runId :::: ${run.id}`)
      //     break
      //   }
      // }

      // core.info(`DEBUG runsResp: ${JSON.stringify(runs, null, 3)}`)

      const waitTime = parseInt(core.getInput('waitTime'))
      if (isNaN(waitTime)) {
        throw new Error('waitTime must be a number')
      }

      const checkStatusInterval = 10000
      const waitForCompletionTimeout = waitTime * 1000

      core.info(`⏳ Waiting for workflow to complete, timeout: ${waitTime} seconds`)

      let timeElapsed = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await sleep(checkStatusInterval)
        timeElapsed += checkStatusInterval
        if (timeElapsed > waitForCompletionTimeout) {
          throw new Error(`Workflow did not complete within ${waitTime} seconds`)
        }

        const workflowRun = await octokit.request(`GET /repos/${owner}/${repo}/actions/runs/${dispatchResp.data.id}`)
        if (workflowRun.data.status === 'completed') {
          core.info(`🚩 Workflow completed with status: ${workflowRun.data.conclusion} after ${timeElapsed} seconds`)
          break
        }
      }
    }

  } catch (error) {
    const e = error as Error

    if(e.message.endsWith('a disabled workflow')){
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

// sleep
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
