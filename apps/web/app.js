import { calculateGoal, round2 } from '/packages/domain/index.mjs';
import { createRequester } from '/request.mjs';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (label, act, cls = '', attrs = '') => `<button type="button" class="${cls}" data-act="${act}" ${attrs}>${label}</button>`;
const btn = (label, act, cls = '', attrs = '') => button(label, act, 'btn ' + cls, attrs);
const badge = value => `<span class="badge">${esc(value)}</span>`;
const colors = ['#cf4938', '#6b80c6', '#b96491', '#9471bc', '#32978f', '#c18a35', '#628d50', '#5c91b2'];
const icons = { group: 'M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M17 14a4 4 0 0 1 4 4v2M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', record: 'M12 8v8M8 12h8M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z', data: 'M4 20V10m8 10V4m8 16v-7M2 21h20' };
const icon = key => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[key] || icons.group}"/></svg>`;
let user = null, data = null, today = '', range = 28, unit = 'kg', metric = 'change', nextPage = 'home', invite = null, developmentCode = '', loginPhone = '', draft = { name: '', intro: '', days: 14, intensity: '低', custom: false }, busy = false, epoch = 0, modalFocus = null, recordKg = null, recordDate = '', recordVersion = 0, timer = null, pollFailures = 0, viewRequest = 0, dataRange = 28;
const routePage = () => location.hash.slice(1).split('?')[0] || 'home';
const routeRoom = () => new URLSearchParams(location.hash.split('?')[1] || '').get('room');
let page = routePage();
const pendingKeys = new Map();
const request = createRequester({ pendingKeys });
let appMode = 'local';
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4200); }
function syncBusyButtons() {
  if (!busy) return;
  document.querySelectorAll('button:not(:disabled)').forEach(b => { b.disabled = true; b.dataset.busy = 'true'; });
}
function resetRecord() { recordKg = null; recordDate = ''; recordVersion = 0; savePayload = null; uncertainRecord = null; }
function clearPrivate() { epoch++; data = null; invite = null; resetRecord(); preparedPayload = null; startPayload = null; pendingKeys.clear(); closeModal(); }
async function api(path, method = 'GET', body, options = {}) {
  const generation = epoch;
  const headers = { 'Content-Type': 'application/json', 'X-App-Request': '1' };
  if (user?.csrf) headers['X-CSRF-Token'] = user.csrf;
  const stale = () => Object.assign(new Error('会话已变化，请重新操作'), { code: 'STALE_SESSION' });
  try { const result = await request(path, method, body, headers); if (generation !== epoch) throw stale(); return result; }
  catch (e) {
    if (generation !== epoch) throw stale();
    if (e.status === 401 && !options.allowAnonymous) { user = null; clearPrivate(); nextPage = page; navigate('login'); }
    if (e.code === 'CSRF_REJECTED' && user) { user = null; clearPrivate(); nextPage = 'home'; navigate('login'); }
    throw e;
  }
}
function navigate(target) { closeModal(); page = target; const inRoom = ['lobby', 'group', 'record', 'data'].includes(target) || target.startsWith('analysis/'); const hash = target + (inRoom && room() ? '?room=' + room().id : ''); if (location.hash.slice(1) !== hash) location.hash = hash; render(); window.scrollTo(0, 0); }
const room = () => data?.room;
const mine = () => data?.members.find(m => m.id === user?.id);
const roomPath = suffix => `/rooms/${room().id}${suffix || ''}`;
const back = (target = 'home', label = '返回') => button(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m14 6-6 6 6 6"/></svg><span>${label}</span>`, 'go:' + target, 'back', `aria-label="${label}"`);
const head = (title, sub = '', right = '') => `<header class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>${right}</header>`;
function avatar(m) { const c = colors[((m.joined_order || 1) - 1) % colors.length]; return `<span class="avatar" style="background:${c}14;color:${c}">${esc(m.nickname.slice(-1))}</span>`; }
function pillControl(items, value, action, className, label) {
  const index = Math.max(0, items.findIndex(([v]) => String(v) === String(value)));
  return `<div class="pill-control ${className}" role="group" aria-label="${label}" data-selected="${value}" style="--pill-count:${items.length};--pill-index:${index}"><span class="pill-thumb" aria-hidden="true"><span></span></span>${items.map(([v, title]) => button(title, action + v, String(v) === String(value) ? 'active' : '', action === 'go:' ? (v === value ? 'aria-current="page"' : '') : `aria-pressed="${String(v) === String(value)}"`)).join('')}</div>`;
}
const pillTimers = new WeakMap();
function selectPill(control, value) {
  if (!control || control.dataset.selected === String(value)) return;
  const items = [...control.querySelectorAll('button')], index = items.findIndex(item => item.dataset.act.split(':')[1] === String(value));
  if (index < 0) return;
  control.dataset.selected = value;
  control.style.setProperty('--pill-index', index);
  for (const [i, item] of items.entries()) {
    item.classList.toggle('active', i === index);
    if (control.classList.contains('nav-track')) {
      if (i === index) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    } else item.setAttribute('aria-pressed', String(i === index));
  }
  control.dataset.motion = control.dataset.motion === 'a' ? 'b' : 'a';
  clearTimeout(pillTimers.get(control));
  pillTimers.set(control, setTimeout(() => delete control.dataset.motion, 440));
}
function shell(content) {
  const nav = room() && room().status !== 'LOBBY' && (['group', 'record', 'data'].includes(page) || page.startsWith('analysis/'));
  const selected = page.startsWith('analysis/') ? 'group' : page;
  return `<div class="layout page-${page.split('/')[0]} ${['create', 'join', 'lobby', 'login', 'profile'].includes(page) ? 'form-layout' : ''}" data-context="${nav ? esc(user?.id + ':' + room().id) : ''}"><aside class="sidebar"><div class="brand">${button('上秤', 'go:home')}</div>${nav ? `<nav class="nav" aria-label="主导航">${pillControl([['group', icon('group') + '小组'], ['record', icon('record') + '记录'], ['data', icon('data') + '数据']], selected, 'go:', 'nav-track', '页面导航')}</nav>` : ''}</aside><main data-page="${esc(page)}">${content}</main></div>`;
}
function mountShell(content) {
  const layout = $('#app > .layout'), main = layout?.querySelector('main');
  const hasNav = room() && room().status !== 'LOBBY' && (['group', 'record', 'data'].includes(page) || page.startsWith('analysis/'));
  if (!hasNav || layout?.dataset.context !== user?.id + ':' + room().id || !layout.querySelector('.nav-track')) {
    $('#app').innerHTML = shell(content); return;
  }
  // Keep navigation mounted across routes, and chart selectors mounted across data refreshes.
  layout.className = 'layout page-' + page.split('/')[0];
  if (main.dataset.page === page && main.querySelector('[data-chart-content]') && content.includes('data-chart-content')) {
    const template = document.createElement('template'); template.innerHTML = content;
    for (const selector of ['[data-chart-content]', '[data-analysis-summary]']) {
      const current = main.querySelector(selector), next = template.content.querySelector(selector);
      if (current && next) current.innerHTML = next.innerHTML;
    }
    const title = template.content.querySelector('h1');
    if (title) main.querySelector('h1').textContent = title.textContent;
    selectPill(main.querySelector('.tabs'), range);
    selectPill(main.querySelector('.group-metric'), metric);
  } else { main.innerHTML = content; main.dataset.page = page; }
  selectPill(layout.querySelector('.nav-track'), page.startsWith('analysis/') ? 'group' : page);
}
function closeModal() { $('#overlay').innerHTML = ''; document.body.classList.remove('modal-open'); modalFocus?.focus?.(); modalFocus = null; }
function modal(title, body, actions = '', sheet = false, className = '') {
  modalFocus = document.activeElement;
  $('#overlay').innerHTML = `<div class="modal-shade ${sheet ? 'record-details-sheet' : ''}"><section class="modal ${sheet ? 'app-sheet' : ''} ${esc(className)}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><h2>${esc(title)}</h2><div class="modal-content">${body}</div><div class="modal-actions">${actions || btn('关闭', 'close', 'secondary full')}</div></section></div>`;
  document.body.classList.add('modal-open'); $('#overlay .modal').focus(); syncBusyButtons();
}
function field(label, name, value = '', attrs = '') { return `<label class="field"><span class="field-label">${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`; }
const sharingText = '本期体重、目标和趋势对所有组员可见，包括之后加入的成员。开营后至结束不能普通退出。';
function homePage() {
  const primaryActions = user?.currentRoomId
    ? btn('返回当前小组', 'current', 'full')
    : btn('创建小组', 'create', 'full') + btn('加入小组', 'join', 'secondary full');
  return `<main class="hero-home"><h1>上秤</h1><div class="home-actions">${primaryActions}</div><div class="home-secondary">${user ? button('历史小组', 'history') + button('账号与支持', 'account') : button('登录', 'login')}${button('隐私与数据', 'privacy')}</div></main>`;
}
function loginPage() {
  if (appMode === 'test') return `<div class="form-shell">${back()}${head('联机测试登录', '每人使用一个体验码；同一码可重新登录')}<form class="card" data-form="test-login">${field('体验码', 'code', '', 'type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴你的专属体验码" maxlength="24" required')}<p class="sub">只使用示例身高、体重和昵称，请勿填写真实个人数据。</p><p class="error" id="form-error" role="alert"></p><button class="btn full" type="submit">进入测试</button></form></div>`;
  return `<div class="form-shell">${back()}${head('手机登录', '使用验证码登录或创建账号')}<form class="card" data-form="login">${field('手机号', 'phone', loginPhone, 'type="tel" inputmode="tel" autocomplete="tel" placeholder="11 位手机号" maxlength="11" required')}<div class="code-input">${field('验证码', 'code', '', 'type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" required')}${button('获取验证码', 'send-code', 'text-btn')}</div><div id="development-code" class="notice" ${developmentCode ? '' : 'hidden'}>本地测试验证码：<strong>${esc(developmentCode)}</strong><br>未发送短信，请使用测试手机号。</div><p class="error" id="form-error" role="alert"></p><button class="btn full" type="submit">登录</button></form></div>`;
}
function profilePage() { return `<div class="form-shell">${back()}${head('开始之前')}<form class="card" data-form="profile">${field('昵称', 'nickname', user?.nickname, 'maxlength="20" autocomplete="nickname" required')}<label class="check"><input type="checkbox" name="adult" required><span>我已年满 18 岁</span></label><label class="check"><input type="checkbox" name="sensitiveConsent" required><span>我同意处理身高、体重和目标，用于本期记录与分析。身高仅用于计算，体重、目标和趋势按加入时确认的规则组内共享。${button('查看数据说明', 'privacy', 'text-btn')}</span></label><p class="error" id="form-error" role="alert"></p><button type="submit" class="btn full">确认并继续</button></form></div>`; }
function periodOptions(editing = false) { const d = editing ? editDraft : draft; return `<fieldset class="field period-field"><legend class="field-label">本期天数</legend><div class="triple period-options">${[14, 28, 56].map(n => button(`<span class="period-value">${n}<span>天</span></span><span class="period-check">${!d.custom && d.days === n ? '✓' : ''}</span>`, `${editing ? 'edit-' : ''}days:${n}`, `period-choice ${!d.custom && d.days === n ? 'active' : ''}`, `aria-pressed="${!d.custom && d.days === n}"`)).join('')}<label id="custom-option" class="period-choice period-custom ${d.custom ? 'active' : ''}"><input name="days" type="text" inputmode="numeric" aria-label="自定义天数" autocomplete="off" placeholder="自定义" value="${d.custom ? esc(d.days) : ''}"><span class="period-check">${d.custom ? '✓' : ''}</span></label></div><div id="days-error" class="error"></div></fieldset>`; }
function createPage() { return `<div class="form-shell create-page">${back('home', '返回首页')}${head('创建小组')}<form class="card create-form" data-form="create">${field('小组名称<span class="optional">选填</span>', 'name', draft.name, 'maxlength="24" placeholder="晚饭后散步小队"')}<label class="field"><span class="field-label">小组介绍<span class="optional">选填</span></span><textarea name="intro" maxlength="200" placeholder="比如：晚饭后一起走走。">${esc(draft.intro)}</textarea></label>${periodOptions()}<div class="field"><span class="field-label">减肥强度</span><div class="triple intensity-options">${['低', '中', '高', '极高'].map((v, i) => button(`${v}<small>${['轻松记录', '适度挑战', '更高挑战', '谨慎选择'][i]}</small>`, 'intensity:' + v, `choice ${draft.intensity === v ? 'active' : ''}`, `aria-pressed="${draft.intensity === v}"`)).join('')}</div></div><p id="form-error" class="error" role="alert"></p><div class="page-action-bar"><button class="btn full" type="submit">创建</button></div></form></div>`; }
function joinPage() { return `<div class="form-shell">${back('home', '返回首页')}${head('加入小组')}<form class="card" data-form="invite">${field('小组邀请码', 'code', invite?.code || '', 'autocapitalize="characters" autocomplete="off" maxlength="12" placeholder="输入邀请码" required')}<p id="form-error" class="error" role="alert"></p><div class="page-action-bar"><button class="btn full" type="submit">查看小组</button></div></form></div>`; }
function invitePage() {
  if (!invite) return joinPage();
  return `<div class="form-shell">${back('join')}${head('加入小组')}<section class="card">${badge(invite.status === 'ACTIVE' ? '进行中' : '等待开营')}<h2 style="margin-top:16px">${esc(invite.name)}</h2><p class="sub">${esc(invite.intro)}</p><p class="sub">${invite.count} / 8 人 · ${invite.days} 天 · ${esc(invite.intensity)}强度</p>${invite.status === 'ACTIVE' ? `<p class="sub">剩余 ${invite.remaining} 天，按剩余天数计算你的目标。</p>` : ''}</section><form class="card" data-form="join">${invite.status === 'ACTIVE' ? preparationFields() : ''}<p class="sub">${sharingText}</p><label class="check"><input type="checkbox" name="sharingConsent" required><span>我已了解并同意本期组内共享及参与规则</span></label><p id="form-error" class="error" role="alert"></p><button class="btn full" ${invite.joinable ? '' : 'disabled'} type="submit">${invite.joinable ? '确认加入' : invite.count >= 8 ? '小组已满员' : '剩余不足 14 天'}</button></form></div>`;
}
function memberRow(m, lobby = false) {
  const s = m.summary, latest = s?.latest, status = latest?.date === today ? '今日已记录' : m.missingDays >= 3 ? '多日未记录' : '今日未记录';
  return `<div class="member row"><div class="person">${lobby ? avatar(m) : button(avatar(m), 'analysis:' + m.id, 'member-avatar', `aria-label="查看${esc(m.nickname)}的数据分析"`)}<div>${lobby ? `<strong>${esc(m.nickname)}${m.id === user.id ? '（我）' : ''}</strong>` : button(esc(m.nickname) + (m.id === user.id ? '（我）' : ''), 'analysis:' + m.id, 'member-name')}${m.id === room().ownerId && lobby ? badge('开始权限') : ''}<div class="member-status">${badge(lobby ? m.ready ? '已准备' : '未准备' : status)}</div>${lobby && m.ready ? `<small>目标 ${m.target.toFixed(2)} kg</small>` : ''}</div></div>${lobby ? '' : `<div class="member-details"><div class="member-spark">${spark(m.records)}</div><div><div class="member-weight">${latest ? latest.weight.toFixed(2) : '—'} <small>kg</small></div><small>${s?.change == null ? '数据不足' : `${s.change > 0 ? '已增重' : '已减重'} ${Math.abs(s.change).toFixed(2)} kg`}</small></div></div>`}</div>`;
}
function lobbyPage() {
  const r = room(), m = mine(), owner = r.ownerId === user.id, ready = data.members.length >= 2 && data.members.every(m => m.ready);
  return `<div class="form-shell lobby-page">${back('home', '返回首页')}${head(r.name, `${r.days} 天 · ${r.intensity}强度`, badge('待开始'))}${r.intro ? `<p class="sub room-intro">${esc(r.intro)}</p>` : ''}<section class="card"><div class="row section-head"><h2>小组成员 <small>${data.members.length} / 8</small></h2>${button('邀请好友 ↗', 'share', 'text-btn')}</div>${data.members.map(m => memberRow(m, true)).join('')}</section><section class="card"><div class="row"><h2>我的准备</h2>${badge(m.ready ? '已准备' : '未准备')}</div><div class="ready-result">${m.ready ? `<small>本期目标体重</small><div class="big">${m.target.toFixed(2)}<span class="unit">kg</span></div><p class="sub">起始 ${m.startWeight.toFixed(2)} kg</p>` : '<p class="sub">填写身高和起始体重，确认本期目标。</p>'}${button(m.ready ? '修改身高体重' : '填写并准备', 'prepare', 'text-btn')}</div></section><div class="lobby-secondary">${owner ? button('编辑小组', 'edit-room', 'text-btn') : ''}${button('退出小组', 'leave', 'text-btn')}</div>${owner ? `<div class="page-action-bar">${btn('开始本期', 'start-preview', 'full', ready ? '' : 'disabled')}<p class="sub action-hint">${ready ? '全员已准备' : data.members.length < 2 ? '至少需要 2 位成员' : '等待所有成员准备'}</p></div>` : '<p class="sub">全员准备后，由开始权限持有人确认开始。</p>'}</div>`;
}
function spark(records) { if (!records.length) return ''; const a = records.slice(-12), lo = Math.min(...a.map(x => x.weight)), hi = Math.max(...a.map(x => x.weight)), points = a.map((x, i) => `${4 + i / Math.max(1, a.length - 1) * 62},${27 - (x.weight - lo) / Math.max(.3, hi - lo) * 22}`).join(' '); return `<svg class="spark" viewBox="0 0 70 32" aria-hidden="true"><polyline points="${points}" fill="none" stroke="#cf4938" stroke-width="1.8"/>${a.length === 1 ? '<circle cx="4" cy="27" r="2" fill="#cf4938"/>' : ''}</svg>`; }
function progress() { const r = room(), elapsed = Math.min(r.days, r.days - r.remaining + 1); return `<section class="card group-progress"><div class="row"><div><small>本期截止</small><h2>${r.endDate} <small>23:59</small></h2></div><strong>${r.status === 'ENDED' ? '已结束' : `第 ${elapsed} 天`}</strong></div><div class="progress"><i style="width:${Math.min(100, elapsed / r.days * 100)}%"></i></div><div class="between-note"><span>${r.startDate} 开始</span><span>${r.status === 'ENDED' ? `${r.days} 天` : `剩余 ${r.remaining} 天（含今天）`}</span></div></section>`; }
function groupPage() { if (room().status === 'ENDED') return reviewPage(); return `${back('home', '返回首页')}${head(room().name, '', button('邀请 ↗', 'share', 'btn secondary'))}${progress()}<div id="reminders"></div><section class="card"><h2 class="section-head">成员数据</h2>${data.members.map(m => memberRow(m)).join('')}</section>`; }
function recordPage() {
  if (room().status !== 'ACTIVE') return `${head('记录体重')}<section class="card empty"><h2>${room().status === 'ENDED' ? '本期已结束' : '本期尚未开始'}</h2>${btn('返回小组', 'go:group', 'soft')}</section>`;
  const m = mine(), factor = unit === 'jin' ? 2 : 1;
  if (!recordDate) { recordDate = today; const old = m.records.find(r => r.date === today); recordKg = old?.weight ?? null; recordVersion = old?.version ?? 0; }
  return `<div class="form-shell">${head('记录体重')}<form class="card record-form" data-form="record"><div class="weight-entry"><div class="unit-toggle" data-unit="${unit}" role="group" aria-label="体重单位"><span class="unit-toggle-thumb" aria-hidden="true"><span></span></span>${button('公斤', 'unit:kg', unit === 'kg' ? 'active' : '', `aria-pressed="${unit === 'kg'}"`)}${button('斤', 'unit:jin', unit === 'jin' ? 'active' : '', `aria-pressed="${unit === 'jin'}"`)}</div><div class="entry-line"><input name="weight" class="record-input" type="text" inputmode="decimal" autocomplete="off" placeholder="00.00" aria-label="体重" ${uncertainRecord ? 'readonly' : ''} value="${recordKg == null ? '' : (recordKg * factor).toFixed(2)}"><span data-weight-unit>${unit === 'jin' ? '斤' : '公斤'}</span></div><p id="form-error" class="error" role="alert">${uncertainRecord ? '尚未确认保存结果，请恢复连接后核对。' : ''}</p></div><section class="record-target"><div class="target-heading"><h3>本期目标</h3><span class="target-period">${room().days} 天</span></div><div class="target-reading"><strong data-target-weight>${(m.target * factor).toFixed(2)}</strong><span data-target-unit>${unit === 'jin' ? '斤' : '公斤'}</span></div><div class="target-meta">${esc(room().intensity)}强度</div></section><div class="record-save"><button type="submit" class="btn full">${uncertainRecord ? '核对保存结果' : '保存记录'}</button></div></form></div>`;
}
function switchRecordUnit(nextUnit) {
  const control = $('.record-form .unit-toggle');
  if (!control || nextUnit === unit || !['kg', 'jin'].includes(nextUnit)) return;
  unit = nextUnit;
  control.dataset.unit = unit;
  for (const item of control.querySelectorAll('button')) {
    const selected = item.dataset.act === 'unit:' + unit;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-pressed', String(selected));
  }
  const factor = unit === 'jin' ? 2 : 1, label = unit === 'jin' ? '斤' : '公斤';
  $('[name="weight"]').value = recordKg == null ? '' : (recordKg * factor).toFixed(2);
  $('[data-weight-unit]').textContent = label;
  $('[data-target-weight]').textContent = (mine().target * factor).toFixed(2);
  $('[data-target-unit]').textContent = label;
  // Keep the thumb and form mounted so rapid changes reverse the current motion.
  control.classList.add('is-switching');
  clearTimeout(switchRecordUnit.timer);
  switchRecordUnit.timer = setTimeout(() => control.classList.remove('is-switching'), 440);
}
function chart(series, dimension = 'weight', interactive = false) {
  const points = series.flatMap(s => s.rows.map(p => ({ ...p, value: p[dimension] })));
  if (!points.length) return '<div class="empty"><h3>还没有记录</h3><p class="sub">记录后，趋势会出现在这里。</p></div>';
  const dates = points.map(p => p.date).sort(), start = dates[0], end = dates.at(-1), lo = Math.min(...points.map(p => p.value)) - .3, hi = Math.max(...points.map(p => p.value)) + .3;
  const X = date => 48 + (Date.parse(date) - Date.parse(start)) / Math.max(86400000, Date.parse(end) - Date.parse(start)) * 292, Y = value => 220 - (value - lo) / (hi - lo) * 184;
  return `<svg class="chart" viewBox="0 0 360 260" role="img" aria-label="${dimension === 'weight' ? '体重' : dimension === 'change' ? '体重变化' : '变化比例'}原始数据图"><text x="48" y="16">${dimension === 'percent' ? '变化 / %' : dimension === 'change' ? '变化 / kg' : '体重 / kg'}</text>${Array.from({ length: 5 }, (_, i) => { const v = lo + (hi - lo) * i / 4; return `<line x1="48" x2="340" y1="${Y(v)}" y2="${Y(v)}" stroke="#eeebee" stroke-dasharray="3 4"/><text x="38" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`; }).join('')}${series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2.3" points="${s.rows.map(p => X(p.date) + ',' + Y(p[dimension])).join(' ')}"/>${s.rows.map(p => `<circle cx="${X(p.date)}" cy="${Y(p[dimension])}" r="${interactive ? 5 : 3}" fill="${s.color}" ${interactive ? `role="button" tabindex="0" data-act="point" data-label="${p.date} · ${p.weight.toFixed(2)} kg" aria-label="${p.date} ${p.weight.toFixed(2)} kg"` : ''}><title>${esc(s.name)} · ${p.date} · ${p[dimension].toFixed(2)}</title></circle>`).join('')}`).join('')}<text x="48" y="250">${start.slice(5)}</text><text x="340" y="250" text-anchor="end">${end.slice(5)}</text></svg>`;
}
function rangeTabs() { return pillControl([[7, '近 7 天'], [28, '近 28 天']], range, 'range:', 'tabs', '时间范围'); }
function analysisPage() { const m = data.members.find(m => m.id === page.split('/')[1]); if (!m) return '<div class="empty">该成员数据已移除</div>'; const s = m.summary; return `${back('group', '返回小组')}${head(m.nickname + '的数据分析')}<section class="card"><div class="row chart-heading">${rangeTabs()}</div><div data-chart-content>${chart([{ name: m.nickname, color: '#cf4938', rows: s.rows }], 'weight', true)}</div></section><div data-analysis-summary><div class="stats app-stats"><div class="stat"><small>记录天数</small><strong>${s.count}<span class="unit">天</span></strong></div><div class="stat"><small>记录覆盖率</small><strong>${s.coverage ?? '—'}<span class="unit">%</span></strong></div></div>${button(`<span>记录明细</span><span>${s.count} 条　›</span>`, 'details:' + m.id, 'card record-details-entry')}<section class="target-inline"><small>本期目标</small><strong>${m.target?.toFixed(2) ?? '—'} kg</strong></section></div>`; }
function dataPage() { const series = data.members.map((m, i) => ({ name: m.nickname, color: colors[i % colors.length], rows: m.summary.rows })); return `${head('小组数据')}<section class="card group-comparison"><div class="row group-chart-top"><h2>成员对比</h2>${rangeTabs()}</div>${pillControl([['weight', '体重'], ['change', '体重变化'], ['percent', '变化比例']], metric, 'metric:', 'group-metric', '数据维度')}<div data-chart-content>${chart(series, metric)}<div class="group-values">${series.map(s => { const v = s.rows.at(-1)?.[metric]; return `<div class="group-value"><span class="group-value-name"><i style="background:${s.color}"></i>${esc(s.name)}</span><strong>${v == null ? '—' : (v > 0 && metric !== 'weight' ? '+' : '') + v.toFixed(2)}<small>${metric === 'percent' ? '%' : 'kg'}</small></strong></div>`; }).join('')}</div></div></section>`; }
function reviewPage() { return `${back('home', '返回首页')}${head('本期复盘', room().name, badge('已结束'))}${progress()}<section class="card"><h2>小组记录参与</h2><p class="sub">按记录覆盖率排序，同值并列。</p>${data.members.map(m => { const s = m.periodSummary; return `<div class="member row">${button(`<span class="rank">${m.rank}</span>${avatar(m)}<span><strong>${esc(m.nickname)}</strong><small class="block">记录 ${s.count} / ${s.denominator} 天</small></span>`, 'analysis:' + m.id, 'person review-member')}<strong>${s.coverage ?? '—'}%</strong></div>`; }).join('')}</section>${btn('再组一期', 'new-period', 'full')}`; }
function render() {
  if (page === 'home') { $('#app').innerHTML = homePage(); syncBusyButtons(); return; }
  const requiresRoom = ['lobby', 'group', 'record', 'data'].includes(page) || page.startsWith('analysis/');
  if (room()?.status === 'LOBBY' && requiresRoom && page !== 'lobby') { page = 'lobby'; history.replaceState(null, '', '#lobby'); }
  if (requiresRoom && !room()) { $('#app').innerHTML = shell(`${back()}<div class="card empty">正在读取小组…</div>`); syncBusyButtons(); return; }
  let content = '';
  if (page === 'login') content = loginPage(); else if (page === 'profile') content = profilePage(); else if (page === 'create') content = createPage(); else if (page === 'join') content = joinPage(); else if (page === 'invite') content = invitePage(); else if (page === 'lobby') content = lobbyPage(); else if (page === 'group') content = groupPage(); else if (page === 'record') content = recordPage(); else if (page === 'data') content = dataPage(); else if (page.startsWith('analysis/')) content = analysisPage(); else content = `${back()}<div class="card empty">页面不存在</div>`;
  mountShell(content);
  syncBusyButtons();
}
async function refresh({ force = false, roomId } = {}) {
  const generation = epoch, request = ++viewRequest, requestedRange = range;
  const result = await api('/me'); if (generation !== epoch || request !== viewRequest) return;
  if (user && user.id !== result.user.id) { clearPrivate(); user = result.user; today = result.today; navigate('home'); return; }
  const previousCurrentRoomId = user?.currentRoomId;
  user = result.user; today = result.today;
  if (page === 'home' && previousCurrentRoomId !== user.currentRoomId) render();
  const selectedRoom = roomId || routeRoom() || room()?.id || user.currentRoomId;
  if (selectedRoom) {
    let updated;
    try { updated = await api(`/rooms/${selectedRoom}?range=${requestedRange}`); }
    catch (e) { if (generation === epoch && request === viewRequest && e.code === 'FORBIDDEN') { clearPrivate(); navigate('home'); } throw e; }
    if (generation !== epoch || request !== viewRequest) return; delete updated.requestId;
    const changed = !data || JSON.stringify(data) !== JSON.stringify(updated), oldStatus = room()?.status;
    if (room() && room().id !== updated.room.id) resetRecord();
    data = updated; dataRange = requestedRange;
    if (page === 'lobby' && room().status !== 'LOBBY') { navigate('group'); return; }
    if (oldStatus === 'ACTIVE' && room().status === 'ENDED') { recordDate = ''; closeModal(); if (['lobby', 'group', 'record'].includes(page)) navigate('group'); else render(); return; }
    if ((force || changed) && page !== 'record') render();
  } else if (force) render();
}
async function ensureUser(destination) { nextPage = destination; if (!user) { navigate('login'); return false; } if (!user.consent) { navigate('profile'); return false; } return true; }
async function loadCurrent() { await refresh({ force: true, roomId: user.currentRoomId }); if (!room()) { navigate('home'); return; } navigate(room().status === 'LOBBY' ? 'lobby' : 'group'); }
let editDraft = null, preparedPayload = null, startPayload = null, savePayload = null, uncertainRecord = null;
function preparationFields(values = {}) { return `<div class="compare preparation-fields">${field('身高 <small>cm</small>', 'height', values.height ?? '', 'type="text" inputmode="decimal" placeholder="如 175" required')}${field('起始体重 <small>kg</small>', 'weight', values.weight ?? '', 'type="text" inputmode="decimal" placeholder="如 80.00" required')}</div>`; }
function editRoomModal() { modal('编辑小组', `<form id="edit-form" data-form="edit">${field('小组名称', 'name', editDraft.name, 'maxlength="24" placeholder="晚饭后散步小队"')}<label class="field"><span class="field-label">小组介绍</span><textarea name="intro" maxlength="200">${esc(editDraft.intro)}</textarea></label>${periodOptions(true)}<p class="sub">修改周期后，所有成员需重新确认目标。</p><p id="modal-error" class="error" role="alert"></p></form>`, '<button form="edit-form" type="submit" class="btn full">保存修改</button>' + button('取消', 'close', 'cancel'), true); }
async function showReminders() {
  if (page !== 'group' || room()?.status !== 'ACTIVE' || document.hidden) return;
  if (!pendingKeys.has('POST' + roomPath('/reminders') + '{}')) { const preview = await api(roomPath('/reminders')); if (!preview.reminders.length) return; }
  const result = await api(roomPath('/reminders'), 'POST', {}); if (page !== 'group' || !$('#reminders') || !result.reminders.length || document.hidden) return;
  $('#reminders').innerHTML = `<section class="notice reminder-notice">${result.reminders.map(r => `<p>${esc(r.nickname)}已连续 ${r.missingDays} 天未更新体重。</p>`).join('')}</section>`;
}
async function act(action, element) {
  if (action.startsWith('go:')) { if (action === 'go:record' && !uncertainRecord) recordDate = ''; navigate(action.slice(3)); if (page === 'group') await showReminders(); return; }
  if (action === 'close') { closeModal(); return; }
  if (action === 'point') { toast(element.dataset.label); return; }
  if (action === 'privacy') { modal('隐私与数据', '<p>身高用于计算本期目标，体重、目标和趋势用于记录与组内分析。未加入小组的人无法查看身体数据。新加入的成员可查看本期历史。</p>' + (appMode === 'test' ? '<p>这是使用专属体验码的联机测试环境，请只使用合成数据，不填写真实手机号或健康数据。数据保存在独立测试库中，账号与支持中可取回本人测试数据或注销删除。体验码等同于测试账号的登录凭据，请只把小组邀请链接发给朋友，不分享自己的体验码。</p>' : '<p>本地开发版本只在本机运行。短信尚未接入；请使用合成数据测试。开发数据保存在本机数据库，账号与支持中可取回本人数据或注销删除。正式保留期限、备份删除及支持时限将在开放试用前确定。</p>') + '<p>目标是产品挑战规则，不是医学建议；效果及难度公平性尚未验证。</p>'); return; }
  if (action === 'create' || action === 'join') { if (!await ensureUser(action)) return; if (action === 'create' && user.currentRoomId) { toast('你已在一个未结束小组中'); await loadCurrent(); return; } navigate(action); return; }
  if (action === 'login') { nextPage = 'home'; navigate('login'); return; }
  if (action === 'send-code') {
    developmentCode = ''; $('#development-code').hidden = true;
    loginPhone = $('[name="phone"]').value.trim(); const r = await api('/auth/code', 'POST', { phone: loginPhone }, { allowAnonymous: true });
    developmentCode = r.developmentCode || ''; const panel = $('#development-code'); panel.hidden = !developmentCode; panel.innerHTML = `本地测试验证码：<strong>${esc(developmentCode)}</strong><br>未发送短信，请使用测试手机号。`; delete element.dataset.busy;
    if (r.deliveryStatus === 'ACCEPTED') toast(r.message);
    element.textContent = '60 秒后重试'; element.disabled = true;
    let remaining = 60; const cooldown = setInterval(() => { remaining--; if (!element.isConnected || remaining <= 0) { clearInterval(cooldown); element.disabled = false; element.textContent = '获取验证码'; } else element.textContent = remaining + ' 秒后重试'; }, 1000); return;
  }
  if (action.startsWith('days:')) { draft.days = Number(action.split(':')[1]); draft.custom = false; render(); return; }
  if (action.startsWith('edit-days:')) { editDraft.days = Number(action.split(':')[1]); editDraft.custom = false; editRoomModal(); return; }
  if (action.startsWith('intensity:')) { const value = action.split(':')[1]; if (value === '极高') modal('选择极高强度', '<p>极高强度意味着更高的目标要求，请谨慎选择。</p>', btn('我已了解，选择极高强度', 'extreme', 'full') + button('暂不选择', 'close', 'cancel')); else { draft.intensity = value; render(); } return; }
  if (action === 'extreme') { draft.intensity = '极高'; closeModal(); render(); return; }
  if (action === 'confirm-create') {
    const body = { ...draft, days: Number(draft.days), extremeConfirmed: draft.intensity === '极高', sharingConsent: $('#create-sharing').checked };
    const result = await api('/rooms', 'POST', body); user.currentRoomId = result.roomId; closeModal(); await refresh({ force: true, roomId: result.roomId }); navigate('lobby'); return;
  }
  if (action === 'current') { if (await ensureUser('home')) await loadCurrent(); return; }
  if (action === 'share') { const code = room().inviteCode, link = location.origin + '/?invite=' + code; modal('邀请好友', `<div class="code">${esc(code)}</div><p class="invite-link">${esc(link)}</p>`, btn('复制邀请链接', 'copy-invite', 'full') + button('关闭', 'close', 'cancel')); return; }
  if (action === 'copy-invite') { const link = location.origin + '/?invite=' + room().inviteCode; try { await navigator.clipboard.writeText(link); toast('邀请链接已复制'); } catch { modal('复制邀请信息', `<p>长按下面的链接复制：</p><textarea readonly aria-label="邀请链接">${esc(link)}</textarea>`); } return; }
  if (action === 'prepare') {
    const p = await api(roomPath('/preparation')); preparedPayload = { version: p.version };
    modal('我的准备', `<form id="prepare-form" data-form="prepare">${preparationFields(p)}<div id="goal-preview" class="ready-result" hidden></div><p id="modal-error" class="error" role="alert"></p></form>`, '<button form="prepare-form" class="btn full" type="submit">确认目标并准备</button>' + button('取消', 'close', 'cancel'), true); return;
  }
  if (action === 'edit-room') { editDraft = { name: room().name, intro: room().intro, days: room().days, version: room().version, custom: ![14, 28, 56].includes(room().days) }; editRoomModal(); return; }
  if (action === 'leave') { modal('退出小组', '<p>退出后不能再查看本组数据，再次加入需重新准备。开始权限会自动交给仍在组内最早加入的人。</p>', btn('确认退出', 'confirm-leave', 'full') + button('取消', 'close', 'cancel')); return; }
  if (action === 'confirm-leave') { await api(roomPath('/leave'), 'POST', {}); clearPrivate(); user.currentRoomId = null; navigate('home'); return; }
  if (action === 'start-preview') { startPayload = await api(roomPath('/start-preview')); const p = startPayload; modal('确认开始本期', `<p>${esc(p.name)} · ${esc(p.intensity)}强度</p><section class="start-period"><div class="start-period-heading"><span>本期记录</span>${badge(p.days + ' 天')}</div><div class="start-period-dates"><div><small>开始</small><strong>${p.date.slice(5).replace('-', ' 月 ')} 日</strong><small>今天开始</small></div><span class="start-date-connector"></span><div><small>结束</small><strong>${p.endDate.slice(5).replace('-', ' 月 ')} 日</strong><small>23:59 截止</small></div></div></section><p>开始后至结束不能普通退出，目标将锁定。</p>`, btn('确认开始', 'confirm-start', 'full') + button('再等等', 'close', 'cancel')); return; }
  if (action === 'confirm-start') { await api(roomPath('/start'), 'POST', startPayload); closeModal(); await refresh({ force: true }); navigate('group'); await showReminders(); return; }
  if (action.startsWith('unit:')) { switchRecordUnit(action.split(':')[1]); return; }
  if (action === 'confirm-record') { await commitRecord(); return; }
  if (action.startsWith('analysis:')) { await refresh(); navigate('analysis/' + action.split(':')[1]); return; }
  if (action.startsWith('range:')) {
    const next = Number(action.split(':')[1]); if (next === range) return;
    range = next; selectPill($('.tabs'), range);
    const generation = epoch, currentPage = page, pending = refresh({ force: true }), request = viewRequest;
    try { await pending; }
    catch (error) { if (request !== viewRequest || generation !== epoch) return; if (range === next && page === currentPage) { range = dataRange; render(); } throw error; }
    return;
  }
  if (action.startsWith('metric:')) { metric = action.split(':')[1]; selectPill($('.group-metric'), metric); render(); return; }
  if (action.startsWith('details:')) { const m = data.members.find(m => m.id === action.split(':')[1]); modal('记录明细', `<div class="record-details-scroll">${m.summary.rows.length ? `<table class="record-list"><thead><tr><th>日期</th><th>体重 / kg</th></tr></thead><tbody>${m.summary.rows.slice().reverse().map(r => `<tr><td>${r.date}</td><td>${r.weight.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">该区间还没有记录</div>'}</div>`, '', true); return; }
  if (action === 'new-period') { draft = { name: '', intro: '', days: 14, intensity: '低', custom: false }; clearPrivate(); navigate('create'); return; }
  if (action === 'history') { if (!await ensureUser('home')) return; const result = await api('/history'); modal('历史小组', result.rooms.length ? result.rooms.map(r => button(`<strong>${esc(r.name)}</strong><small>${r.startDate} · ${r.days} 天　›</small>`, 'history-room:' + r.id, 'settings-row')).join('') : '<div class="empty">还没有结束的小组</div>', '', true); return; }
  if (action.startsWith('history-room:')) { const roomId = action.split(':')[1]; resetRecord(); data = null; await refresh({ force: true, roomId }); navigate('group'); return; }
  if (action === 'account') { modal('账号与支持', `<p>${esc(user.nickname)} · ${esc(user.phone)}</p>${button('修改昵称与查看同意', 'profile', 'settings-row')}${button('取回本人数据', 'export', 'settings-row')}${button('提交支持请求', 'support', 'settings-row')}${button('我的支持请求', 'support-list', 'settings-row')}${button('退出登录', 'logout', 'settings-row')}${button('注销并删除数据', 'delete', 'settings-row')}`, '', true); return; }
  if (action === 'profile') { nextPage = 'home'; navigate('profile'); return; }
  if (action === 'export') { const result = await api('/me/export'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })); link.download = '上秤-本人数据.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); return; }
  if (action === 'support') { modal('提交支持请求', '<form id="support-form" data-form="support"><label class="field"><span class="field-label">问题描述</span><textarea name="message" maxlength="1000" required placeholder="请勿填写验证码或其他人的身体数据"></textarea></label><p class="sub">' + (appMode === 'test' ? '请求保存在测试环境，需由开发者查看处理。' : '请求保存在本机，需由本地开发者查看处理。') + '</p><p id="modal-error" class="error"></p></form>', '<button class="btn full" form="support-form" type="submit">提交</button>' + button('取消', 'close', 'cancel'), true); return; }
  if (action === 'support-list') { const result = await api('/support'); modal('我的支持请求', result.requests.length ? result.requests.map(r => `<section class="support-item"><strong>${esc(r.message)}</strong><p class="sub">${r.status === 'OPEN' ? '待处理' : '已处理'} · ${esc(r.id.slice(0, 8))}</p></section>`).join('') : '<div class="empty">没有支持请求</div>', '', true); return; }
  if (action === 'logout') { await api('/auth/logout', 'POST', {}); user = null; clearPrivate(); navigate('home'); return; }
  if (action === 'delete') { modal('注销并删除数据', '<form id="delete-form" data-form="delete"><p>将立即删除本人的账号、会话、准备和记录，其他成员无法再读取这些数据。此操作不可恢复。</p>' + field('输入「注销并删除我的数据」确认', 'confirm', '', 'autocomplete="off" required') + '<p id="modal-error" class="error"></p></form>', '<button class="btn full" type="submit" form="delete-form">确认注销</button>' + button('取消', 'close', 'cancel'), true); return; }
}
async function commitRecord() {
  const pending = uncertainRecord || { path: roomPath('/records'), body: { ...savePayload } };
  let result;
  try { result = await api(pending.path, 'PUT', pending.body); }
  catch (e) { if (e.code === 'NETWORK') { uncertainRecord = pending; closeModal(); render(); } else if (e.code !== 'STALE_SESSION') uncertainRecord = null; throw e; }
  uncertainRecord = null; savePayload = null;
  recordKg = result.weight; recordVersion = result.version; recordDate = result.date;
  const records = mine().records, old = records.findIndex(r => r.date === result.date);
  if (old >= 0) records[old] = result; else { records.push(result); records.sort((a, b) => a.date.localeCompare(b.date)); }
  closeModal(); render(); toast('记录已保存');
  try { await refresh(); } catch (e) { if (e.code === 'NETWORK') toast('记录已保存，数据同步暂时中断'); else throw e; }
}
async function submit(form) {
  const values = Object.fromEntries(new FormData(form));
  if (['login', 'test-login'].includes(form.dataset.form)) { const testing = form.dataset.form === 'test-login'; loginPhone = testing ? '' : values.phone.trim(); const result = await api(testing ? '/auth/test-login' : '/auth/login', 'POST', testing ? { code: values.code.trim() } : { phone: loginPhone, code: values.code.trim() }, { allowAnonymous: true }); const publicInvite = invite; clearPrivate(); invite = publicInvite; user = result.user; developmentCode = ''; await refresh(); navigate(user.consent ? nextPage : 'profile'); }
  else if (form.dataset.form === 'profile') { await api('/me', 'PATCH', { nickname: values.nickname, adult: values.adult === 'on', sensitiveConsent: values.sensitiveConsent === 'on' }); await refresh(); navigate(nextPage); }
  else if (form.dataset.form === 'create') {
    const n = Number(draft.days); if (!/^\d+$/.test(String(draft.days)) || !Number.isInteger(n) || n < 14 || n > 90) throw new Error('请输入 14–90 之间的整数天数');
    modal('确认创建小组', `<dl class="create-summary"><div><dt>小组名称</dt><dd>${esc(draft.name.trim() || '晚饭后散步小队')}</dd></div><div><dt>本期天数</dt><dd>${n} 天</dd></div><div><dt>强度</dt><dd>${badge(draft.intensity)}</dd></div></dl><p class="sub">${sharingText}</p><label class="check"><input id="create-sharing" type="checkbox"><span>我同意本期组内共享及参与规则</span></label><p id="modal-error" class="error"></p>`, btn('确认创建', 'confirm-create', 'full', 'id="confirm-create-button" disabled') + button('返回修改', 'close', 'cancel'));
  }
  else if (form.dataset.form === 'invite') { const result = await api('/invites/' + encodeURIComponent(values.code.trim().toUpperCase())); invite = result.invite; navigate('invite'); }
  else if (form.dataset.form === 'join') { if (!await ensureUser('invite')) return; const result = await api('/invites/' + invite.code, 'POST', { sharingConsent: values.sharingConsent === 'on', ...(invite.status === 'ACTIVE' ? { height: Number(values.height), weight: Number(values.weight), date: invite.today, version: invite.version } : {}) }); history.replaceState(null, '', '/#home'); data = null; user.currentRoomId = result.roomId; await refresh({ force: true, roomId: result.roomId }); navigate(room().status === 'LOBBY' ? 'lobby' : 'group'); }
  else if (form.dataset.form === 'prepare') { await api(roomPath('/preparation'), 'PUT', { height: Number(values.height), weight: Number(values.weight), version: preparedPayload.version }); closeModal(); await refresh({ force: true }); }
  else if (form.dataset.form === 'edit') { await api(roomPath(), 'PATCH', { ...editDraft, days: Number(editDraft.days) }); closeModal(); await refresh({ force: true }); }
  else if (form.dataset.form === 'record') {
    if (uncertainRecord) { await commitRecord(); return; }
    const raw = values.weight.trim(); if (!raw || !Number.isFinite(Number(raw))) throw new Error('请输入有效体重');
    const kg = unit === 'jin' ? Number(raw) / 2 : Number(raw); if (kg < 20 || kg > 300) throw new Error('体重须在 20–300 kg 之间');
    recordKg = kg;
    savePayload = { weight: kg, unit: 'kg', date: recordDate, version: recordVersion, overwrite: recordVersion > 0 };
    if (recordVersion) {
      const old = mine().records.find(r => r.date === recordDate);
      modal('修改今日记录', `<div class="record-edit-values" role="group" aria-label="记录修改前后对照"><div class="record-edit-before"><span>原记录</span><strong>${old?.weight.toFixed(2) ?? '—'}<small>kg</small></strong></div><div class="record-edit-after"><span>修改为</span><strong>${round2(kg).toFixed(2)}<small>kg</small></strong></div><span class="record-edit-arrow" aria-hidden="true">→</span></div><p id="modal-error" class="error" role="alert"></p>`, btn('确认修改', 'confirm-record', 'full') + button('取消', 'close', 'cancel'), false, 'record-edit-confirm');
    } else await commitRecord();
  }
  else if (form.dataset.form === 'support') { const result = await api('/support', 'POST', { message: values.message }); modal('请求已保存', `<p>编号：${esc(result.requestId.slice(0, 8))}</p><p>等待${appMode === 'test' ? '' : '本地'}开发者处理，可在“我的支持请求”查看状态。</p>`); }
  else if (form.dataset.form === 'delete') { await api('/me', 'DELETE', { confirm: values.confirm }); user = null; clearPrivate(); navigate('home'); toast('账号及本人数据已删除'); }
}
async function run(action) {
  if (busy) return; busy = true;
  const focus = document.activeElement;
  syncBusyButtons();
  try { await action(); }
  catch (e) {
    if (e.code === 'STALE_SESSION') return;
    const node = $('#modal-error') || $('#form-error'); if (node) node.textContent = e.message; toast(e.message);
    if (['VERSION_CONFLICT', 'PREVIEW_STALE', 'BUSINESS_DATE_CHANGED', 'INVITE_CHANGED', 'NETWORK'].includes(e.code)) {
      try { await refresh(); if (e.code === 'BUSINESS_DATE_CHANGED') { recordDate = today; recordVersion = mine()?.records.find(r => r.date === today)?.version || 0; closeModal(); render(); toast('已切换到今天，请核对日期与输入后重新保存'); } else if (e.code === 'VERSION_CONFLICT' && page === 'record') { recordVersion = mine().records.find(r => r.date === recordDate)?.version || 0; closeModal(); render(); } else if (e.code === 'INVITE_CHANGED') { invite = (await api('/invites/' + invite.code)).invite; closeModal(); render(); } else if (page === 'lobby') closeModal(); } catch { /* Keep draft visible when the connection is unavailable. */ }
    }
    if (e.code === 'FORBIDDEN') { clearPrivate(); navigate('home'); }
  }
  finally { busy = false; document.querySelectorAll('button[data-busy]').forEach(b => { b.disabled = false; delete b.dataset.busy; }); if (focus?.isConnected && focus.closest('.nav-track') && document.activeElement === document.body) focus.focus({ preventScroll: true }); }
}
document.addEventListener('click', event => {
  const element = event.target.closest('[data-act]'); if (!element || element.disabled) return;
  event.preventDefault();
  // Read-only chart filters remain responsive while a range request is in flight.
  if (/^(range|metric):/.test(element.dataset.act)) {
    if (!busy) act(element.dataset.act, element).catch(error => { toast(error.message); if (error.code === 'FORBIDDEN') { clearPrivate(); navigate('home'); } });
    return;
  }
  run(() => act(element.dataset.act, element));
});
document.addEventListener('submit', event => { const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault(); run(() => submit(form)); });
document.addEventListener('input', event => {
  const input = event.target, form = input.closest('form'); if (!form) return;
  const d = form.dataset.form === 'edit' ? editDraft : draft;
  if (['create', 'edit'].includes(form.dataset.form)) { if (input.name === 'days') { d.days = input.value; d.custom = true; $('#days-error').textContent = ''; } else if (['name', 'intro'].includes(input.name)) d[input.name] = input.value; }
  if (form.dataset.form === 'record' && input.name === 'weight') recordKg = input.value.trim() && Number.isFinite(Number(input.value)) ? Number(input.value) / (unit === 'jin' ? 2 : 1) : null;
  if (form.dataset.form === 'prepare') { const values = Object.fromEntries(new FormData(form)), panel = $('#goal-preview'); try { const goal = calculateGoal(Number(values.height), Number(values.weight), room().days, room().intensity); panel.hidden = false; panel.innerHTML = `<small>本期目标体重</small><div class="big">${goal.target.toFixed(2)}<span class="unit">kg</span></div>`; } catch { panel.hidden = true; } }
});
document.addEventListener('focusin', event => {
  const input = event.target; if (input.name !== 'days') return;
  const d = input.closest('form')?.dataset.form === 'edit' ? editDraft : draft; d.custom = true; d.days = input.value;
  document.querySelectorAll('.period-options button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); b.querySelector('.period-check').textContent = ''; }); $('#custom-option').classList.add('active'); $('#custom-option .period-check').textContent = '✓';
});
document.addEventListener('focusout', event => { const input = event.target; if (input.name !== 'days' || event.relatedTarget?.closest('.period-options button')) return; if (!/^\d+$/.test(input.value) || Number(input.value) < 14 || Number(input.value) > 90) $('#days-error').textContent = '请输入 14–90 之间的整数'; });
document.addEventListener('change', event => { if (event.target.id === 'create-sharing') $('#confirm-create-button').disabled = !event.target.checked; });
document.addEventListener('keydown', event => {
  const dialog = $('#overlay [role="dialog"]');
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Enter' && event.target.matches('circle[data-act]')) run(() => act('point', event.target));
  if (dialog && event.key === 'Tab') { const nodes = [...dialog.querySelectorAll('button:not(:disabled),input,textarea,a[href],[tabindex="0"]')], first = nodes[0], last = nodes.at(-1); if (!nodes.length) { event.preventDefault(); return; } if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { last.focus(); event.preventDefault(); } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { first.focus(); event.preventDefault(); } }
});
window.addEventListener('hashchange', () => { if (routePage() !== page || (routeRoom() && routeRoom() !== room()?.id)) { page = routePage(); closeModal(); if (routeRoom() && routeRoom() !== room()?.id) { resetRecord(); data = null; } render(); if (user && (['lobby', 'group', 'data', 'record'].includes(page) || page.startsWith('analysis/'))) run(() => refresh({ force: true })); } });
window.addEventListener('pageshow', event => { if (event.persisted) boot(); });
async function poll() {
  clearTimeout(timer);
  if (!document.hidden && user && !busy) {
    try { await refresh(); await showReminders(); pollFailures = 0; } catch (e) { pollFailures++; if (pollFailures === 1 && user) toast('同步暂时中断，正在重试'); }
  }
  timer = setTimeout(poll, Math.min(60000, 5000 * 2 ** Math.min(pollFailures, 4)));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else poll(); });
