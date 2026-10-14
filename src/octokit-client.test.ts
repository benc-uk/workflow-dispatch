import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as github from '@actions/github'
import { retry } from '@octokit/plugin-retry'
import { throttling, type ThrottlingOptions } from '@octokit/plugin-throttling'
import {
  buildOctokitOptions,
  createOctokit,
  isTransientError,
  MAX_RATE_LIMIT_RETRIES,
  NO_RETRY_REQUEST_OPTIONS,
} from './octokit-client.ts'

const request = { method: 'POST', url: '/repos/o/r/actions/workflows/1/dispatches' }
const SECONDARY_RATE_LIMIT = 'You have exceeded a secondary rate limit'

// A scripted response: [status, body?, headers?], or 'network-error' to make fetch reject
type FakeResponse = [number, object?, Record<string, string>?] | 'network-error'

// The throttling plugin spaces write requests 1s apart through a limiter shared by every client in the
// process, so each POST would wait for the previous test's POST. Pass writes straight through instead,
// retry and rate limit handling don't depend on it.
const unthrottledWrites = {
  key: () => ({ schedule: (_options: unknown, job: () => Promise<unknown>) => job() }),
} as unknown as ThrottlingOptions['write']

// Real client config and plugins, with a scripted fetch and no backoff delays
function fakeClient(responses: FakeResponse[]) {
  const calls: string[] = []
  const warnings: string[] = []
  const fetch = async (url: string, init: { method: string }) => {
    calls.push(`${init.method} ${new URL(url).pathname}`)
    const next = responses[Math.min(calls.length, responses.length) - 1]
    if (next === 'network-error') throw new TypeError('fetch failed')

    const [status, body = {}, headers = {}] = next
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }

  const options = buildOctokitOptions((message) => warnings.push(message))
  const octokit = github.getOctokit(
    'token',
    {
      retry: { ...options.retry, retryAfterBaseValue: 0 },
      throttle: {
        ...options.throttle,
        retryAfterBaseValue: 0,
        fallbackSecondaryRateRetryAfter: 0,
        write: unthrottledWrites,
      },
      request: { fetch },
    },
    retry,
    throttling,
  )

  return { octokit, calls, warnings }
}

const getRun = (octokit: ReturnType<typeof fakeClient>['octokit']) => octokit.request('GET /repos/o/r/actions/runs/1')
const dispatch = (octokit: ReturnType<typeof fakeClient>['octokit']) =>
  octokit.request('POST /repos/o/r/actions/workflows/1/dispatches', { ref: 'main', request: NO_RETRY_REQUEST_OPTIONS })

describe('isTransientError', () => {
  it('is true for server errors, network failures and 429', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      assert.equal(isTransientError({ status }), true, `expected ${status} to be transient`)
    }
  })

  it('is false for client errors', () => {
    for (const status of [400, 401, 403, 404, 410, 422, 451]) {
      assert.equal(isTransientError({ status }), false, `expected ${status} not to be transient`)
    }
  })

  it('is false for errors without an HTTP status', () => {
    for (const error of [new Error('boom'), new TypeError('x is undefined'), null, undefined, 'string']) {
      assert.equal(isTransientError(error), false)
    }
  })
})

describe('rate limit handlers', () => {
  for (const name of ['onRateLimit', 'onSecondaryRateLimit'] as const) {
    it(`${name} retries while under the limit`, () => {
      const warnings: string[] = []
      const handler = buildOctokitOptions((message) => warnings.push(message)).throttle[name]

      assert.equal(handler(60, request, {}, 0), true)
      assert.equal(handler(60, request, {}, MAX_RATE_LIMIT_RETRIES - 1), true)
      assert.match(warnings[0], /retry 1 after 60s/)
    })

    it(`${name} gives up at the limit`, () => {
      const warnings: string[] = []
      const handler = buildOctokitOptions((message) => warnings.push(message)).throttle[name]

      assert.equal(handler(60, request, {}, MAX_RATE_LIMIT_RETRIES), false)
      assert.equal(handler(60, request, {}, MAX_RATE_LIMIT_RETRIES + 1), false)
      assert.match(warnings[0], new RegExp(`giving up after ${MAX_RATE_LIMIT_RETRIES} retries`))
    })
  }
})

// Every request through the plugins' Bottleneck limiters costs ~50-200ms of scheduling, so run these
// concurrently, each test has its own client and fetch.
describe('retry behaviour', { concurrency: true }, () => {
  it('retries a server error and returns the later success', async () => {
    const { octokit, calls } = fakeClient([[502], [200, { status: 'queued' }]])

    const response = await getRun(octokit)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
  })

  it('gives up after the default 3 retries with the last error', async () => {
    const { octokit, calls } = fakeClient([[502]])

    await assert.rejects(getRun(octokit), { status: 502 })
    assert.equal(calls.length, 4)
  })

  it('retries a network failure', async () => {
    const { octokit, calls } = fakeClient(['network-error', [200]])

    const response = await getRun(octokit)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
  })

  it('does not retry a client error', async () => {
    const { octokit, calls } = fakeClient([[404, { message: 'Not Found' }]])

    await assert.rejects(getRun(octokit), { status: 404 })
    assert.equal(calls.length, 1)
  })

  it('retries a secondary rate limit via the throttling plugin', async () => {
    const { octokit, calls, warnings } = fakeClient([[403, { message: SECONDARY_RATE_LIMIT }], [200]])

    const response = await getRun(octokit)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(warnings.length, 1)
  })
})

describe('NO_RETRY_REQUEST_OPTIONS', { concurrency: true }, () => {
  it('does not retry a server error, as the dispatch may have been processed', async () => {
    const { octokit, calls } = fakeClient([[500], [200]])

    await assert.rejects(dispatch(octokit), { status: 500 })
    assert.deepEqual(calls, ['POST /repos/o/r/actions/workflows/1/dispatches'])
  })

  it('does not retry a network failure', async () => {
    const { octokit, calls } = fakeClient(['network-error', [200]])

    await assert.rejects(dispatch(octokit), { status: 500 })
    assert.equal(calls.length, 1)
  })

  it('still retries a secondary rate limit, as the dispatch was rejected unprocessed', async () => {
    const { octokit, calls } = fakeClient([[403, { message: SECONDARY_RATE_LIMIT }], [200]])

    const response = await dispatch(octokit)

    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
  })
})

describe('createOctokit', () => {
  it('wires token, options and both official plugins into getOctokit', () => {
    const calls: Array<{ token: unknown; options: unknown; plugins: unknown[] }> = []
    const stubClient = { stub: 'octokit' }
    const stubGetOctokit = ((token: unknown, options: unknown, ...plugins: unknown[]) => {
      calls.push({ token, options, plugins })
      return stubClient
    }) as unknown as typeof github.getOctokit

    const octokit = createOctokit('secret-token', stubGetOctokit)

    assert.equal(octokit, stubClient)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].token, 'secret-token')
    assert.deepEqual(calls[0].plugins, [retry, throttling])
  })

  it('passes retry and throttle options through', () => {
    let seenOptions: unknown
    const stubGetOctokit = ((...args: unknown[]) => {
      seenOptions = args[1]
      return {}
    }) as unknown as typeof github.getOctokit

    createOctokit('secret-token', stubGetOctokit)

    const options = seenOptions as ReturnType<typeof buildOctokitOptions>
    assert.deepEqual(options.retry, buildOctokitOptions().retry)
    assert.equal(typeof options.throttle.onRateLimit, 'function')
    assert.equal(typeof options.throttle.onSecondaryRateLimit, 'function')
  })
})
