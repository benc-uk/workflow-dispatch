import * as core from '@actions/core'
import * as github from '@actions/github'
import { ActionsGetWorkflowResponseData } from '@octokit/types'

// async wrapper function
async function run(): Promise<void> {
  try {
    // Required inputs
    const token = core.getInput('token')
    const workflowName = core.getInput('workflow')
    // Optional inputs, with defaults
    const ref = core.getInput('ref')   || github.context.ref
    const [owner, repo] = core.getInput('repo')
      ? core.getInput('repo').split('/')
      : [github.context.repo.owner, github.context.repo.repo]

    // Decode inputs, these MUST be a valid JSON string
    let inputs = {}
    const inputsJson = core.getInput('inputs')
    if(inputsJson) {
      inputs = JSON.parse(inputsJson)
    }

    // Get octokit client for making API calls
    const octokit = github.getOctokit(token)

    // List workflows via API
    const workflows: ActionsGetWorkflowResponseData[] =
      await octokit.paginate(octokit.actions.listRepoWorkflows.endpoint.merge({ owner, repo, ref, inputs }))

    // Locate workflow by name as we need it's id
    const workflowFind = workflows.find((workflow) => workflow.name === workflowName)
    if(!workflowFind) throw new Error(`Unable to find workflow named '${workflowName}' in ${owner}/${repo} 😥`)
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

// Call the main task run
run()