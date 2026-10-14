// Live synthetic environment acceptance. Accounts 7/8 are reserved for QA.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = new URL(process.argv[2]).origin;
if (!origin.startsWith('https://')) throw new Error('Use the real HTTPS test URL.');
const instructions = await readFile(resolve('var/test/体验账号.md'), 'utf8');
const codes = [...instructions.matchAll(/`([A-Za-z0-9_-]{24})`/g)].map(m => m[1]);
assert.equal(codes.length, 8);
const qaStart = Number(process.env.QA_ACCOUNT_START || 7);
assert.ok([5, 7].includes(qaStart), 'Only reserved QA accounts 5/6 or 7/8 may be used.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const contexts = await Promise.all([390, 430].map(width => browser.newContext({ viewport: { width, height: 844 } })));
  const pages = await Promise.all(contexts.map(c => c.newPage())), errors = [];
  for (const page of pages) page.on('pageerror', e => errors.push(e.message));
  const config = await (await contexts[0].request.get(origin + '/api/v1/config')).json();
  assert.equal(config.syntheticOnly, true);
  const me = async page => (await (await page.request.get(origin + '/api/v1/me')).json()).user;
  const snapshot = async (page, id) => (await (await page.request.get(origin + '/api/v1/rooms/' + id)).json());
  async function login(page, code, url = origin + '/#login') {
    await page.goto(url);
    if (url.includes('?invite=')) {
      await page.locator('[name=sharingConsent]').check();
      if (await page.locator('[name=height]').count()) {
        await page.locator('[name=height]').fill('175'); await page.locator('[name=weight]').fill('70');
      }
      await page.getByRole('button', { name: '确认加入', exact: true }).click();
    }
    await page.locator('form[data-form=test-login] [name=code]').fill(code);
    await page.getByRole('button', { name: '进入测试', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('form[data-form="test-login"]'));
    if (await page.locator('form[data-form=profile]').count()) {
      await page.locator('[name=adult]').check(); await page.locator('[name=sensitiveConsent]').check();
      await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    }
    await page.waitForFunction(() => !document.querySelector('form[data-form="profile"]'));
    return me(page);
  }
  const [a, b] = pages;
  let first = await login(a, codes[qaStart - 1]);
  if (first.currentRoomId) await a.getByRole('button', { name: '返回当前小组', exact: true }).click();
  else {
    await a.getByRole('button', { name: '创建小组', exact: true }).click();
    await a.locator('[name=name]').fill('联机验收小组');
    await a.getByRole('button', { name: '28天', exact: true }).click();
    await a.getByRole('button', { name: '创建', exact: true }).click();
    await a.locator('#create-sharing').check();
    await a.getByRole('button', { name: '确认创建', exact: true }).click();
  }
  await a.waitForURL(/#(lobby|group)\?/);
  first = await me(a); const id = first.currentRoomId;
  await a.getByRole('button', { name: /邀请好友|^邀请 ↗$/ }).click();
  const invitation = await a.locator('.invite-link').innerText();
  assert.ok(invitation.startsWith(origin + '/?invite='));
  await a.getByRole('button', { name: '关闭', exact: true }).click();
  console.log('PASS first independent identity: login, create group and HTTPS invitation');

  const second = await login(b, codes[qaStart], invitation);
  if (second.currentRoomId !== id) {
    await b.locator('[name=sharingConsent]').check();
    if (await b.locator('[name=height]').count()) {
      await b.locator('[name=height]').fill('175'); await b.locator('[name=weight]').fill('70');
    }
    await b.getByRole('button', { name: '确认加入', exact: true }).click();
  } else await b.goto(origin + '/#lobby?room=' + id);
  await b.waitForURL(/#(lobby|group)\?/);
  assert.notEqual(first.id, second.id);
  console.log('PASS second independent identity: invitation → login → consent → join same group');

  let state = await snapshot(a, id);
  if (state.room.status === 'LOBBY') {
    for (const [page, weight] of [[a, '80'], [b, '70']]) {
      await page.reload();
      await page.getByRole('button', { name: /填写并准备|修改身高体重/ }).click();
      await page.locator('#prepare-form [name=height]').fill('175');
      await page.locator('#prepare-form [name=weight]').fill(weight);
      await page.getByRole('button', { name: '确认目标并准备', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#prepare-form'));
    }
    await a.reload(); await a.getByRole('button', { name: '开始本期', exact: true }).click();
    await a.getByRole('button', { name: '确认开始', exact: true }).click();
    await a.waitForURL(/#group\?/);
  }
  await b.goto(origin + '/#group?room=' + id);
  console.log('PASS both prepare, owner confirms start, second identity sees active period');

  for (const [page, weight] of [[a, '70'], [b, '60']]) {
    await page.getByRole('button', { name: '记录', exact: true }).click();
    await page.locator('[name=weight]').fill(weight);
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    if (await page.getByRole('button', { name: '确认修改', exact: true }).isVisible()) await page.getByRole('button', { name: '确认修改', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '记录已保存');
  }
  await a.getByRole('button', { name: '数据', exact: true }).click();
  await a.getByRole('button', { name: '体重', exact: true }).click();
  await a.waitForFunction(() => document.querySelector('.group-values')?.textContent.includes('70.00') && document.querySelector('.group-values')?.textContent.includes('60.00'), null, { timeout: 15000 });
  state = await snapshot(b, id);
  assert.equal(state.members.find(m => m.id === first.id).records.at(-1).weight, 70);
  assert.equal(state.members.find(m => m.id === second.id).records.at(-1).weight, 60);
  await mkdir(resolve('docs/evidence'), { recursive: true });
  await a.screenshot({ path: resolve('docs/evidence/online-shared-data.png'), fullPage: true });
  console.log('PASS both record → live shared chart → other-session API sees persisted values');

  await a.getByRole('button', { name: '小组', exact: true }).click();
  await a.getByRole('button', { name: '返回首页', exact: true }).click();
  await a.getByRole('button', { name: '账号与支持', exact: true }).click();
  await a.getByRole('button', { name: '退出登录', exact: true }).click();
  await a.waitForFunction(() => document.querySelector('.hero-home') && !document.querySelector('button[data-busy]'));
  await login(a, codes[qaStart - 1]);
  const recovered = await me(a); assert.equal(recovered.id, first.id); assert.equal(recovered.currentRoomId, id);
  assert.equal((await snapshot(a, id)).members.find(m => m.id === first.id).records.at(-1).weight, 70);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS logout + re-login restores same identity, group and record; zero uncaught browser errors');
  console.log('Accepted HTTPS test URL: ' + origin);
} finally { await browser.close(); }
