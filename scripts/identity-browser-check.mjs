// Isolated mobile identity validation; no real SMS or existing user database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createApplication } from '../apps/api/server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const app = createApplication(); let browser;
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port, api = app.service;
  const phone = '13960000999', otp = await api.requestCode({ phone }, phone);
  const login = api.login({ phone, code: otp.developmentCode }, phone), user = api.authenticate(login.token);
  api.updateProfile(user, { nickname: '原昵称', adult: true, sensitiveConsent: true }, randomUUID());
  const id = api.createRoom(user, { name: '晚饭后散步小队', days: 14, intensity: '低', sharingConsent: true }, randomUUID()).roomId;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'cq_session', value: login.token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/#lobby?room=' + id);
  const edit = page.getByRole('button', { name: '编辑我的昵称与头像', exact: true }); await edit.waitFor();
  await edit.click(); await page.locator('[name=nickname]').fill('取消的昵称');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(api.me(user).user.nickname, '原昵称');
  await edit.click(); await page.locator('[name=nickname]').fill('橘子散步员');
  await page.getByRole('radio', { name: '头像 🍊', exact: true }).check();
  assert.equal(await page.locator('[data-avatar-preview]').textContent(), '🍊');
  // A failed request must preserve the draft and selection for retry.
  let failOnce = true;
  await page.route('**/api/v1/me', async route => {
    if (route.request().method() === 'PATCH' && failOnce) { failOnce = false; await route.abort(); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存名片', exact: true }).click();
  await page.locator('#modal-error').filter({ hasText: /尚未确认保存结果/ }).waitFor();
  assert.equal(await page.locator('[name=nickname]').inputValue(), '橘子散步员');
  assert.equal(await page.getByRole('radio', { name: '头像 🍊', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '保存名片', exact: true }).click();
  await page.getByText('名片已更新', { exact: true }).waitFor();
  assert.equal(api.me(user).user.nickname, '橘子散步员'); assert.equal(api.me(user).user.avatar, '🍊');
  await page.reload(); await edit.waitFor(); assert.match(await edit.textContent(), /橘子散步员/);
  assert.match(await page.locator('.member .avatar').textContent(), /🍊/);
  await mkdir('var/qa', { recursive: true });
  await page.screenshot({ path: 'var/qa/identity-lobby-390.png', fullPage: true });
  await edit.click(); await page.screenshot({ path: 'var/qa/identity-sheet-390.png', fullPage: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.modal').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    const box = await page.getByRole('button', { name: '保存名片', exact: true }).boundingBox();
    assert.ok(box.y + box.height <= 844 && box.height >= 44);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, isolated: true, widths: [320,390,430], cancel: true, retry: true, reload: true, persisted: true, realSmsSent: false }));
} finally { await browser?.close(); await app.close(); }
