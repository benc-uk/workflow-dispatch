import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TIMED_OUT, waitForRunCompletion } from './wait-for-run.ts'

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

// A scripted poll result: a run status, or an error for getStatus to throw
type Poll = string | Error

// Fake clock which advances only when the poller sleeps, so tests never wait for real
function fakePoller(polls: Poll[]) {
  let clock = 0
  const sleeps: number[] = []
  const infos: string[] = []
  const warnings: string[] = []
  let calls = 0

  const deps = {
    getStatus: async () => {
      const next = polls[Math.min(calls, polls.length - 1)]
      calls++
      if (next instanceof Error) throw next
      return next
    },
    log: { info: (message: string) => infos.push(message), warning: (message: string) => warnings.push(message) },
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
  }

  return { deps, sleeps, infos, warnings, calls: () => calls }
}

describe('waitForRunCompletion', () => {
  it('polls every interval until the run completes', async () => {
    const { deps, sleeps, infos } = fakePoller(['queued', 'in_progress', 'completed'])

    const status = await waitForRunCompletion({ ...deps, timeoutSeconds: 60, intervalSeconds: 5 })

    assert.equal(status, 'completed')
    assert.deepEqual(sleeps, [5000, 5000, 5000])
    assert.deepEqual(infos, [
      '🔄 Current run status: queued',
      '🔄 Current run status: in_progress',
      '🔄 Current run status: completed',
    ])
  })

  it('returns a non active status as is', async () => {
    const { deps } = fakePoller(['pending', 'waiting', 'requested'])

    const status = await waitForRunCompletion({ ...deps, timeoutSeconds: 60, intervalSeconds: 5 })

    assert.equal(status, 'requested')
  })

  it('keeps polling through transient errors', async () => {
    const { deps, warnings, calls } = fakePoller([
      httpError(502, 'Bad Gateway'),
      httpError(500, 'fetch failed'), // How @octokit/request reports network failures
      httpError(429, 'Too Many Requests'),
      'completed',
    ])

    const status = await waitForRunCompletion({ ...deps, timeoutSeconds: 60, intervalSeconds: 5 })

    assert.equal(status, 'completed')
    assert.equal(calls(), 4)
    assert.equal(warnings.length, 3)
    assert.match(warnings[0], /Failed to get run status, will try again: Bad Gateway/)
  })

  it('fails immediately on a non transient error', async () => {
    const { deps, calls } = fakePoller([httpError(404, 'Not Found'), 'completed'])

    await assert.rejects(waitForRunCompletion({ ...deps, timeoutSeconds: 60, intervalSeconds: 5 }), {
      message: 'Not Found',
    })
    assert.equal(calls(), 1)
  })

  it('fails immediately on an error without an HTTP status', async () => {
    const { deps, calls } = fakePoller([new TypeError('runData is undefined'), 'completed'])

    await assert.rejects(waitForRunCompletion({ ...deps, timeoutSeconds: 60, intervalSeconds: 5 }), TypeError)
    assert.equal(calls(), 1)
  })

  it('times out while the run stays active', async () => {
    const { deps, calls } = fakePoller(['in_progress'])

    const status = await waitForRunCompletion({ ...deps, timeoutSeconds: 10, intervalSeconds: 5 })

    assert.equal(status, TIMED_OUT)
    assert.equal(calls(), 3) // Polled at 5s, 10s and 15s, the timeout is checked before each sleep
  })

  it('times out when transient errors never stop', async () => {
    const { deps, warnings } = fakePoller([httpError(503, 'Service Unavailable')])

    const status = await waitForRunCompletion({ ...deps, timeoutSeconds: 10, intervalSeconds: 5 })

    assert.equal(status, TIMED_OUT)
    assert.equal(warnings.length, 3)
  })
})
