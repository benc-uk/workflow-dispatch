
import * as core from '@actions/core';
import * as github from '@actions/github';
import { debug } from './debug';

export enum WorkflowRunStatus {
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed'
}

const ofStatus = (status: string | null): WorkflowRunStatus => {
  if (!status) {
    return WorkflowRunStatus.QUEUED;
  }
  const key = status.toUpperCase() as keyof typeof WorkflowRunStatus;
  return WorkflowRunStatus[key];
};

export enum WorkflowRunConclusion {
  SUCCESS = 'success',
  FAILURE = 'failure',
  CANCELLED = 'cancelled',
  SKIPPED = 'skipped',
  NEUTRAL = 'neutral',
  TIMED_OUT = 'timed_out',
  ACTION_REQUIRED = 'action_required'
}

const ofConclusion = (conclusion: string | null): WorkflowRunConclusion => {
  if (!conclusion) {
    return WorkflowRunConclusion.NEUTRAL;
  }
  const key = conclusion.toUpperCase() as keyof typeof WorkflowRunConclusion;
  return WorkflowRunConclusion[key];
};

export interface WorkflowRunResult {
  url: string,
  status: WorkflowRunStatus,
  conclusion: WorkflowRunConclusion
}


export class WorkflowHandler {
  private octokit: any;
  private workflowId?: number | string;
  private workflowRunId?: number;
  private triggerDate = 0;

  constructor(token: string,
    private workflowRef: string,
    private owner: string,
    private repo: string,
    private ref: string,
    private runName: string) {
    // Get octokit client for making API calls
    this.octokit = github.getOctokit(token);
  }

  async triggerWorkflow(inputs: any) {
    try {
      const workflowId = await this.getWorkflowId();
      this.triggerDate = new Date().setMilliseconds(0);
      const dispatchResp = await this.octokit.rest.actions.createWorkflowDispatch({
        owner: this.owner,
        repo: this.repo,
        workflow_id: workflowId,
        ref: this.ref,
        inputs
      });
      debug('Workflow Dispatch', dispatchResp);
    } catch (error: any) {
      debug('Workflow Dispatch error', error.message);
      throw error;
    }
  }

  async getWorkflowRunStatus(): Promise<WorkflowRunResult> {
    try {
      const runId = await this.getWorkflowRunId();
      const response = await this.octokit.rest.actions.getWorkflowRun({
        owner: this.owner,
        repo: this.repo,
        run_id: runId
      });
      debug('Workflow Run status', response);

      return {
        url: response.data.html_url,
        status: ofStatus(response.data.status),
        conclusion: ofConclusion(response.data.conclusion)
      };

    } catch (error: any) {
      debug('Workflow Run status error', error);
      throw error;
    }
  }


  async getWorkflowRunArtifacts(): Promise<WorkflowRunResult> {
    try {
      const runId = await this.getWorkflowRunId();
      const response = await this.octokit.rest.actions.getWorkflowRunArtifacts({
        owner: this.owner,
        repo: this.repo,
        run_id: runId
      });
      debug('Workflow Run artifacts', response);

      return {
        url: response.data.html_url,
        status: ofStatus(response.data.status),
        conclusion: ofConclusion(response.data.conclusion)
      };

    } catch (error) {
      debug('Workflow Run artifacts error', error);
      throw error;
    }
  }


  async getWorkflowRunId(): Promise<number> {
    if (this.workflowRunId) {
      return this.workflowRunId;
    }
    try {
      core.debug('Get workflow run id');
      if (this.runName) {
        this.workflowRunId = await this.findWorklowRunIdFromRunName(this.runName);
      } else {
        this.workflowRunId = await this.findWorkflowRunIdFromFirstRunOfSameWorkflowId();
      }

      return this.workflowRunId;
    } catch (error) {
      debug('Get workflow run id error', error);
      throw error;
    }

  }

  private async findWorkflowRunIdFromFirstRunOfSameWorkflowId(): Promise<number> {
    const workflowId = await this.getWorkflowId();

    const response = await this.octokit.rest.actions.listWorkflowRuns({
      owner: this.owner,
      repo: this.repo,
      workflow_id: workflowId,
      event: 'workflow_dispatch'
    });

    debug('List Workflow Runs', response);
    const runs = response.data.workflow_runs
      .filter((r: any) => new Date(r.created_at).setMilliseconds(0) >= this.triggerDate);
    debug(`Filtered Workflow Runs (after trigger date: ${new Date(this.triggerDate).toISOString()})`, runs.map((r: any) => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      triggerDate: new Date(this.triggerDate).toISOString(),
      created_at_ts: new Date(r.created_at).valueOf(),
      triggerDateTs: this.triggerDate
    })));

    if (runs.length == 0) {
      throw new Error('Run not found');
    }

    return runs[0].id as number;
  }

  private async findWorklowRunIdFromRunName(runName: string): Promise<number> {
    const result = await this.octokit.rest.checks.listForRef({
      check_name: runName,
      owner: this.owner,
      repo: this.repo,
      ref: this.ref,
      filter: 'latest'
    });

    if (result.length == 0) {
      throw new Error('Run not found');
    }

    return result.check_runs[0].id as number;
  }

  private async getWorkflowId(): Promise<number | string> {
    if (this.workflowId) {
      return this.workflowId;
    }
    if (this.isFilename(this.workflowRef)) {
      this.workflowId = this.workflowRef;
      core.debug(`Workflow id is: ${this.workflowRef}`);
      return this.workflowId;
    }
    try {
      const workflowsResp = await this.octokit.rest.actions.listRepoWorkflows({
        owner: this.owner,
        repo: this.repo
      });
      const workflows = workflowsResp.data.workflows;
      debug('List Workflows', workflows);

      // Locate workflow either by name or id
      const workflowFind = workflows.find((workflow: any) => workflow.name === this.workflowRef || workflow.id.toString() === this.workflowRef);
      if(!workflowFind) throw new Error(`Unable to find workflow '${this.workflowRef}' in ${this.owner}/${this.repo} 😥`);
      core.debug(`Workflow id is: ${workflowFind.id}`);
      this.workflowId = workflowFind.id as number;
      return this.workflowId;
    } catch(error) {
      debug('List workflows error', error);
      throw error;
    }
  }

  private isFilename(workflowRef: string) {
    return /.+\.ya?ml$/.test(workflowRef);
  }

}
