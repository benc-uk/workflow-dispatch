import * as core from '@actions/core'
import * as github from '@actions/github'

enum TimeUnit {
  S = 1000,
  M = 60 * 1000,
  H = 60 * 60 * 1000
}

function toMilliseconds(timeWithUnit: string): number {
  const unitStr = timeWithUnit.substr(timeWithUnit.length-1);
  const unit = TimeUnit[unitStr.toUpperCase() as keyof typeof TimeUnit];
  if (!unit) {
    throw new Error('Unknown time unit '+unitStr);
  }
  const time = parseFloat(timeWithUnit);
  return time * unit;
}

export function getArgs() {
  // Required inputs
  const token = core.getInput('token');
  const workflowRef = core.getInput('workflow');
  // Optional inputs, with defaults
  const ref = core.getInput('ref')   || github.context.ref;
  const [owner, repo] = core.getInput('repo')
    ? core.getInput('repo').split('/')
    : [github.context.repo.owner, github.context.repo.repo];

  // Decode inputs, this MUST be a valid JSON string
  let inputs = {};
  const inputsJson = core.getInput('inputs');
  if(inputsJson) {
    inputs = JSON.parse(inputsJson);
  }

  const displayWorkflowUrlStr = core.getInput('display-workflow-run-url');
  const displayWorkflowUrl = displayWorkflowUrlStr && displayWorkflowUrlStr === 'true';
  const displayWorkflowUrlTimeout = toMilliseconds(core.getInput('display-workflow-run-url-timeout'));
  const displayWorkflowUrlInterval = toMilliseconds(core.getInput('display-workflow-run-url-interval'));

  const waitForCompletionStr = core.getInput('wait-for-completion');
  const waitForCompletion = waitForCompletionStr && waitForCompletionStr === 'true';
  const waitForCompletionTimeout = toMilliseconds(core.getInput('wait-for-completion-timeout'));
  const checkStatusInterval = toMilliseconds(core.getInput('wait-for-completion-interval'));

  return {
    token,
    workflowRef,
    ref,
    owner,
    repo,
    inputs,
    displayWorkflowUrl,
    displayWorkflowUrlTimeout,
    displayWorkflowUrlInterval,
    checkStatusInterval,
    waitForCompletion,
    waitForCompletionTimeout
  };
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isTimedOut(start: number, waitForCompletionTimeout: number) {
  return Date.now() > start + waitForCompletionTimeout;
}

export function formatDuration(duration: number) {
  const durationSeconds = duration / 1000;
  const hours   = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds - (hours * 3600)) / 60);
  const seconds = durationSeconds - (hours * 3600) - (minutes * 60);

  let hoursStr = hours + '';
  let minutesStr = minutes + '';
  let secondsStr = seconds + '';

  if (hours   < 10) {hoursStr   = "0"+hoursStr;}
  if (minutes < 10) {minutesStr = "0"+minutesStr;}
  if (seconds < 10) {secondsStr = "0"+secondsStr;}
  return hoursStr+'h '+minutesStr+'m '+secondsStr+'s';
}
