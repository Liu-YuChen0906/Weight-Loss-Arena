#!/usr/bin/env node
// Real UI → Java → MySQL/Redis check in isolated local mode. No request mocks.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.BASE_URL || 'http://localhost:5173'
const out = new URL('../../java-rebuild/evidence/browser-live/', import.meta.url)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const contexts = [],
  accounts = [],
  checks = [],
  errors = []
const pages = []
let failure
async function call(context, path, method = 'GET', body, csrf) {
  const headers = { 'X-App-Request': '1', Origin: base, 'Idempotency-Key': randomUUID() }
  if (csrf) headers['X-CSRF-Token'] = csrf
  const response = await context.request.fetch(`${base}/api/v1${path}`, {
    method,
    data: body,
    headers,
  })
  assert.equal(response.status(), 200, `${method} ${path}: ${await response.text()}`)
  return response.json()
}
async function account(phone, nickname) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  contexts.push(context)
  const config = await call(context, '/config')
  assert.equal(config.mode, 'local')
  assert.equal(config.realSms, false)
  const dispatch = await call(context, '/auth/code', 'POST', { phone })
  assert.equal(dispatch.deliveryStatus, 'DEVELOPMENT')
  const login = await call(context, '/auth/login', 'POST', {
    phone,
    code: dispatch.developmentCode,
  })
  const record = { context, csrf: login.user.csrf }
  accounts.push(record)
  await call(
    context,
    '/me/profile',
    'POST',
    { nickname, avatar: '🌱', adult: true, sensitiveConsent: true },
    record.csrf,
  )
  const page = await context.newPage()
  pages.push(page)
  return { ...record, page, user: login.user }
}
try {
  const suffix = String(Date.now() % 100000000).padStart(8, '0')
  const a = await account(`139${suffix}`, '合成浏览甲'),
    b = await account(`138${suffix}`, '合成浏览乙')
  for (const actor of [a, b]) actor.page.on('pageerror', (e) => errors.push(e.message))
  await a.page.goto(base)
  await a.page.getByRole('button', { name: '创建一个小组', exact: true }).click()
  await a.page.getByRole('button', { name: '下一步，确认创建' }).click()
  await a.page.getByRole('dialog').locator('input[type=checkbox]').check()
  await a.page.getByRole('button', { name: '确认创建', exact: true }).click()
  await a.page.getByRole('heading', { name: '同行的朋友', exact: true }).waitFor()
  const roomId = new URLSearchParams(new URL(a.page.url()).hash.split('?')[1]).get('room')
  const snapshot = await call(a.context, `/rooms/${roomId}`)
  await b.page.goto(`${base}/?invite=${snapshot.room.inviteCode}`)
  await b.page.getByRole('checkbox').check()
  await b.page.getByRole('button', { name: '确认加入小组', exact: true }).click()
  await b.page.getByRole('heading', { name: '同行的朋友', exact: true }).waitFor()
  for (const actor of [a, b]) {
    await actor.page.reload()
    await actor.page.getByRole('button', { name: '填写身高体重', exact: true }).click()
    const dialog = actor.page.getByRole('dialog')
    await dialog.locator('input[type=number]').nth(0).fill('175')
    await dialog.locator('input[type=number]').nth(1).fill('80')
    await dialog.getByRole('button', { name: '确认准备', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  await a.page.reload()
  await a.page.getByRole('button', { name: '确认开始本期', exact: true }).click()
  await a.page.getByRole('button', { name: '正式开始', exact: true }).click()
  await a.page.getByRole('button', { name: '去记录', exact: true }).click()
  await a.page.getByLabel('今天的体重', { exact: true }).fill('79.25')
  await a.page.getByRole('button', { name: '保存今天的记录', exact: true }).click()
  await a.page.getByText('今天的记录已保存', { exact: true }).waitFor()
  const shared = await call(b.context, `/rooms/${roomId}`)
  assert.equal(shared.members.find((m) => m.userId === a.user.id).todayRecord.weight, 79.25)
  await a.page
    .getByRole('navigation', { name: '小组导航' })
    .getByRole('button', { name: '记录', exact: true })
    .click()
  await a.page.getByLabel('今天的体重', { exact: true }).fill('79.10')
  await a.page.getByRole('button', { name: '修改今日记录', exact: true }).click()
  await a.page.getByRole('dialog').getByRole('button', { name: '确认修改', exact: true }).click()
  await a.page.getByRole('dialog').waitFor({ state: 'hidden' })
  const updated = await call(b.context, `/rooms/${roomId}`)
  assert.equal(updated.members.find((m) => m.userId === a.user.id).todayRecord.version, 2)
  await a.page
    .getByRole('navigation', { name: '小组导航' })
    .getByRole('button', { name: '数据', exact: true })
    .click()
  await a.page.getByRole('heading', { name: '一起，看见变化', exact: true }).waitFor()
  for (const width of [320, 375, 390, 430, 1024]) {
    await a.page.setViewportSize({ width, height: 844 })
    await a.page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, {
      timeout: 3000,
    })
    checks.push(`data-width-${width}`)
  }
  await a.page.setViewportSize({ width: 390, height: 844 })
  await a.page.screenshot({ path: new URL('data-390.png', out).pathname, fullPage: true })
  assert.deepEqual(errors, [])
  checks.push('real-login-profile-create-invite-two-preparations-start-record-overwrite-peer-read')
  checks.push('no-page-errors')
} catch (e) {
  failure = e
  for (let i = 0; i < pages.length; i++) {
    try {
      await pages[i].screenshot({ path: new URL(`failure-${i}.png`, out).pathname, fullPage: true })
      const visibleErrors = await pages[i]
        .locator('.error-message,.sheet-error,.notice')
        .allTextContents()
      console.error(JSON.stringify({ actor: i, errors: visibleErrors }))
    } catch {}
  }
} finally {
  for (const a of accounts)
    try {
      await call(a.context, '/me', 'DELETE', { confirm: '注销并删除我的数据' }, a.csrf)
    } catch (e) {
      failure ||= e
    }
  await writeFile(
    new URL('results.json', out),
    JSON.stringify(
      {
        scope: 'REAL_UI_JAVA_MYSQL_REDIS',
        status: failure ? 'FAIL' : 'PASS',
        checks,
        error: failure?.message || null,
      },
      null,
      2,
    ),
  )
  for (const c of contexts) await c.close()
  await browser.close()
}
if (failure) throw failure
console.log(JSON.stringify({ status: 'PASS', scope: 'REAL_UI_JAVA_MYSQL_REDIS', checks }, null, 2))
