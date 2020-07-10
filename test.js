const core = require('@actions/core');
const github = require('@actions/github');

try {
  const octokit = github.getOctokit('');
  octokit.request(`POST https://api.github.com/repos/benc-uk/dapr-store/actions/workflows/1300956/dispatches`, {
    ref: 'master'
  });

} catch(e) {
  console.log(e);
}