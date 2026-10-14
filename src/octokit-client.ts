import * as core from '@actions/core'
import * as github from '@actions/github'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'

export const MAX_RATE_LIMIT_RETRIES = 3

// Client errors are not transient, never retry them.
// Same as the plugin-retry default, pinned here so a plugin upgrade can't silently change it.
// Note: 403 stays on this list even though GitHub reports secondary rate
// limits as 403 — those are handled by the throttling plugin, not retry.
export const DO_NOT_RETRY_STATUS_CODES = [400, 401, 403, 404, 410, 422, 451]

// Per-request options for non-idempotent calls (e.g. workflow dispatch). When GitHub processed the
// request but the response was lost (5xx / network error), a retry would repeat the side effect.
// Rate limited requests are still retried by the throttling plugin, as GitHub rejected them unprocessed.
export const NO_RETRY_REQUEST_OPTIONS = { retries: 0 }

type ThrottledRequest = {
  method: string
  url: string
}

type Logger = (message: string) => void

// Same rule plugin-retry uses to decide on a retry; network failures surface as status 500
export function isTransientError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && !DO_NOT_RETRY_STATUS_CODES.includes(status)
}

export function shouldRetryAfterRateLimit(retryCount: number): boolean {
  return retryCount < MAX_RATE_LIMIT_RETRIES
}

function rateLimitHandler(kind: string, log: Logger) {
  return (retryAfter: number, request: ThrottledRequest, _octokit: unknown, retryCount: number): boolean => {
    const willRetry = shouldRetryAfterRateLimit(retryCount)
    log(
      willRetry
        ? `${kind} hit for ${request.method} ${request.url}, retry ${retryCount + 1} after ${retryAfter}s`
        : `${kind} hit for ${request.method} ${request.url}, giving up after ${retryCount} retries`,
    )
    return willRetry
  }
}

export function buildOctokitOptions(log: Logger = core.warning) {
  return {
    retry: { doNotRetry: DO_NOT_RETRY_STATUS_CODES },
    throttle: {
      onRateLimit: rateLimitHandler('Rate limit', log),
      onSecondaryRateLimit: rateLimitHandler('Secondary rate limit', log),
    },
  }
}

export function createOctokit(token: string, getOctokit: typeof github.getOctokit = github.getOctokit) {
  return getOctokit(token, buildOctokitOptions(), retry, throttling)
}
