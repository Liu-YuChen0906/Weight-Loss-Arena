import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';
import { createService } from './service.mjs';
import { AppError, ensure } from '../../packages/contracts/index.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const staticFiles = { '/': ['apps/web/index.html', 'text/html'], '/app.js': ['apps/web/app.js', 'text/javascript'], '/request.mjs': ['apps/web/request.mjs', 'text/javascript'], '/styles.css': ['apps/web/styles.css', 'text/css'], '/packages/domain/index.mjs': ['packages/domain/index.mjs', 'text/javascript'], '/packages/contracts/index.mjs': ['packages/contracts/index.mjs', 'text/javascript'] };
async function jsonBody(req) {
  ensure(req.headers['content-type']?.startsWith('application/json'), 'CONTENT_TYPE', '请使用 JSON 请求', 415);
  let raw = '';
  for await (const chunk of req) { raw += chunk; ensure(Buffer.byteLength(raw) <= 16384, 'BODY_TOO_LARGE', '请求内容过长', 413); }
  try { const data = JSON.parse(raw || '{}'); ensure(data && typeof data === 'object' && !Array.isArray(data), 'INVALID_JSON', '请求格式不正确'); return data; } catch (e) { if (e instanceof AppError) throw e; throw new AppError('INVALID_JSON', '请求格式不正确'); }
}
const sessionToken = req => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('cq_session='))?.slice(11);
export function createApplication({ databasePath = ':memory:', clock, smsMode = 'development', deliverCode } = {}) {
  const store = openStore(databasePath), service = createService(store, { clock, smsMode, deliverCode });
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Request-Id', requestId);
    const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ...data, requestId })); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const host = req.headers.host || '';
      ensure(/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host), 'HOST_REJECTED', '此开发版仅允许本机访问', 403);
      if (!url.pathname.startsWith('/api/')) {
        ensure(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', '请求方式不支持', 405);
        const file = staticFiles[url.pathname]; ensure(file, 'NOT_FOUND', '页面不存在', 404);
        const content = await readFile(resolve(root, file[0])); res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      service.expire();
      const write = !['GET', 'HEAD'].includes(req.method);
      if (write) {
        ensure(req.headers['x-app-request'] === '1', 'CSRF_REJECTED', '请求来源无效', 403);
        if (req.headers.origin) ensure(req.headers.origin === 'http://' + host, 'CSRF_REJECTED', '请求来源无效', 403);
        ensure(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'CSRF_REJECTED', '请求来源无效', 403);
      }
      const body = write ? await jsonBody(req) : {}, key = req.headers['idempotency-key'];
      // Reading a streamed body can cross midnight or the session/period deadline.
      service.expire();
      const route = req.method + ' ' + url.pathname, ip = req.socket.remoteAddress || 'local';
      if (route === 'GET /api/v1/health') { send({ ok: true, storage: store.get('SELECT 1 ok').ok === 1, mode: smsMode }); return; }
      if (route === 'POST /api/v1/auth/code') { send(await service.requestCode(body, ip)); return; }
      if (route === 'POST /api/v1/auth/login') {
        const result = service.login(body, ip);
        res.setHeader('Set-Cookie', `cq_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
        send({ user: result.user }); return;
      }
      const invite = url.pathname.match(/^\/api\/v1\/invites\/([^/]+)$/);
      if (invite && req.method === 'GET') { send({ invite: service.getInvite(invite[1], ip) }); return; }
      const token = sessionToken(req), user = service.authenticate(token);
      if (write) ensure(req.headers['x-csrf-token'] === user.csrf, 'CSRF_REJECTED', '会话已变化，请刷新后重试', 403);
      if (route === 'GET /api/v1/me') send(service.me(user));
      else if (route === 'PATCH /api/v1/me') send(service.updateProfile(user, body, key));
      else if (route === 'POST /api/v1/auth/logout') { service.logout(token); res.setHeader('Set-Cookie', 'cq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); send({ ok: true }); }
      else if (route === 'POST /api/v1/rooms') send(service.createRoom(user, body, key));
      else if (invite && req.method === 'POST') send(service.joinRoom(user, invite[1], body, key));
      else if (route === 'GET /api/v1/history') send({ rooms: service.history(user) });
      else if (route === 'GET /api/v1/me/export') { res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"'); send(service.exportData(user)); }
      else if (route === 'DELETE /api/v1/me') { const result = service.deleteAccount(user, body); res.setHeader('Set-Cookie', 'cq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); send(result); }
      else if (route === 'POST /api/v1/support') send(service.support(user, body, key));
      else if (route === 'GET /api/v1/support') send({ requests: service.supportList(user) });
      else {
        const match = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)(?:\/(preparation|start-preview|start|records|leave|reminders))?$/);
        ensure(match, 'NOT_FOUND', '接口不存在', 404);
        const [, roomId, operation] = match;
        if (!operation && req.method === 'GET') send(service.snapshot(user, roomId, Number(url.searchParams.get('range') || 28)));
        else if (!operation && req.method === 'PATCH') send(service.editRoom(user, roomId, body, key));
        else if (operation === 'preparation' && req.method === 'GET') send(service.preparation(user, roomId));
        else if (operation === 'preparation' && req.method === 'PUT') send(service.prepare(user, roomId, body, key));
        else if (operation === 'start-preview' && req.method === 'GET') send(service.startPreview(user, roomId));
        else if (operation === 'start' && req.method === 'POST') send(service.startRoom(user, roomId, body, key));
        else if (operation === 'records' && req.method === 'PUT') send(service.saveRecord(user, roomId, body, key));
        else if (operation === 'leave' && req.method === 'POST') send(service.leaveRoom(user, roomId, body, key));
        else if (operation === 'reminders' && req.method === 'GET') send({ reminders: service.reminders(user, roomId) });
        else if (operation === 'reminders' && req.method === 'POST') send(service.acknowledgeReminders(user, roomId, body, key));
        else throw new AppError('METHOD_NOT_ALLOWED', '请求方式不支持', 405);
      }
    } catch (error) {
      if (!(error instanceof AppError)) console.error(JSON.stringify({ requestId, error: error.name }));
      if (!res.headersSent) send({ error: { code: error.code || 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '服务暂时不可用，请重试', details: error instanceof AppError ? error.details : undefined } }, error.status || 500);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const worker = setInterval(() => { try { service.expire(); } catch { console.error('Expiration job failed'); } }, 30000); worker.unref();
  return { server, service, store, async close() { clearInterval(worker); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.NODE_ENV === 'production' || (process.env.SMS_MODE && process.env.SMS_MODE !== 'development')) throw new Error('This build is local-only. Production SMS, data policy and deployment gates must be completed before public launch.');
  const app = createApplication({ databasePath: process.env.DATABASE_PATH || resolve(root, 'var/development.sqlite') });
  app.server.listen(Number(process.env.PORT || 4180), host, () => console.log(`秤群结队 · 本地开发 http://${host}:${app.server.address().port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