async function boot() {
  clearTimeout(timer);
  try {
    const config = await api('/config', 'GET', undefined, { allowAnonymous: true }); appMode = config.mode;
    const notice = $('#environment'); notice.hidden = appMode !== 'test';
    notice.textContent = appMode === 'test' ? '联机测试 · 仅使用合成数据' : '';
    document.body.classList.toggle('test-environment', appMode === 'test');
  } catch (e) { toast('无法确认运行环境，请刷新重试'); return; }
  try { const result = await api('/me', 'GET', undefined, { allowAnonymous: true }); user = result.user; today = result.today; if (user.currentRoomId || routeRoom()) await refresh(); }
  catch (e) { if (e.code !== 'UNAUTHENTICATED') toast(e.message); if (e.code === 'FORBIDDEN' && user) { data = null; page = 'home'; history.replaceState(null, '', '/#home'); } else { user = null; data = null; } }
  const code = new URLSearchParams(location.search).get('invite');
  if (code) { history.replaceState(null, '', '/?invite=' + encodeURIComponent(code) + '#invite'); page = 'join'; try { invite = (await api('/invites/' + encodeURIComponent(code.toUpperCase()))).invite; nextPage = 'invite'; page = 'invite'; } catch (e) { toast(e.message); } }
  if (!user && !['home', 'join', 'invite', 'login'].includes(page)) { nextPage = page; page = 'login'; }
  if (user && ['lobby', 'group', 'record', 'data'].includes(page) && !data) page = 'home';
  render(); timer = setTimeout(poll, 5000);
}
boot();
