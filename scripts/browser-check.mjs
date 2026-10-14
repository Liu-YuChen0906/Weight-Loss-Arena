// Optional local QA dependency; never uses the development database or user browser.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApplication } from '../apps/api/server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const clock = { now: new Date('2026-10-14T03:00:00Z') };
const app = createApplication({ clock: () => clock.now });
let browser;
try {
  await new Promise((yes, no) => { app.server.once('error', no); app.server.listen(0, '127.0.0.1', yes); });
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const api = app.service, users = [];
  for (const phone of ['13960000001', '13960000002']) {
    const otp = await api.requestCode({ phone }, phone), login = api.login({ phone, code: otp.developmentCode }, phone), user = api.authenticate(login.token);
    api.updateProfile(user, { nickname: users.length ? '组员乙' : '组员甲', adult: true, sensitiveConsent: true }, randomUUID());
    users.push({ user, token: login.token });
  }
  const id = api.createRoom(users[0].user, { name: '稳定性验收', days: 28, intensity: '低', sharingConsent: true }, randomUUID()).roomId;
  api.joinRoom(users[1].user, api.snapshot(users[0].user, id).room.inviteCode, { sharingConsent: true }, randomUUID());
  for (const { user } of users) api.prepare(user, id, { height: 175, weight: 80, version: api.snapshot(user, id).room.version }, randomUUID());
  api.startRoom(users[0].user, id, api.startPreview(users[0].user, id), randomUUID());
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'cq_session', value: users[0].token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/#record?room=' + id);
  const input = page.locator('[name=weight]'), save = page.getByRole('button', { name: '保存记录', exact: true });
  await input.waitFor();

  // The server commits, but the browser receives an incomplete success response.
  let lose = true;
  const loseResponse = async route => {
    if (route.request().method() !== 'PUT' || !lose) { await route.continue(); return; }
    lose = false; const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
  };
  await page.route('**/records', loseResponse);
  await input.fill('70'); await save.click();
  await page.getByRole('button', { name: '核对保存结果', exact: true }).waitFor();
  assert.equal(await input.inputValue(), '70.00'); assert.equal(await input.getAttribute('readonly'), '');
  assert.equal(app.store.get('SELECT version FROM records').version, 1);
  await page.getByRole('button', { name: '数据', exact: true }).click();
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '核对保存结果', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.record-save button')?.textContent === '保存记录' && !document.querySelector('[name=weight]').readOnly);
  assert.equal(app.store.get('SELECT version FROM records').version, 1);
  await page.unroute('**/records', loseResponse);
  console.log('PASS lost response → navigation → explicit retry: one committed record, input preserved');

  // Truly offline: there is no commit until the original request is retried online.
  await context.setOffline(true);
  await input.fill('69'); await save.click();
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.getByRole('button', { name: '核对保存结果', exact: true }).waitFor();
  assert.equal(app.store.get('SELECT weight FROM records').weight, 70);
  await context.setOffline(false);
  await page.getByRole('button', { name: '核对保存结果', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.record-save button')?.textContent === '保存记录');
  assert.equal(app.store.get('SELECT weight FROM records').weight, 69);
  assert.equal(app.store.get('SELECT version FROM records').version, 2);
  console.log('PASS offline overwrite → online retry: no early write, original confirmed input saved');

  // A second device edits while the first device's confirmation is open.
  await input.fill('68'); await save.click();
  await page.getByRole('button', { name: '确认修改', exact: true }).waitFor();
  clock.now = new Date('2026-10-14T03:01:01Z');
  const otp = await api.requestCode({ phone: '13960000001' }, 'second-device');
  const secondLogin = api.login({ phone: '13960000001', code: otp.developmentCode }, 'second-device');
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await secondContext.addCookies([{ name: 'cq_session', value: secondLogin.token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const secondPage = await secondContext.newPage();
  secondPage.on('pageerror', error => errors.push(error.message));
  await secondPage.goto(origin + '/#record?room=' + id);
  await secondPage.locator('[name=weight]').fill('67');
  await secondPage.getByRole('button', { name: '保存记录', exact: true }).click();
  await secondPage.getByRole('button', { name: '确认修改', exact: true }).click();
  await secondPage.waitForFunction(() => document.querySelector('#toast')?.textContent === '记录已保存');
  await secondContext.close();
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  assert.equal(await input.inputValue(), '68.00');
  assert.equal(app.store.get('SELECT weight FROM records').weight, 67);
  await save.click(); await page.getByRole('dialog').waitFor();
  assert.match(await page.locator('.record-edit-before').innerText(), /67\.00/);
  assert.match(await page.locator('.record-edit-after').innerText(), /68\.00/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(app.store.get('SELECT weight FROM records').weight, 67);
  console.log('PASS concurrent edit: latest old value shown on reconfirmation, cancel does not write');

  // Midnight preserves the draft and requires a new explicit save for the new day.
  clock.now = new Date('2026-10-14T16:00:00Z');
  await save.click(); await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('已切换到今天'));
  assert.equal(await input.inputValue(), '68.00');
  assert.equal(app.store.get('SELECT count(*) n FROM records').n, 1);
  await save.click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '记录已保存');
  assert.equal(app.store.get('SELECT weight FROM records WHERE date=?', '2026-10-15').weight, 68);
  console.log('PASS Beijing midnight: no silent next-day write, draft retained until explicit save');

  // A known successful write followed by a failed read must still be shown as saved.
  const failRead = route => route.abort();
  await page.route('**/api/v1/me', failRead);
  await input.fill('66'); await save.click(); await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '记录已保存，数据同步暂时中断');
  assert.equal(await input.getAttribute('readonly'), null);
  assert.equal(app.store.get('SELECT weight FROM records WHERE date=?', '2026-10-15').weight, 66);
  await page.unroute('**/api/v1/me', failRead);
  console.log('PASS committed write + failed sync: saved state remains known');

  for (const width of [375, 390, 430, 1136]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '斤', exact: true }).click();
  assert.equal(await input.inputValue(), '132.00');
  assert.equal(app.store.get('SELECT version FROM records WHERE date=?', '2026-10-15').version, 2);
  const evidence = resolve('docs/evidence'); await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => innerWidth === 390 && document.querySelector('.nav').getBoundingClientRect().bottom <= innerHeight);
  console.log('Layout:', await page.evaluate(() => ({ headings: [...document.querySelectorAll('h1')].map(n => n.textContent), nav: document.querySelector('.nav').getBoundingClientRect().toJSON(), save: document.querySelector('.record-save').getBoundingClientRect().toJSON(), mainCount: document.querySelectorAll('main').length })));
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('.record-save').getBoundingClientRect().bottom <= document.querySelector('.nav').getBoundingClientRect().top), true);
  // Reload after desktop/mobile viewport changes to capture a fresh compositor frame.
  await page.reload(); await input.waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: resolve(evidence, 'stability-record.png'), animations: 'disabled' });
  console.log('PASS 375/390/430/1136 CSS px: no horizontal overflow; reduced-motion unit toggle does not save');

  // The normal poll must remove cached private data after server-side revocation.
  api.deleteAccount(users[0].user, { confirm: '注销并删除我的数据' });
  await page.waitForURL('**/#login', { timeout: 12000 });
  assert.equal(await page.locator('.record-form').count(), 0);
  assert.equal(await page.locator('.nav-track').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS revoked session: private page removed; zero uncaught browser exceptions');
} finally { await browser?.close(); await app.close(); }
