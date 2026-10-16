import { randomUUID, randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { ensure, text, number, RULES, INTENSITIES, CONSENT_VERSION } from '../../packages/contracts/index.mjs';
import { businessDate, addDays, endDate, remainingDays, calculateGoal, normalizeWeight, stats, rankCoverage, daysBetween } from '../../packages/domain/index.mjs';
import { dispatchCode, verifyProviderCode, SmsDeliveryError } from './sms.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const id = () => randomUUID();
export function createService(store, { clock = () => new Date(), smsMode = 'development', deliverCode, smsTimeoutMs = 8000, smsDailyLimit, testAccounts = [] } = {}) {
  if (!Number.isInteger(smsTimeoutMs) || smsTimeoutMs < 1 || smsTimeoutMs > 15000) throw new Error('Invalid SMS timeout');
  if (smsDailyLimit !== undefined && (!Number.isInteger(smsDailyLimit) || smsDailyLimit < 1 || smsDailyLimit > 20)) throw new Error('Invalid SMS daily limit');
  const { get, all, run, transaction } = store;
  const verifyingPhones = new Set();
  const remoteVerification = smsMode !== 'development' && typeof deliverCode?.verifyCode === 'function';
  const now = () => clock(), stamp = () => now().toISOString(), today = () => businessDate(now());
  function limit(key, max, seconds) {
    const ms = now().getTime(), row = get('SELECT * FROM rate_limits WHERE key=?', key);
    if (!row || row.reset_at <= ms) run('INSERT OR REPLACE INTO rate_limits VALUES(?,1,?)', key, ms + seconds * 1000);
    else { ensure(row.count < max, 'RATE_LIMITED', '操作频繁，请稍后再试', 429); run('UPDATE rate_limits SET count=count+1 WHERE key=?', key); }
  }
  function expire() {
    transaction(() => {
      const ended = all("SELECT id FROM rooms WHERE status='ACTIVE' AND date(start_date, '+' || days || ' days')<=?", today());
      for (const room of ended) {
        run("UPDATE rooms SET status='ENDED', version=version+1 WHERE id=?", room.id);
        run('UPDATE users SET current_room_id=NULL WHERE current_room_id=?', room.id);
      }
      run('DELETE FROM sessions WHERE expires_at<=?', now().getTime());
      run('DELETE FROM otp WHERE expires_at<=?', now().getTime());
      run("UPDATE otp SET delivery_state='UNKNOWN' WHERE delivery_state='PENDING' AND sent_at<=?", now().getTime() - smsTimeoutMs);
      run('DELETE FROM rate_limits WHERE reset_at<=?', now().getTime());
    });
  }
  function authenticate(token) {
    ensure(token && token.length < 200, 'UNAUTHENTICATED', '请先登录', 401);
    const session = get('SELECT s.csrf, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', hash(token), now().getTime());
    ensure(session, 'UNAUTHENTICATED', '登录已过期，请重新登录', 401);
    return session;
  }
  const publicUser = user => ({ id: user.id, nickname: user.nickname, phone: user.phone.startsWith('test:') ? '测试身份' : user.phone.slice(0, 3) + '****' + user.phone.slice(-4), consent: user.consent_version === CONSENT_VERSION, currentRoomId: user.current_room_id, csrf: user.csrf });
  function sessionFor(phone, nickname) {
    let user = get('SELECT * FROM users WHERE phone=?', phone);
    if (!user) {
      const userId = id();
      run('INSERT INTO users(id,phone,nickname,created_at) VALUES(?,?,?,?)', userId, phone, nickname, stamp());
      user = get('SELECT * FROM users WHERE id=?', userId);
    }
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
    run('INSERT INTO sessions VALUES(?,?,?,?)', hash(token), user.id, csrf, now().getTime() + 7 * 86400000);
    return { token, user: publicUser({ ...user, csrf }) };
  }
  function consent(user) { ensure(get('SELECT consent_version FROM users WHERE id=?', user.id)?.consent_version === CONSENT_VERSION, 'CONSENT_REQUIRED', '请确认年龄和数据使用说明', 403); }
  function roomFor(user, roomId) {
    const room = get('SELECT * FROM rooms WHERE id=?', roomId), member = get("SELECT * FROM members WHERE room_id=? AND user_id=? AND state='JOINED'", roomId, user.id);
    ensure(room && member, 'FORBIDDEN', '你没有这个小组的访问权限', 403);
    return { room, member };
  }
  function mutate(user, key, operation, body, action) {
    ensure(typeof key === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(key), 'IDEMPOTENCY_REQUIRED', '缺少有效请求编号');
    return transaction(() => {
      const bodyHash = hash(JSON.stringify(body)), old = get('SELECT * FROM idempotency WHERE user_id=? AND key=?', user.id, key);
      if (old) { ensure(old.operation === operation && old.body_hash === bodyHash, 'IDEMPOTENCY_CONFLICT', '请求编号已用于其他操作', 409); return JSON.parse(old.result); }
      const result = action();
      run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)', user.id, key, operation, bodyHash, JSON.stringify(result), stamp());
      return result;
    });
  }
  function roomDraft(body) {
    const name = text(body.name ?? '', RULES.nameLength, '小组名称', '晚饭后散步小队'), intro = text(body.intro ?? '', RULES.introLength, '介绍');
    const days = number(body.days, 14, 90, '天数', true);
    ensure(Object.hasOwn(INTENSITIES, body.intensity), 'VALIDATION', '请选择强度');
    ensure(body.intensity !== '极高' || body.extremeConfirmed === true, 'EXTREME_CONFIRMATION', '请先确认极高强度');
    return { name, intro, days, intensity: body.intensity };
  }
  function bump(roomId) { run('UPDATE rooms SET version=version+1 WHERE id=?', roomId); }
  function noCurrentRoom(user) { ensure(!get('SELECT current_room_id FROM users WHERE id=?', user.id)?.current_room_id, 'ALREADY_IN_ROOM', '你已在一个未结束小组中', 409); }
  function addMember(user, roomId, ready, goal, body, joinDate) {
    run('INSERT INTO members(id,room_id,user_id,ready,height,start_weight,target,algorithm,join_date,joined_at,consent_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id(), roomId, user.id, ready ? 1 : 0, ready ? body.height : null, ready ? body.weight : null, ready ? goal.target : null, ready ? goal.algorithm : null, joinDate, stamp(), CONSENT_VERSION);
    run('UPDATE users SET current_room_id=? WHERE id=?', roomId, user.id);
  }
  function invitation(code) {
    ensure(typeof code === 'string' && /^[A-F0-9]{12}$/.test(code.toUpperCase()), 'INVITE_INVALID', '邀请码无效或已结束', 404);
    const room = get('SELECT * FROM rooms WHERE invite_code=?', code.toUpperCase());
    ensure(room && ['LOBBY', 'ACTIVE'].includes(room.status), 'INVITE_INVALID', '邀请码无效或已结束', 404);
    const count = get("SELECT count(*) n FROM members WHERE room_id=? AND state='JOINED'", room.id).n;
    const remaining = room.status === 'ACTIVE' ? remainingDays(room, today()) : room.days;
    return { room, count, remaining, joinable: count < 8 && remaining >= 14 };
  }
  function transferOrClose(roomId) {
    const first = get("SELECT user_id FROM members WHERE room_id=? AND state='JOINED' ORDER BY joined_order LIMIT 1", roomId);
    if (!first) run("UPDATE rooms SET status='CANCELLED',version=version+1 WHERE id=? AND status='LOBBY'", roomId);
    else run('UPDATE rooms SET owner_id=?,version=version+1 WHERE id=?', first.user_id, roomId);
  }
  function applyAccountDeletion(userId) {
    const user = get('SELECT phone FROM users WHERE id=?', userId);
    const rooms = all("SELECT r.id,r.status,r.owner_id FROM rooms r JOIN members m ON m.room_id=r.id WHERE m.user_id=? AND m.state='JOINED'", userId);
    if (user) run('DELETE FROM otp WHERE phone=?', user.phone);
    // Other members' cached reminder responses may contain the deleted nickname.
    for (const r of rooms) run('DELETE FROM idempotency WHERE operation=?', 'reminders:' + r.id);
    run('DELETE FROM users WHERE id=?', userId);
    for (const r of rooms) { if (r.status === 'LOBBY' && r.owner_id === userId) transferOrClose(r.id); else bump(r.id); }
  }
  function replayDeletionsInTransaction() {
    const after = get('SELECT last_sequence FROM privacy_meta WHERE id=1').last_sequence;
    for (const event of store.journal.events().filter(e => e.sequence > after)) {
      applyAccountDeletion(event.user_id);
      run('UPDATE privacy_meta SET last_sequence=? WHERE id=1', event.sequence);
    }
  }
  // Replay before any authentication or body-data read becomes available.
  transaction(replayDeletionsInTransaction);
  async function providerLogin(body, otp) {
    ensure(remoteVerification, 'SMS_UNAVAILABLE', '短信核验服务暂不可用，请稍后重试', 503);
    ensure(!verifyingPhones.has(body.phone), 'AUTH_IN_PROGRESS', '正在核验，请稍候', 409);
    verifyingPhones.add(body.phone);
    try {
      run('UPDATE otp SET attempts=attempts+1 WHERE phone=? AND dispatch_id=?', body.phone, otp.dispatch_id);
      let result;
      try { result = await verifyProviderCode(deliverCode.verifyCode, { phone: body.phone, code: body.code, dispatchId: otp.dispatch_id }, smsTimeoutMs); }
      catch {
        // A timed-out check may have consumed the supplier's OTP. Require a new send.
        run("UPDATE otp SET delivery_state='UNKNOWN' WHERE phone=? AND dispatch_id=?", body.phone, otp.dispatch_id);
        ensure(false, 'SMS_VERIFICATION_UNAVAILABLE', '短信核验结果暂未确认，请稍后重新获取验证码', 503);
      }
      ensure(result.status === 'PASS', 'INVALID_CODE', '验证码无效或已过期', 401);
      return transaction(() => {
        const consumed = run("DELETE FROM otp WHERE phone=? AND dispatch_id=? AND delivery_state='ACCEPTED' AND expires_at>?", body.phone, otp.dispatch_id, now().getTime());
        ensure(consumed.changes === 1, 'INVALID_CODE', '验证码无效或已过期', 401);
        return sessionFor(body.phone, '朋友' + body.phone.slice(-4));
      });
    } finally { verifyingPhones.delete(body.phone); }
  }
  const api = {
    expire, authenticate, publicUser,
    async requestCode(body, ip) {
      ensure(typeof body.phone === 'string' && /^1[3-9]\d{9}$/.test(body.phone), 'VALIDATION', '请输入 11 位手机号');
      ensure(smsMode === 'development' || typeof deliverCode === 'function', 'SMS_UNAVAILABLE', '短信服务暂不可用', 503);
      ensure(!verifyingPhones.has(body.phone), 'AUTH_IN_PROGRESS', '正在核验，请稍候再获取', 409);
      limit('sms-ip:' + hash(ip), 20, 3600);
      const old = get('SELECT * FROM otp WHERE phone=?', body.phone);
      const retryAfter = old ? Math.max(0, Math.ceil((old.sent_at + 60000 - now().getTime()) / 1000)) : 0;
      ensure(!retryAfter, 'RATE_LIMITED', `请在 ${retryAfter} 秒后重新获取`, 429, { retryAfter });
      limit('sms-phone:' + hash(body.phone), 10, 86400);
      if (smsDailyLimit !== undefined) limit('sms-global:' + today(), smsDailyLimit, 86400);
      const dispatchId = id(), code = remoteVerification ? undefined : String(randomInt(100000, 1000000));
      const sentAt = now().getTime(), remainingCooldown = () => Math.max(0, Math.ceil((sentAt + 60000 - now().getTime()) / 1000));
      // Persist the verification method in the existing opaque credential column.
      // This marker can never match a local SHA256 hash, including after a restart.
      const codeHash = remoteVerification ? 'pnvs:' + dispatchId : hash(body.phone + ':' + code);
      run('INSERT OR REPLACE INTO otp(phone,code_hash,expires_at,sent_at,attempts,delivery_state,dispatch_id) VALUES(?,?,?,?,0,?,?)', body.phone, codeHash, sentAt + 300000, sentAt, smsMode === 'development' ? 'DEVELOPMENT' : 'PENDING', dispatchId);
      if (smsMode !== 'development') {
        try { await dispatchCode(deliverCode, { phone: body.phone, code, dispatchId }, smsTimeoutMs); }
        catch (error) {
          const state = error instanceof SmsDeliveryError && error.outcome === 'FAILED' ? 'FAILED' : 'UNKNOWN';
          run("UPDATE otp SET delivery_state=? WHERE phone=? AND dispatch_id=? AND delivery_state='PENDING'", state, body.phone, dispatchId);
          const balance = error instanceof SmsDeliveryError && error.reason === 'BALANCE';
          ensure(false, balance ? 'SMS_BALANCE_INSUFFICIENT' : state === 'FAILED' ? 'SMS_UNAVAILABLE' : 'SMS_DELIVERY_UNKNOWN', balance ? '短信服务余额或套餐额度不足，请开发者检查阿里云账单后再试' : state === 'FAILED' ? '短信发送失败，请稍后重试' : '短信发送结果暂未确认，请稍后重新获取', 503, { retryAfter: remainingCooldown() });
        }
        const changed = run("UPDATE otp SET delivery_state='ACCEPTED' WHERE phone=? AND dispatch_id=? AND delivery_state='PENDING' AND expires_at>?", body.phone, dispatchId, now().getTime());
        ensure(changed.changes === 1, 'SMS_DELIVERY_UNKNOWN', '短信发送结果暂未确认，请重新获取', 503);
      }
      return { retryAfter: remainingCooldown(), expiresIn: 300, deliveryStatus: smsMode === 'development' ? 'DEVELOPMENT' : 'ACCEPTED', ...(smsMode === 'development' ? { developmentCode: code, message: '本地测试验证码，未发送短信' } : { message: '短信请求已受理，请留意手机验证码' }) };
    },
    login(body, ip) {
      ensure(typeof body.phone === 'string' && /^1[3-9]\d{9}$/.test(body.phone) && typeof body.code === 'string' && /^\d{6}$/.test(body.code), 'INVALID_CODE', '验证码无效或已过期', 401);
      limit('login:' + hash(ip), 50, 3600);
      const otp = get('SELECT * FROM otp WHERE phone=?', body.phone);
      ensure(otp && otp.delivery_state === (smsMode === 'development' ? 'DEVELOPMENT' : 'ACCEPTED') && otp.attempts < 5 && otp.expires_at > now().getTime(), 'INVALID_CODE', '验证码无效或已过期', 401);
      ensure(!remoteVerification || otp.code_hash.startsWith('pnvs:'), 'INVALID_CODE', '验证码无效或已过期', 401);
      if (otp.code_hash.startsWith('pnvs:')) return providerLogin(body, otp);
      run('UPDATE otp SET attempts=attempts+1 WHERE phone=?', body.phone);
      ensure(safeEqual(otp.code_hash, hash(body.phone + ':' + body.code)), 'INVALID_CODE', '验证码无效或已过期', 401);
      return transaction(() => {
        run('DELETE FROM otp WHERE phone=?', body.phone);
        return sessionFor(body.phone, '朋友' + body.phone.slice(-4));
      });
    },
    testLogin(body, ip) {
      ensure(testAccounts.length, 'NOT_FOUND', '接口不存在', 404);
      limit('test-login:' + hash(ip), 50, 3600);
      ensure(typeof body.code === 'string' && /^[A-Za-z0-9_-]{24}$/.test(body.code), 'INVALID_CODE', '体验码无效', 401);
      const account = testAccounts.find(a => safeEqual(a.codeHash, hash(body.code)));
      ensure(account, 'INVALID_CODE', '体验码无效', 401);
      return transaction(() => sessionFor('test:' + account.id, account.nickname));
    },
    logout(token) { run('DELETE FROM sessions WHERE token_hash=?', hash(token)); return { ok: true }; },
    me(user) { return { user: publicUser({ ...get('SELECT * FROM users WHERE id=?', user.id), csrf: user.csrf }), today: today(), mode: smsMode, consentVersion: CONSENT_VERSION }; },
    updateProfile(user, body, key) {
      return mutate(user, key, 'profile', body, () => {
        const nickname = text(body.nickname, RULES.nicknameLength, '昵称'); ensure(nickname, 'VALIDATION', '请填写昵称');
        ensure(body.adult === true && body.sensitiveConsent === true, 'CONSENT_REQUIRED', '请分别确认年龄及数据使用说明', 403);
        run('UPDATE users SET nickname=?,consent_version=?,consent_at=? WHERE id=?', nickname, CONSENT_VERSION, stamp(), user.id);
        return { ok: true };
      });
    },
    createRoom(user, body, key) {
      consent(user);
      return mutate(user, key, 'create-room', body, () => {
        noCurrentRoom(user); ensure(body.sharingConsent === true, 'CONSENT_REQUIRED', '请确认组内共享规则', 403);
        const d = roomDraft(body), roomId = id(), code = randomBytes(6).toString('hex').toUpperCase();
        run("INSERT INTO rooms(id,name,intro,days,intensity,status,owner_id,invite_code,created_at) VALUES(?,?,?,?,?,'LOBBY',?,?,?)", roomId, d.name, d.intro, d.days, d.intensity, user.id, code, stamp());
        addMember(user, roomId, false, null, body, null);
        return { roomId };
      });
    },
    getInvite(code, ip) {
      limit('invite:' + hash(ip), 100, 3600);
      const i = invitation(code);
      return { code: i.room.invite_code, name: i.room.name, intro: i.room.intro, days: i.room.days, intensity: i.room.intensity, status: i.room.status, count: i.count, remaining: i.remaining, joinable: i.joinable, today: today(), version: i.room.version };
    },
    joinRoom(user, code, body, key) {
      consent(user);
      return mutate(user, key, 'join:' + code, body, () => {
        const { room, count, remaining } = invitation(code);
        const existing = get("SELECT id FROM members WHERE room_id=? AND user_id=? AND state='JOINED'", room.id, user.id);
        if (existing) return { roomId: room.id };
        noCurrentRoom(user);
        ensure(count < 8, 'ROOM_FULL', '小组已满员', 409); ensure(remaining >= 14, 'JOIN_WINDOW_CLOSED', '剩余不足 14 天，无法加入', 409);
        ensure(body.sharingConsent === true, 'CONSENT_REQUIRED', '请确认组内共享规则', 403);
        const active = room.status === 'ACTIVE';
        if (active) ensure(body.date === today() && body.version === room.version, 'INVITE_CHANGED', '小组信息或日期已变化，请重新确认', 409);
        const goal = active ? calculateGoal(body.height, body.weight, remaining, room.intensity) : null;
        addMember(user, room.id, active, goal, body, active ? today() : null); bump(room.id);
        return { roomId: room.id };
      });
    },
    preparation(user, roomId) { const { room, member } = roomFor(user, roomId); ensure(room.status === 'LOBBY', 'ROOM_LOCKED', '本期已锁定', 409); return { height: member.height, weight: member.start_weight, target: member.target, ready: !!member.ready, version: room.version }; },
    prepare(user, roomId, body, key) {
      consent(user); roomFor(user, roomId);
      return mutate(user, key, 'prepare:' + roomId, body, () => {
        const { room, member } = roomFor(user, roomId);
        ensure(room.status === 'LOBBY', 'ROOM_LOCKED', '开始后无法修改准备信息', 409);
        ensure(body.version === room.version, 'VERSION_CONFLICT', '小组信息已更新，请核对后重试', 409);
        const goal = calculateGoal(body.height, body.weight, room.days, room.intensity);
        run('UPDATE members SET ready=1,height=?,start_weight=?,target=?,algorithm=? WHERE id=?', body.height, body.weight, goal.target, goal.algorithm, member.id); bump(roomId);
        return goal;
      });
    },
    editRoom(user, roomId, body, key) {
      roomFor(user, roomId);
      return mutate(user, key, 'edit:' + roomId, body, () => {
        const { room } = roomFor(user, roomId);
        ensure(room.status === 'LOBBY' && room.owner_id === user.id, 'FORBIDDEN', '仅开始权限持有人可在开始前编辑', 403);
        ensure(body.version === room.version, 'VERSION_CONFLICT', '小组信息已更新，请重新编辑', 409);
        const d = roomDraft({ ...body, intensity: room.intensity, extremeConfirmed: true });
        run('UPDATE rooms SET name=?,intro=?,days=?,version=version+1 WHERE id=?', d.name, d.intro, d.days, roomId);
        if (d.days !== room.days) run("UPDATE members SET ready=0,target=NULL,algorithm=NULL WHERE room_id=? AND state='JOINED'", roomId);
        return { ok: true, needsReconfirmation: d.days !== room.days };
      });
    },
    leaveRoom(user, roomId, body, key) {
      roomFor(user, roomId);
      return mutate(user, key, 'leave:' + roomId, body, () => {
        const { room, member } = roomFor(user, roomId); ensure(room.status === 'LOBBY', 'ROOM_LOCKED', '开始后不能普通退出', 409);
        run("UPDATE members SET state='LEFT',ready=0,height=NULL,start_weight=NULL,target=NULL,algorithm=NULL WHERE id=?", member.id);
        run('UPDATE users SET current_room_id=NULL WHERE id=?', user.id);
        if (room.owner_id === user.id) transferOrClose(roomId); else bump(roomId);
        return { ok: true };
      });
    },
    startPreview(user, roomId) {
      const { room } = roomFor(user, roomId);
      ensure(room.status === 'LOBBY' && room.owner_id === user.id, 'FORBIDDEN', '当前不能开始本期', 403);
      const members = all("SELECT ready FROM members WHERE room_id=? AND state='JOINED'", roomId);
      ensure(members.length >= 2 && members.every(m => m.ready), 'NOT_READY', '至少两人且全员准备后才能开始', 409);
      return { roomId, name: room.name, intro: room.intro, days: room.days, intensity: room.intensity, version: room.version, date: today(), endDate: addDays(today(), room.days - 1), expiresAt: now().getTime() + 120000 };
    },
    startRoom(user, roomId, body, key) {
      roomFor(user, roomId);
      return mutate(user, key, 'start:' + roomId, body, () => {
        const p = api.startPreview(user, roomId);
        ensure(body.version === p.version && body.date === p.date && typeof body.expiresAt === 'number' && body.expiresAt > now().getTime() && body.expiresAt <= now().getTime() + 120000, 'PREVIEW_STALE', '确认信息已变化，请重新确认', 409);
        run("UPDATE rooms SET status='ACTIVE',start_date=?,version=version+1 WHERE id=?", today(), roomId);
        run("UPDATE members SET join_date=? WHERE room_id=? AND state='JOINED'", today(), roomId);
        return { roomId, startDate: today() };
      });
    },
    snapshot(user, roomId, range = 28) {
      ensure([7, 28, 90].includes(range), 'VALIDATION', '查询区间不正确');
      const { room } = roomFor(user, roomId);
      const members = all("SELECT m.*,u.nickname FROM members m JOIN users u ON u.id=m.user_id WHERE room_id=? AND m.state='JOINED' ORDER BY joined_order", roomId).map(m => {
        const records = all('SELECT date,weight,version FROM records WHERE room_id=? AND user_id=? ORDER BY date', roomId, m.user_id);
        const summary = room.start_date ? stats(room, m, records, today(), range) : null;
        const last = records.at(-1), missingDays = room.start_date ? (last ? daysBetween(last.date, today()) : daysBetween(m.join_date, today()) + 1) : 0;
        return { id: m.user_id, memberId: m.id, nickname: m.nickname, ready: !!m.ready, startWeight: m.start_weight, target: m.target, algorithm: m.algorithm, joined_order: m.joined_order, joinDate: m.join_date, records, summary, missingDays };
      });
      let displayMembers = members;
      if (room.status === 'ENDED') {
        const ranked = rankCoverage(members.map(m => ({ ...m, summary: stats(room, { join_date: m.joinDate }, m.records, today(), 90) })));
        displayMembers = ranked.map(rankedMember => ({ ...members.find(m => m.id === rankedMember.id), rank: rankedMember.rank, periodSummary: rankedMember.summary }));
      }
      return { room: { id: room.id, name: room.name, intro: room.intro, days: room.days, intensity: room.intensity, status: room.status, ownerId: room.owner_id, inviteCode: room.invite_code, version: room.version, startDate: room.start_date, endDate: room.start_date ? endDate(room) : null, remaining: room.start_date ? remainingDays(room, today()) : room.days }, members: displayMembers, today: today(), range };
    },
    saveRecord(user, roomId, body, key) {
      consent(user); roomFor(user, roomId);
      return mutate(user, key, 'record:' + roomId, body, () => {
        const { room } = roomFor(user, roomId);
        ensure(room.status === 'ACTIVE', 'ROOM_LOCKED', '本期尚未开始或已经结束', 409);
        ensure(body.date === today(), 'BUSINESS_DATE_CHANGED', '日期已变化，请核对今天日期后重新确认', 409, { today: today() });
        const weight = normalizeWeight(body.weight, body.unit), old = get('SELECT * FROM records WHERE room_id=? AND user_id=? AND date=?', roomId, user.id, today());
        ensure((old?.version ?? 0) === body.version, 'VERSION_CONFLICT', '记录已在其他设备更新，请核对最新值', 409, { latest: old ? { weight: old.weight, version: old.version } : null });
        ensure(!old || body.overwrite === true, 'OVERWRITE_REQUIRED', '请确认覆盖当天记录', 409);
        run('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(room_id,user_id,date) DO UPDATE SET weight=excluded.weight,version=excluded.version,updated_at=excluded.updated_at', roomId, user.id, today(), weight, (old?.version ?? 0) + 1, stamp());
        return { date: today(), weight, version: (old?.version ?? 0) + 1 };
      });
    },
    history(user) { return all("SELECT r.id,r.name,r.start_date startDate,r.days,r.intensity FROM rooms r JOIN members m ON m.room_id=r.id WHERE m.user_id=? AND m.state='JOINED' AND r.status='ENDED' ORDER BY r.start_date DESC LIMIT 100", user.id); },
    reminders(user, roomId) {
      const { room } = roomFor(user, roomId); if (room.status !== 'ACTIVE') return [];
      return all("SELECT m.id,m.user_id,m.join_date,u.nickname, MAX(r.date) last_date FROM members m JOIN users u ON u.id=m.user_id LEFT JOIN records r ON r.room_id=m.room_id AND r.user_id=m.user_id WHERE m.room_id=? AND m.state='JOINED' GROUP BY m.id", roomId).flatMap(m => {
        const round = m.last_date || addDays(m.join_date, -1), missing = daysBetween(round, today());
        if (missing < 3) return [];
        const stage = missing >= 4 ? 4 : 3;
        const seen = get('SELECT stage FROM reminder_receipts WHERE room_id=? AND recipient_id=? AND member_id=? AND round=? ORDER BY stage DESC LIMIT 1', roomId, user.id, m.id, round);
        const seenToday = get('SELECT 1 FROM reminder_receipts WHERE room_id=? AND recipient_id=? AND member_id=? AND shown_date=?', roomId, user.id, m.id, today());
        return seenToday || (seen && seen.stage >= stage) ? [] : [{ memberId: m.id, nickname: m.nickname, round, stage, missingDays: missing }];
      });
    },
    acknowledgeReminders(user, roomId, body, key) {
      roomFor(user, roomId);
      const result = mutate(user, key, 'reminders:' + roomId, body, () => {
        const reminders = api.reminders(user, roomId);
        for (const item of reminders) run('INSERT OR IGNORE INTO reminder_receipts VALUES(?,?,?,?,?,?)', roomId, user.id, item.memberId, item.round, item.stage, today());
        return { ok: true, date: today(), reminders };
      });
      // A retry after a write, expiry or a new day must not resurrect an old prompt.
      const { room } = roomFor(user, roomId);
      return { ...result, reminders: room.status !== 'ACTIVE' || result.date !== today() ? [] : result.reminders.filter(item => {
        const m = get("SELECT join_date FROM members WHERE id=? AND state='JOINED'", item.memberId);
        if (!m) return false;
        const last = get('SELECT MAX(date) last FROM records WHERE room_id=? AND user_id=(SELECT user_id FROM members WHERE id=?)', roomId, item.memberId).last;
        const round = last || addDays(m.join_date, -1), missing = daysBetween(round, today());
        return round === item.round && missing >= 3 && item.stage === (missing >= 4 ? 4 : 3);
      }) };
    },
    exportData(user) {
      return { exportedAt: stamp(), user: { id: user.id, nickname: user.nickname, phone: user.phone }, memberships: all('SELECT room_id,join_date,state,height,start_weight,target,algorithm FROM members WHERE user_id=?', user.id), records: all('SELECT room_id,date,weight,version FROM records WHERE user_id=? ORDER BY date', user.id) };
    },
    support(user, body, key) { return mutate(user, key, 'support', body, () => { const message = text(body.message, 1000, '问题描述'); ensure(message, 'VALIDATION', '请描述你的问题'); const requestId = id(); run('INSERT INTO support_requests(id,user_id,message,created_at) VALUES(?,?,?,?)', requestId, user.id, message, stamp()); return { requestId, status: 'OPEN' }; }); },
    supportList(user) { return all('SELECT id,message,status,created_at createdAt FROM support_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 100', user.id); },
    deleteAccount(user, body) {
      ensure(body.confirm === '注销并删除我的数据', 'CONFIRM_REQUIRED', '请填写确认文字');
      // Commit the durable tombstone first; a crash is completed on next startup.
      const event = store.journal.append(user.id, stamp());
      return transaction(() => {
        replayDeletionsInTransaction();
        return { ok: true, deletion: { requestId: event.id, onlineStatus: 'COMPLETED', backupStatus: 'REPLAY_REQUIRED' } };
      });
    }
  };
  return api;
}
