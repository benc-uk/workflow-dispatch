const core = require('@actions/core');
const github = require('@actions/github');

try {
  const workflowId = core.getInput('workflow-id');
  const ref = core.getInput('ref') || github.context.ref;
  const token = core.getInput('token');

  const octokit = github.getOctokit(token);

  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  octokit.request(`POST repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    ref: ref
  });
  
  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  console.log(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}