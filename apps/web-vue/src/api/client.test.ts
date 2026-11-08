import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, resetIdentity } from './client'

beforeEach(() => resetIdentity())
afterEach(() => vi.unstubAllGlobals())
describe('request boundaries', () => {
  it('preserves the exact key and payload for an unknown record result', async () => {
    const calls: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        calls.push(init)
        if (calls.length === 1) throw new TypeError('disconnected')
        return new Response(JSON.stringify({ version: 1 }), { status: 200 })
      }),
    )
    const body = { date: '2026-10-29', weight: 70, unit: 'kg', version: 0 }
    await expect(api('/rooms/r/records', 'PUT', body, 'fixed-key-01')).rejects.toMatchObject({
      code: 'NETWORK_UNKNOWN',
      uncertain: true,
    })
    await expect(api('/rooms/r/records', 'PUT', body, 'fixed-key-01')).resolves.toEqual({
      version: 1,
    })
    expect(calls[0].body).toEqual(calls[1].body)
    expect(calls[0].headers).toEqual(calls[1].headers)
  })
  it('rejects a late response from a previous identity', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (finish = resolve)))
    const result = api('/rooms/old')
    resetIdentity('new-token')
    finish(new Response(JSON.stringify({ nickname: 'old-private-name' })))
    await expect(result).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  })
  it('does not treat malformed successful JSON as a confirmed save', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>proxy error</html>'))
    await expect(api('/rooms/r/records', 'PUT', {}, 'fixed-key-02')).rejects.toMatchObject({
      code: 'RESPONSE_UNKNOWN',
      uncertain: true,
    })
  })
  it('retains the latest authoritative value on a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'VERSION_CONFLICT',
              message: 'changed',
              details: { latest: { weight: 69, version: 2 } },
            },
          }),
          { status: 409 },
        ),
    )
    await expect(api('/rooms/r/records', 'PUT', {}, 'fixed-key-03')).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { latest: { weight: 69, version: 2 } },
      uncertain: false,
    })
  })
  it('sends CSRF only in the request header', async () => {
    resetIdentity('csrf-example')
    const fetcher = vi.fn(async () => new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetcher)
    await api('/support', 'POST', { message: 'synthetic request' }, 'fixed-key-04')
    const init = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-example')
    expect(init.body).not.toContain('csrf-example')
  })
  it('distinguishes a known rejection from an unknown save', () => {
    expect(new ApiError('VALIDATION', 'invalid', {}, 400).uncertain).toBe(false)
    expect(new ApiError('INTERNAL_ERROR', 'unknown', {}, 500).uncertain).toBe(true)
  })
})
