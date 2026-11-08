#!/usr/bin/env node
// UI-only verification using explicit synthetic HTTP fixtures. Does NOT validate Java or persistence.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = new URL('../../java-rebuild/evidence/browser-ui/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const results = []
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const date = '2026-10-29'
  let user = null,
    status = 'LOBBY',
    version = 1,
    recorded = null,
    recordCalls = [],
    loseResponse = true
  let created = false
  const makeMember = (id, name, own = false) => {
    const row = own ? recorded : null
    const summary = {
      start: date,
      anchor: date,
      count: row ? 1 : 0,
      denominator: 1,
      coverage: row ? 100 : 0,
      first: row?.weight ?? null,
      latest: row,
      change: null,
      rows: row ? [{ ...row, change: 0, percent: 0 }] : [],
    }
    return {
      id,
      userId: id,
      memberId: `member-${id}`,
      nickname: name,
      avatar: own ? '🌱' : '🐱',
      ready: true,
      startWeight: 80,
      target: 79.01,
      joinDate: date,
      summary: status === 'LOBBY' ? null : summary,
      periodSummary: summary,
      points: row
        ? [{ ...row, change: 0, percent: 0 }]
        : [{ date, weight: 80, source: 'preparation', change: null, percent: null }],
      records: summary.rows,
      missingDays: row ? 0 : 1,
      todayRecord: row,
    }
  }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace('/api/v1', ''),
      method = request.method()
    let body = {},
      response = {},
      statusCode = 200
    try {
      body = request.postDataJSON() || {}
    } catch {}
    if (path === '/config')
      response = { mode: 'local', login: 'phone', syntheticOnly: true, realSms: false }
    else if (path === '/me' && method === 'GET') {
      if (!user) {
        statusCode = 401
        response = { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }
      } else response = { user, today: date }
    } else if (path === '/auth/code')
      response = { developmentCode: '654321', retryAfter: 60, deliveryStatus: 'DEVELOPMENT' }
    else if (path === '/auth/login') {
      user = {
        id: 'synthetic-a',
        nickname: '合成甲',
        avatar: '🌱',
        consent: false,
        phone: '139****1001',
        currentRoomId: null,
        csrf: 'ui-fixture-token',
      }
      response = { user }
    } else if (path === '/me/profile') {
      user = { ...user, nickname: body.nickname, avatar: body.avatar, consent: true }
      response = { ok: true }
    } else if (path === '/rooms' && method === 'POST') {
      created = true
      user.currentRoomId = 'synthetic-room'
      response = { roomId: user.currentRoomId }
    } else if (path === '/rooms/synthetic-room')
      response = {
        room: {
          id: 'synthetic-room',
          name: '晚饭后散步小队',
          intro: '一起慢慢来，记录每一个平常的日子。',
          days: 14,
          intensity: '低',
          ownerId: 'synthetic-a',
          version,
          status,
          inviteCode: 'A1B2C3D4E5F6',
          startDate: status === 'LOBBY' ? null : date,
          endDate: '2026-11-11',
          remaining: 14,
        },
        members: [
          makeMember('synthetic-a', user?.nickname || '合成甲', true),
          makeMember('synthetic-b', '合成乙'),
        ],
        ranks: { 'synthetic-a': 1, 'synthetic-b': 2 },
        today: date,
        range: 28,
      }
    else if (path.endsWith('/start-preview'))
      response = {
        roomId: 'synthetic-room',
        name: '晚饭后散步小队',
        days: 14,
        intensity: '低',
        version,
        date,
        endDate: '2026-11-11',
        expiresAt: Date.now() + 120000,
      }
    else if (path.endsWith('/start')) {
      status = 'ACTIVE'
      version++
      response = { roomId: 'synthetic-room', startDate: date }
    } else if (path.endsWith('/reminders')) response = { ok: true, date, reminders: [] }
    else if (path.endsWith('/records')) {
      recordCalls.push({ key: request.headers()['idempotency-key'], body })
      if (loseResponse) {
        loseResponse = false
        recorded = { date, weight: body.weight, version: 1 }
        await route.abort('connectionfailed')
        return
      }
      response = recorded
    } else if (path === '/history') response = { rooms: [] }
    else if (path === '/support') response = { requests: [] }
    else {
      statusCode = 404
      response = { error: { code: 'NOT_FOUND', message: path } }
    }
    await route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify(response),
    })
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('heading', { name: '每一天， 都算一点进步。' }).waitFor()
  for (const width of [320, 375, 390, 430, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 950 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `home overflows at ${width}`,
    )
    await page.screenshot({ path: new URL(`home-${width}.png`, output).pathname, fullPage: true })
    results.push({ check: `home-layout-${width}`, status: 'PASS', scope: 'UI_FIXTURES_ONLY' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '创建一个小组', exact: true }).click()
  await page.getByLabel('手机号', { exact: true }).fill('13900001001')
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByText('未发送短信 · 本地模拟验证码').waitFor()
  await page.getByLabel('验证码', { exact: true }).fill('654321')
  await page.getByRole('button', { name: '登录并继续' }).click()
  await page.getByLabel('昵称', { exact: true }).fill('合成小林')
  assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0)
  await page.getByLabel('我确认已年满 18 岁').check()
  await page.locator('input[type=checkbox]').nth(1).check()
  await page.getByRole('button', { name: '确认，继续' }).click()
  await page.getByRole('button', { name: '下一步，确认创建' }).click()
  assert.equal(created, false)
  await page.getByRole('dialog').locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: '确认创建', exact: true }).click()
  await page.getByRole('heading', { name: '同行的朋友', exact: true }).waitFor()
  await page.screenshot({ path: new URL('lobby-390.png', output).pathname, fullPage: true })
  await page.getByRole('button', { name: '确认开始本期' }).click()
  await page.getByRole('button', { name: '正式开始', exact: true }).click()
  await page.getByRole('button', { name: '去记录', exact: true }).click()
  await page.getByLabel('今天的体重', { exact: true }).fill('79.25')
  await page.getByRole('button', { name: '保存今天的记录' }).click()
  await page.getByRole('button', { name: '核对保存结果' }).waitFor()
  assert.equal(await page.getByLabel('今天的体重', { exact: true }).getAttribute('readonly'), '')
  await page.screenshot({
    path: new URL('unknown-record-390.png', output).pathname,
    fullPage: true,
  })
  await page.getByRole('button', { name: '核对保存结果' }).click()
  await page.getByText('今天的记录已保存', { exact: true }).waitFor()
  assert.equal(recordCalls.length, 2)
  assert.deepEqual(recordCalls[0], recordCalls[1])
  results.push({
    check: 'login-consent-create-start-unknown-record-replay',
    status: 'PASS',
    scope: 'UI_FIXTURES_ONLY',
  })
  await page
    .getByRole('navigation', { name: '小组导航' })
    .getByRole('button', { name: '数据', exact: true })
    .click()
  await page.getByRole('heading', { name: '一起，看见变化' }).waitFor()
  for (const width of [320, 375, 390, 430, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, {
      timeout: 3000,
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `data overflows at ${width}`,
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: new URL('data-390.png', output).pathname, fullPage: true })
  assert.equal(await page.evaluate(() => localStorage.length), 0)
  assert.deepEqual(errors, [])
  results.push({
    check: 'data-layout-no-localstorage-no-pageerror',
    status: 'PASS',
    scope: 'UI_FIXTURES_ONLY',
  })
  await context.close()
} finally {
  await writeFile(
    new URL('results.json', output),
    JSON.stringify({ scope: 'UI_FIXTURES_ONLY_NOT_JAVA_E2E', results }, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))
