import core from '@actions/core'
import github from '@actions/github'

try {
  const ref = core.getInput('ref');
  console.log(`### REF ${ref}!`);
  
  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2)
  console.log(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}