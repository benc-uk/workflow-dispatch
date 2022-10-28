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

//
// Main task function (async wrapper)
//
async function run(): Promise<void> {
  core.info(`Workflow Dispatch Action v${PackageJSON.version}`)
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
    octokit.graphql

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

    console.log(`Workflow id is: ${foundWorkflow.id}`)

    // Call workflow_dispatch API
    const dispatchResp = await octokit.request(`POST /repos/${owner}/${repo}/actions/workflows/${foundWorkflow.id}/dispatches`, {
      ref: ref,
      inputs: inputs
    })

    core.info(`API response status: ${dispatchResp.status} 🚀`)
    core.setOutput('workflowId', foundWorkflow.id)
  } catch (error) {
    const e = error as Error

    if(e.message.endsWith('a disabled workflow')){
      core.warning('WARNING! Workflow is disabled, no action was taken')
      return
    }

    core.setFailed(e.message)
  }
}

//
// Call the main task run function
//
run()
