import * as core from '@actions/core';
import * as github from '@actions/github';
import { debug } from './debug';

interface JobInfo {
  name: string,
  id: number
}


export async function handleWorkflowLogsPerJob(args: any, workflowRunId: number): Promise<void> {
  const mode = args.workflowLogMode;
  const token = args.token;
  const owner = args.owner;
  const repo = args.repo;

  const handler = logHandlerFactory(mode);
  if (handler == null) {
    return;
  }

  const octokit = github.getOctokit(token);
  const runId = workflowRunId;
  const response = await octokit.rest.actions.listJobsForWorkflowRun({
    owner: owner,
    repo: repo,
    run_id: runId
  });

  await handler.handleJobList(response.data.jobs);

  for (const job of response.data.jobs) {
    try {
      const jobLog = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner: owner,
        repo: repo,
        job_id: job.id,
      });
      await handler.handleJobLogs(job, jobLog.data as string);
    } catch (error: any) {
      await handler.handleError(job, error);
    }
  }
}






interface WorkflowLogHandler {
  handleJobList(jobs: Array<JobInfo>): Promise<void>
  handleJobLogs(job: JobInfo, logs: string): Promise<void>
  handleError(job: JobInfo, error: Error): Promise<void>
}

class PrintLogsHandler implements WorkflowLogHandler {

  async handleJobList(jobs: Array<JobInfo>): Promise<void> {
    debug('Retrieving logs for jobs in workflow', jobs);
  }

  async handleJobLogs(job: JobInfo, logs: string): Promise<void> {
    core.startGroup(`Logs of job '${job.name}'`);
    core.info(escapeImportedLogs(logs));
    core.endGroup();

  }

  async handleError(job: JobInfo, error: Error): Promise<void> {
    core.warning(escapeImportedLogs(error.message));
  }
}

function logHandlerFactory(mode: string): WorkflowLogHandler | null {
  switch(mode) {
    case 'print': return new PrintLogsHandler();
    default: return null;
  }
}

function escapeImportedLogs(str: string): string {
  return str.replace(/^/mg, '| ')
    .replace(/##\[([^\]]+)\]/gm, '##<$1>');
}
