// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020
// Licensed under the MIT License.
//
// Workflow Dispatch Action - Main task code
// ----------------------------------------------------------------------------

import * as core from '@actions/core'
import * as github from '@actions/github'
import { ActionsGetWorkflowResponseData } from '@octokit/types'

//
// Main task function (async wrapper)
//
async function run(): Promise<void> {
  try {
    // Required inputs
    const token = core.getInput('token')
    const workflowRef = core.getInput('workflow')
    // Optional inputs, with defaults
    const ref = core.getInput('ref')   || github.context.ref
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
    const workflows: ActionsGetWorkflowResponseData[] =
      await octokit.paginate(octokit.actions.listRepoWorkflows.endpoint.merge({ owner, repo, ref, inputs }))

    // Debug response if ACTIONS_STEP_DEBUG is enabled
    core.debug('### START List Workflows response data')
    core.debug(JSON.stringify(workflows, null, 3))
    core.debug('### END:  List Workflows response data')

    // Locate workflow either by name or id
    const workflowFind = workflows.find((workflow) => workflow.name === workflowRef || workflow.id.toString() === workflowRef)
    if(!workflowFind) throw new Error(`Unable to find workflow '${workflowRef}' in ${owner}/${repo} 😥`)
    console.log(`Workflow id is: ${workflowFind.id}`)

    // Call workflow_dispatch API
    const dispatchResp = await octokit.request(`POST /repos/${owner}/${repo}/actions/workflows/${workflowFind.id}/dispatches`, {
      ref: ref,
      inputs: inputs
    })
    core.info(`API response status: ${dispatchResp.status} 🚀`)
  } catch (error) {
    core.setFailed(error.message)
  }
}

//
// Call the main task run function
//
run()