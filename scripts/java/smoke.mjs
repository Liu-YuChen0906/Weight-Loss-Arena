#!/usr/bin/env node
// Real HTTP exercise against an isolated running Java stack. Never sends a provider SMS.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const base = process.env.BASE_URL || 'http://localhost:8088'
const secondApi = process.env.SECOND_API_URL
const config = await fetch(`${base}/api/v1/config`).then((r) => r.json())
assert.equal(config.mode, 'local', 'Only isolated local mode may run this script')
assert.equal(config.syntheticOnly, true)
class Client {
  cookie = ''
  csrf = ''
  instances = new Set()
  async call(path, method = 'GET', body, key = randomUUID(), target = base) {
    const headers = {
      Cookie: this.cookie,
      'Content-Type': 'application/json',
      'X-App-Request': '1',
      Origin: new URL(base).origin,
      'Idempotency-Key': key,
    }
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf
    const response = await fetch(`${target}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const value of response.headers.getSetCookie()) {
      if (value.startsWith('cq_session=')) this.cookie = value.split(';')[0]
    }
    this.instances.add(response.headers.get('X-Test-Instance'))
    const data = await response.json()
    assert.equal(response.status, 200, JSON.stringify(data))
    if (data.user?.csrf) this.csrf = data.user.csrf
    return data
  }
  async login(phone, nickname) {
    const code = await this.call('/auth/code', 'POST', { phone })
    assert.equal(code.deliveryStatus, 'DEVELOPMENT')
    await this.call('/auth/login', 'POST', { phone, code: code.developmentCode })
    await this.call('/me/profile', 'POST', {
      nickname,
      avatar: '🌱',
      adult: true,
      sensitiveConsent: true,
    })
  }
}
const a = new Client(),
  b = new Client()
// Reserved synthetic numbers; use fresh suffixes to avoid cooldown on repeated manual runs.
const suffix = String(Date.now() % 100000000).padStart(8, '0')
await a.login(`139${suffix}`, '合成甲')
await b.login(`138${suffix}`, '合成乙')
const { roomId } = await a.call('/rooms', 'POST', {
  days: 14,
  intensity: '低',
  sharingConsent: true,
})
let snapshot = await a.call(`/rooms/${roomId}`)
await b.call(`/invites/${snapshot.room.inviteCode}`, 'POST', { sharingConsent: true })
for (const client of [a, b]) {
  snapshot = await client.call(`/rooms/${roomId}`)
  await client.call(`/rooms/${roomId}/preparation`, 'PUT', {
    height: 175,
    weight: 80,
    version: snapshot.room.version,
  })
}
const preview = await a.call(`/rooms/${roomId}/start-preview`)
await a.call(`/rooms/${roomId}/start`, 'POST', {
  version: preview.version,
  date: preview.date,
  expiresAt: preview.expiresAt,
})
snapshot = await a.call(`/rooms/${roomId}`)
const key = randomUUID(),
  body = { date: snapshot.today, weight: 70.005, unit: 'kg', version: 0 }
const first = await a.call(`/rooms/${roomId}/records`, 'PUT', body, key)
const replay = await a.call(`/rooms/${roomId}/records`, 'PUT', body, key)
assert.equal(first.weight, 70.01)
assert.equal(replay.version, 1)
const shared = await b.call(`/rooms/${roomId}`)
assert.equal(shared.members.find((m) => m.todayRecord)?.todayRecord.weight, 70.01)
assert.ok(!JSON.stringify(shared).includes('height'))
for (let i = 0; i < 6; i++)
  await a.call('/me', 'GET', undefined, randomUUID(), secondApi && i % 2 ? secondApi : base)
assert.ok(
  a.instances.has('java-1') && a.instances.has('java-2'),
  'I01 requires observed requests to both real instances',
)
await a.call('/me', 'DELETE', { confirm: '注销并删除我的数据' })
await b.call('/me', 'DELETE', { confirm: '注销并删除我的数据' })
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      scope: 'REAL_JAVA_MYSQL_REDIS_HTTP',
      checks: [
        'J01-part',
        'J04-part',
        'J07-part',
        'J12-part',
        'J13-part',
        'J17-part',
        'J18-part',
        'J25-part',
        'I01-part',
      ],
      instances: [...a.instances].filter(Boolean),
    },
    null,
    2,
  ),
)
