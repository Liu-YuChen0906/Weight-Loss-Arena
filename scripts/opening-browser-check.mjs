// Isolated opening-state QA. Preparation values must never create daily records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createApplication } from '../apps/api/server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const clock = { now: new Date('2026-10-16T03:00:00Z') };
const app = createApplication({ clock: () => clock.now }); let browser;
try {
  await new Promise((yes, no) => { app.server.once('error', no); app.server.listen(0, '127.0.0.1', yes); });
  const origin = 'http://127.0.0.1:' + app.server.address().port, api = app.service, users = [];
  for (const phone of ['13960000801', '13960000802']) {
    const otp = await api.requestCode({ phone }, phone), login = api.login({ phone, code: otp.developmentCode }, phone), user = api.authenticate(login.token);
    api.updateProfile(user, { nickname: users.length ? '散步小橘' : '今天也好好吃饭', adult: true, sensitiveConsent: true }, randomUUID());
    users.push({ user, token: login.token });
  }
  const id = api.createRoom(users[0].user, { name: '一起慢慢来', days: 28, intensity: '低', sharingConsent: true }, randomUUID()).roomId;
  api.joinRoom(users[1].user, api.snapshot(users[0].user, id).room.inviteCode, { sharingConsent: true }, randomUUID());
  for (const [i, { user }] of users.entries()) api.prepare(user, id, { height: 175, weight: i ? 68.5 : 108.25, version: api.snapshot(user, id).room.version }, randomUUID());
  api.startRoom(users[0].user, id, api.startPreview(users[0].user, id), randomUUID());
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'cq_session', value: users[0].token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await mkdir('output/opening', { recursive: true });
  for (const width of [320, 390, 430, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['group', 'data', 'analysis/' + users[0].user.id]) {
      await page.goto(origin + '/#' + route + '?room=' + id);
      await page.locator('.member, [data-chart-content]').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflow at ${width}`);
      assert.doesNotMatch(await page.locator('main').innerText(), /数据不足|暂无数据/);
      await page.screenshot({ path: `output/opening/${width}-${route.split('/')[0]}.png`, fullPage: true });
    }
  }
  console.log('PASS layouts');
  assert.match(await page.locator('main').innerText(), /108.25/);
  await page.locator('.chart circle').click();
  assert.match(await page.locator('#toast').innerText(), /起始体重/);
  assert.equal(api.snapshot(users[0].user, id).members[0].summary.count, 0);
  assert.equal(app.store.get('SELECT count(*) n FROM records').n, 0);
  await page.goto(origin + '/#record?room=' + id);
  await page.locator('[name=weight]').fill('107.9');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '记录已保存');
  await page.goto(origin + '/#group?room=' + id); await page.locator('.member').first().waitFor();
  assert.equal(await page.locator('.starting-card').count(), 0);
  assert.match(await page.locator('.member').first().innerText(), /107.90/);
  assert.match(await page.locator('.member').first().innerText(), /首次记录/);
  const snap = api.snapshot(users[0].user, id); assert.equal(snap.members[0].summary.count, 1); assert.equal(snap.members[0].summary.change, null);
  await page.goto(origin + '/#analysis/' + users[0].user.id + '?room=' + id); await page.locator('.chart circle').waitFor();
  assert.equal(await page.locator('.chart circle').count(), 1); // Same-day actual reading replaces display baseline.
  console.log('PASS preceding scenario');
  clock.now = new Date('2026-10-17T03:00:00Z');
  await page.reload(); await page.locator('.chart circle').waitFor();
  assert.match(await page.locator('main').innerText(), /50/); // One real record over two days.
  console.log('PASS preceding scenario');
  clock.now = new Date('2026-10-25T03:00:00Z');
  const renewedOtp = await api.requestCode({ phone: '13960000801' }, 'renew');
  const renewed = api.login({ phone: '13960000801', code: renewedOtp.developmentCode }, 'renew');
  await context.addCookies([{ name: 'cq_session', value: renewed.token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await page.reload(); await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-chart-content]')?.textContent.includes('还没有记录'));
  assert.equal(await page.locator('.chart circle').count(), 0); // No stale baseline moved into selected range.
  assert.deepEqual(errors, []);
  console.log('PASS opening layouts 320/390/430/1024; baseline tooltip; no synthetic writes; first save; same-day replacement; next-day coverage; range boundaries');
} finally { await browser?.close(); await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
