import * as core from '@actions/core'
import { isTransientError } from './octokit-client.ts'

// Run statuses which mean the run has not finished yet
export const ACTIVE_RUN_STATUSES = ['in_progress', 'queued', 'waiting', 'pending']

export const TIMED_OUT = 'timed_out'

type Logger = {
  info: (message: string) => void
  warning: (message: string) => void
}

export type WaitForRunOptions = {
  getStatus: () => Promise<string>
  timeoutSeconds: number
  intervalSeconds: number
  log?: Logger
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

// Polls the run status until the run is no longer active, returns the last status or TIMED_OUT.
// Transient errors which outlast the client retries are logged and polling continues, the timeout still applies.
export async function waitForRunCompletion({
  getStatus,
  timeoutSeconds,
  intervalSeconds,
  log = core,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: WaitForRunOptions): Promise<string> {
  const startTime = now()
  let runStatus = 'in_progress'

  while (ACTIVE_RUN_STATUSES.includes(runStatus)) {
    if ((now() - startTime) / 1000 > timeoutSeconds) return TIMED_OUT

    await sleep(intervalSeconds * 1000)

    try {
      runStatus = await getStatus()
      log.info(`🔄 Current run status: ${runStatus}`)
    } catch (error) {
      if (!isTransientError(error)) throw error

      log.warning(
        `⚠️ Failed to get run status, will try again: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return runStatus
}
