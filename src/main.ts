import * as core from '@actions/core'
import * as github from '@actions/github'

// async wrapper function
async function run(): Promise<void> {
  try {
    // Required inputs
    const token = core.getInput('token')
    const workflowName = core.getInput('workflow')
    // Optional inputs, with defaults
    const ref = core.getInput('ref')   || github.context.ref
    const repo = core.getInput('repo') || `${github.context.repo.owner}/${github.context.repo.repo}`

    // Decode inputs, these MUST be a valid JSON string
    let inputs = {}
    const inputsJson = core.getInput('inputs')
    if(inputsJson) {
      inputs = JSON.parse(inputsJson)
    }

    // Get octokit client for making API calls
    const octokit = github.getOctokit(token)

    // List workflows via API
    const listResp = await octokit.request(`GET /repos/${repo}/actions/workflows`, {
      ref: ref,
      inputs: inputs
    })
    if(listResp.status != 200) throw new Error(`Got HTTP ${listResp.status} calling list workflows API 💩`)

    // Debug response if ACTIONS_STEP_DEBUG is enabled
    core.debug(listResp.data)

    // Locate workflow by name as we need it's id
    const workflowFind = listResp.data.workflows.find((wf: Record<string, string>) => {
      return wf['name'] === workflowName
    })
    if(!workflowFind) throw new Error(`Unable to find workflow named '${workflowName}' in ${repo} 😥`)
    console.log(`Workflow id is: ${workflowFind.id}`)

    // Call workflow_dispatch API
    const dispatchResp = await octokit.request(`POST /repos/${repo}/actions/workflows/${workflowFind.id}/dispatches`, {
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