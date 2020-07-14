// ----------------------------------------------------------------------------
// Copyright (c) Ben Coleman, 2020
// Licensed under the MIT License.
//
// Workflow Dispatch Action - Main task code
// ----------------------------------------------------------------------------

import * as core from '@actions/core'
import * as github from '@actions/github'

//
// Main task function (async wrapper)
//
async function run(): Promise<void> {
  try {
    // Required inputs
    const token = core.getInput('token')
    const workflowReference = core.getInput('workflow')
    // Optional inputs, with defaults
    const ref = core.getInput('ref')   || github.context.ref
    const repo = core.getInput('repo') || `${github.context.repo.owner}/${github.context.repo.repo}`

    // Decode inputs, this MUST be a valid JSON string
    let inputs = {}
    const inputsJson = core.getInput('inputs')
    if(inputsJson) {
      inputs = JSON.parse(inputsJson)
    }

    // Get octokit client for making API calls
    const octokit = github.getOctokit(token)

    // List workflows in repo via API
    const listResp = await octokit.request(`GET /repos/${repo}/actions/workflows`, {
      ref: ref,
      inputs: inputs
    })
    if(listResp.status != 200) throw new Error(`Got HTTP ${listResp.status} calling list workflows API 💩`)

    // Debug response if ACTIONS_STEP_DEBUG is enabled
    core.debug('### START List Workflows response data')
    core.debug(JSON.stringify(listResp.data, null, 3))
    core.debug('### END:  List Workflows response data')

    // Locate workflow by name as we need it's id
    const foundWorkflow = listResp.data.workflows.find((wf: Record<string, string>) => {
      // Match on name or id, there's a slim chance someone names their workflow 1803663 but they are crazy
      return (wf['name'] === workflowReference || wf['id'].toString() === workflowReference)
    })

    if(!foundWorkflow) throw new Error(`Unable to find workflow '${workflowReference}' in ${repo} 😥`)

    console.log(`Workflow id is: ${foundWorkflow.id}`)

    // Call workflow_dispatch API to trigger the workflow
    const dispatchResp = await octokit.request(`POST /repos/${repo}/actions/workflows/${foundWorkflow.id}/dispatches`, {
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