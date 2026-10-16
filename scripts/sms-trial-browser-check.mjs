// Isolated browser/API/SQLite validation: no real credentials, network SMS or user data.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApplication } from '../apps/api/server.mjs';
import { createAliyunPnvs } from '../apps/api/sms.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = 'https://trial.example';
let sends = 0, checks = 0, browser, failSend = false;
const time = { value: new Date('2026-10-16T03:00:00Z') };
const deliverCode = createAliyunPnvs({ accessKeyId: 'test-id', accessKeySecret: 'test-secret', signName: '测试签名', templateCode: '100001' }, { fetchImpl: async (url, options) => {
  const params = new URL(url).searchParams, send = options.headers['x-acs-action'] === 'SendSmsVerifyCode';
  if (send) sends++; else checks++;
  if (send && failSend) return { ok: false, status: 400, json: async () => ({ Code: 'RESOURCE_NOT_ENOUGH', Message: 'sensitive provider text' }) };
  return { ok: true, status: 200, json: async () => ({ Code: 'OK', Success: true, Model: { OutId: params.get('OutId'), ...(send ? { BizId: 'receipt' } : { VerifyResult: params.get('VerifyCode') === '234567' ? 'PASS' : 'UNKNOWN' }) } }) };
} });
const app = createApplication({ mode: 'sms-trial', publicOrigin: origin, smsMode: 'provider', smsDailyLimit: 10, deliverCode, clock: () => time.value });
try {
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Route the complete HTTPS origin into an isolated local HTTP server, preserving
  // the actual Host/Origin validation, production browser cookies and API behavior.
  await context.route(origin + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: url.pathname + url.search, method: request.method(), headers: { ...request.headers(), host: url.host } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }); req.on('error', reject); req.end(request.postDataBuffer());
    });
    const headers = Object.fromEntries(Object.entries(result.headers).filter(([name]) => !['transfer-encoding', 'connection', 'keep-alive', 'content-length'].includes(name)).map(([name, value]) => [name, Array.isArray(value) ? value.join('\n') : value]));
    await route.fulfill({ status: result.status, headers, body: result.body });
  });
  const page = await context.newPage(), errors = [];
  await page.clock.install({ time: time.value });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/#login');
  await page.locator('[name=phone]').waitFor();
  assert.match(await page.locator('#environment').textContent(), /短信试用/);
  assert.equal(await page.getByText('点击获取验证码会发送真实短信并计费。', { exact: false }).count(), 1);
  await page.locator('[name=phone]').fill('13900009001');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page.getByText('短信请求已受理，请留意手机验证码', { exact: true }).waitFor();
  const sendButton = page.locator('[data-act="send-code"]');
  assert.equal(await sendButton.isDisabled(), true); assert.match(await sendButton.textContent(), /\d+ 秒后重试/);
  await page.clock.fastForward(2000);
  assert.match(await sendButton.textContent(), /5[78] 秒后重试/);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
  assert.equal(await sendButton.isDisabled(), true);
  await page.locator('[name=phone]').fill('13900009002'); assert.equal(await sendButton.isDisabled(), false);
  await page.locator('[name=phone]').fill('13900009001'); assert.equal(await sendButton.isDisabled(), true);
  assert.equal(await page.locator('#development-code').isVisible(), false);
  await page.locator('[name=code]').fill('123456');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('#form-error').filter({ hasText: '验证码无效或已过期' }).waitFor();
  assert.equal(app.store.get('SELECT count(*) n FROM users').n, 0);
  await page.locator('[name=code]').fill('234567');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('[name=nickname]').waitFor();
  const cookies = await context.cookies(); assert.equal(cookies.find(cookie => cookie.name === 'cq_session')?.secure, true);
  await page.locator('[name=nickname]').fill('手机示例');
  await page.locator('[name=adult]').check(); await page.locator('[name=sensitiveConsent]').check();
  await page.getByRole('button', { name: '确认并继续', exact: true }).click();
  await page.getByRole('button', { name: '创建小组', exact: true }).waitFor();
  assert.equal(app.store.get('SELECT count(*) n FROM users').n, 1);
  const originalUser = app.store.get('SELECT id FROM users').id;
  await page.getByRole('button', { name: '账号与支持', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  assert.equal(app.store.get('SELECT count(*) n FROM sessions').n, 0);
  time.value = new Date(time.value.getTime() + 61000); await page.clock.fastForward(61000);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('[name=phone]').fill('13900009001'); assert.equal(await sendButton.isDisabled(), false);
  await sendButton.click(); await page.getByText('短信请求已受理，请留意手机验证码', { exact: true }).waitFor();
  await page.locator('[name=code]').fill('234567'); await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '创建小组', exact: true }).waitFor();
  assert.equal(app.store.get('SELECT id FROM users').id, originalUser);
  await page.getByRole('button', { name: '账号与支持', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  time.value = new Date(time.value.getTime() + 61000); await page.clock.fastForward(61000);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  failSend = true; await sendButton.click();
  await page.locator('#form-error').filter({ hasText: '短信服务余额或套餐额度不足' }).waitFor();
  assert.equal(await sendButton.isDisabled(), true); assert.match(await sendButton.textContent(), /\d+ 秒后重试/);
  assert.ok(!(await page.locator('#form-error').textContent()).includes('保存'));
  time.value = new Date(time.value.getTime() + 13000); await page.clock.fastForward(13000);
  assert.match(await sendButton.textContent(), /4[67] 秒后重试/);
  // A new page has no in-memory countdown; the server's 429 must restore 47 seconds.
  await page.reload(); await page.locator('[name=phone]').fill('13900009001'); await sendButton.click();
  await page.locator('#form-error').filter({ hasText: '请在 47 秒后重新获取' }).waitFor();
  assert.equal(await sendButton.isDisabled(), true); assert.match(await sendButton.textContent(), /47 秒后重试/);
  time.value = new Date(time.value.getTime() + 48000); await page.clock.fastForward(48000);
  assert.equal(await sendButton.isDisabled(), false); assert.equal(await sendButton.textContent(), '获取验证码');
  assert.equal(app.store.get('SELECT count(*) n FROM users').n, 1);
  assert.equal(sends, 3); assert.equal(checks, 3); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, scope: 'ISOLATED_BROWSER_PROVIDER_STUB', viewport: '390x844', sends, checks, createdAccounts: 1, logoutRelogin: true, countdown: true, balanceFailure: true, realSmsSent: false }));
} finally { await browser?.close(); await app.close(); }
