<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  UsersRound,
  Scale,
  ChartNoAxesCombined,
  House,
  History,
  Settings2,
  Copy,
  Check,
  ChevronRight,
  Leaf,
  Heart,
  LogOut,
  Download,
  MessageCircle,
  ShieldCheck,
  Pencil,
  CalendarDays,
  CircleHelp,
  X,
} from 'lucide-vue-next'
import { api, ApiError, resetIdentity, token, requestKey } from './api/client'
import type { User, Snapshot, Member } from './api/client'
import Segment from './components/Segment.vue'
import Sheet from './components/Sheet.vue'
import Trend from './components/Trend.vue'

// 应用配置、登录身份与页面状态
const config = ref<{
  mode: string
  login: string
  syntheticOnly: boolean
  realSms: boolean
} | null>(null)
const user = ref<User | null>(null)
const snap = ref<Snapshot | null>(null)
const loading = ref(true)
const fatal = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)
const page = ref('home')
const roomId = ref('')
const analysisId = ref('')
const sheet = ref('')
const range = ref(28)
const dimension = ref('change')
const loadedRange = ref(28)

// 登录表单与验证码倒计时
const phone = ref('')
const code = ref('')
const developmentCode = ref('')
const cooldownUntil = ref(0)
const now = ref(Date.now())
const cooldown = computed(() => Math.max(0, Math.ceil((cooldownUntil.value - now.value) / 1000)))

// 个人资料与同意确认
const nickname = ref('')
const avatar = ref('🌱')
const adult = ref(false)
const sensitive = ref(false)
const avatars = ['🌱', '🐱', '🐶', '🐼', '🦊', '🐰', '🐻', '🐧', '🌻', '🍊', '🥑', '⭐']

// 创建小组和邀请表单
const groupName = ref('')
const intro = ref('')
const days = ref<number | string>(14)
const intensity = ref('低')
const extremeConfirmed = ref(false)
const sharing = ref(false)
const inviteCode = ref(new URLSearchParams(location.search).get('invite') || '')
const invite = ref<any>(null)

// 准备信息与当天记录输入
const height = ref<number | string>('')
const startWeight = ref<number | string>('')
const recordValue = ref('')
const unit = ref('kg')

// 账号支持与历史小组
const supportMessage = ref('')
const supportRequests = ref<any[]>([])
const history = ref<any[]>([])
const deletionText = ref('')
const preview = ref<any>(null)
const copyDone = ref(false)
const nextAfterLogin = ref('home')
const editVersion = ref(0)

// 结果未知时保留原请求，避免重复保存
type Pending = {
  key: string
  room: string
  body: { date: string; weight: number; unit: string; version: number; overwrite: boolean }
}
const pending = ref<Pending | null>(null)
const unknown = ref(false)
const conflict = ref<any>(null)
const recordDirty = ref(false)
const original = ref<{ weight: number; version: number } | null>(null)
const mutationKeys = new Map<string, string>()

// 从已加载的小组数据派生界面状态
const mine = computed(() => snap.value?.members.find((m) => m.userId === user.value?.id))
const room = computed(() => snap.value?.room)
const isOwner = computed(() => !!user.value && room.value?.ownerId === user.value.id)
const allReady = computed(
  () => !!snap.value && snap.value.members.length >= 2 && snap.value.members.every((m) => m.ready),
)
const selectedMember = computed(
  () => snap.value?.members.find((m) => m.userId === analysisId.value) || mine.value,
)
const target = computed(() =>
  mine.value?.target == null
    ? '—'
    : (mine.value.target * (unit.value === 'jin' ? 2 : 1)).toFixed(2),
)
const link = computed(() => `${location.origin}/?invite=${room.value?.inviteCode || ''}`)
const daysOptions = [
  { value: 14, label: '14 天' },
  { value: 28, label: '28 天' },
  { value: 56, label: '56 天' },
]
const colors = [
  '#CF4938',
  '#6B80C6',
  '#B96491',
  '#9471BC',
  '#32978F',
  '#C18A35',
  '#628D50',
  '#5C91B2',
]
const goalPreview = computed(() => {
  const h = Number(height.value)
  const w = Number(startWeight.value)
  const t =
    invite.value?.status === 'ACTIVE'
      ? invite.value.remaining
      : Number(room.value?.days || days.value)
  const level = room.value?.intensity || invite.value?.intensity || intensity.value
  if (h < 80 || h > 250 || w < 20 || w > 300 || !Number.isInteger(t) || t < 14 || t > 90)
    return null
  const f =
    t <= 28
      ? 0.6 + ((t - 14) * 0.4) / 14
      : t <= 56
        ? 1 + ((t - 28) * 0.8) / 28
        : 1.8 + ((t - 56) * 0.8) / 34
  return (
    w -
    w *
      ({ 低: 0.02, 中: 0.03, 高: 0.04, 极高: 0.05 }[level as '低'] || 0.02) *
      Math.min(1.25, Math.max(0.75, w / (h / 100) ** 2 / 22)) *
      f
  ).toFixed(2)
})
const pageTitle = computed(
  () =>
    ({
      home: '一起，慢慢变好',
      create: '创建一个小组',
      join: '加入朋友的小组',
      invite: '一起记录这段改变',
      login: '欢迎来到上秤',
      profile: '先认识一下你',
      group: room.value?.name || '我的小组',
      record: '记录今天',
      data: '每个人的小改变',
      analysis: `${selectedMember.value?.nickname || '个人'}的记录`,
    })[page.value] || '上秤',
)

function navigate(path: string, id = roomId.value) {
  location.hash = `/${path}${id && ['group', 'record', 'data', 'analysis'].includes(path) ? `?room=${id}${path === 'analysis' ? `&user=${analysisId.value}` : ''}` : ''}`
}
function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(query)
  const allowed = [
    'home',
    'login',
    'profile',
    'create',
    'join',
    'invite',
    'group',
    'record',
    'data',
    'analysis',
  ]
  page.value = allowed.includes(path || '') ? path : 'home'
  roomId.value =
    params.get('room') ||
    (['group', 'record', 'data', 'analysis'].includes(page.value)
      ? user.value?.currentRoomId || ''
      : '')
  analysisId.value = params.get('user') || user.value?.id || ''
  error.value = ''
  if (!loading.value && !user.value && !['home', 'login', 'invite', 'join'].includes(page.value)) {
    nextAfterLogin.value = page.value
    navigate('login')
    return
  }
  if (
    !loading.value &&
    user.value &&
    !user.value.consent &&
    !['profile', 'home'].includes(page.value)
  ) {
    nextAfterLogin.value = page.value
    initProfile()
    navigate('profile')
  }
}
function initProfile() {
  nickname.value = user.value?.nickname || ''
  avatar.value = user.value?.avatar || '🌱'
  adult.value = false
  sensitive.value = false
}

function openProfileEditor() {
  initProfile()
  sheet.value = 'profile'
}

function closeSheet() {
  sheet.value = ''
  error.value = ''
}

function confirmExtreme() {
  intensity.value = '极高'
  extremeConfirmed.value = true
  sheet.value = ''
}

function useLatestRecord() {
  sheet.value = ''
  initRecord()
}

function keepRecordInput() {
  sheet.value = conflict.value ? 'overwrite' : ''
  if (!conflict.value) void saveRecord()
}

function openDeletion() {
  deletionText.value = ''
  sheet.value = 'delete'
}

function openHistoryRoom(id: string) {
  sheet.value = ''
  navigate('group', id)
}

function clear() {
  user.value = null
  snap.value = null
  sheet.value = ''
  pending.value = null
  unknown.value = false
  original.value = null
  recordValue.value = ''
  height.value = ''
  startWeight.value = ''
  nickname.value = ''
  avatar.value = '🌱'
  adult.value = false
  sensitive.value = false
  sharing.value = false
  groupName.value = ''
  intro.value = ''
  supportMessage.value = ''
  supportRequests.value = []
  history.value = []
  conflict.value = null
  mutationKeys.clear()
  resetIdentity()
  loadTicket++
}
function sessionExpired() {
  clear()
  notice.value = '登录已过期，请重新登录'
  nextAfterLogin.value = 'home'
  navigate('login')
}
async function loadUser() {
  const data = await api('/me')
  user.value = data.user
  token(data.user.csrf)
}
async function bootstrap() {
  loading.value = true
  fatal.value = ''
  try {
    config.value = await api('/config')
    try {
      await loadUser()
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'UNAUTHENTICATED') throw e
    }
    loading.value = false
    route()
    if (inviteCode.value) {
      if (user.value?.currentRoomId) {
        inviteCode.value = ''
        cleanInvite()
        navigate('group', user.value.currentRoomId)
      } else {
        navigate('invite')
        await lookupInvite()
      }
    } else if (roomId.value) await refresh()
  } catch (e) {
    fatal.value = message(e)
    loading.value = false
  }
}
function message(e: unknown) {
  return e instanceof Error ? e.message : '暂时无法完成，请重试'
}
async function action(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function write(path: string, method: string, body: unknown) {
  const signature = `${method}:${path}:${JSON.stringify(body)}`
  const key = mutationKeys.get(signature) || requestKey()
  mutationKeys.set(signature, key)
  try {
    const result = await api(path, method, body, key)
    mutationKeys.delete(signature)
    return result
  } catch (e) {
    if (e instanceof ApiError && !e.uncertain) mutationKeys.delete(signature)
    throw e
  }
}
function requireLogin(destination: string) {
  if (!user.value) {
    nextAfterLogin.value = destination
    navigate('login')
  } else if (!user.value.consent) {
    nextAfterLogin.value = destination
    initProfile()
    navigate('profile')
  } else navigate(destination)
}
async function sendCode() {
  await action(async () => {
    try {
      const data = await api('/auth/code', 'POST', { phone: phone.value })
      developmentCode.value = data.developmentCode || ''
      cooldownUntil.value = Date.now() + data.retryAfter * 1000
    } catch (e) {
      cooldownUntil.value =
        Date.now() + (e instanceof ApiError ? e.details.retryAfter || 60 : 60) * 1000
      throw e
    }
  })
}
async function login() {
  await action(async () => {
    const data = await api(
      config.value?.mode === 'test' ? '/auth/test-login' : '/auth/login',
      'POST',
      config.value?.mode === 'test'
        ? { code: code.value }
        : { phone: phone.value, code: code.value },
    )
    resetIdentity(data.user.csrf)
    user.value = data.user
    code.value = ''
    developmentCode.value = ''
    phone.value = ''
    if (!data.user.consent) {
      initProfile()
      navigate('profile')
    } else await afterLogin()
  })
}
async function afterLogin() {
  if (user.value?.currentRoomId) {
    cleanInvite()
    navigate('group', user.value.currentRoomId)
  } else if (inviteCode.value) {
    navigate('invite')
    await resolveInvite()
  } else navigate(nextAfterLogin.value === 'profile' ? 'home' : nextAfterLogin.value)
}
async function saveProfile() {
  await action(async () => {
    await write('/me/profile', 'POST', {
      nickname: nickname.value,
      avatar: avatar.value,
      ...(!user.value?.consent ? { adult: adult.value, sensitiveConsent: sensitive.value } : {}),
    })
    await loadUser()
    if (sheet.value === 'profile') {
      sheet.value = ''
      if (roomId.value) await refresh()
    } else await afterLogin()
  })
}
function newGroup() {
  groupName.value = ''
  intro.value = ''
  days.value = 14
  intensity.value = '低'
  sharing.value = false
  extremeConfirmed.value = false
  requireLogin('create')
}
function chooseIntensity(value: string) {
  if (value === '极高') sheet.value = 'extreme'
  else {
    intensity.value = value
    extremeConfirmed.value = false
  }
}
function confirmCreate() {
  error.value = ''
  if (!Number.isInteger(Number(days.value)) || Number(days.value) < 14 || Number(days.value) > 90) {
    error.value = '周期须为14至90天的整数'
    return
  }
  sharing.value = false
  sheet.value = 'create'
}
async function create() {
  await action(async () => {
    const data = await write('/rooms', 'POST', {
      name: groupName.value,
      intro: intro.value,
      days: Number(days.value),
      intensity: intensity.value,
      extremeConfirmed: extremeConfirmed.value,
      sharingConsent: sharing.value,
    })
    sheet.value = ''
    await loadUser()
    navigate('group', data.roomId)
  })
}
function cleanInvite() {
  const url = new URL(location.href)
  url.searchParams.delete('invite')
  window.history.replaceState(null, '', url)
}
async function lookupInvite() {
  await action(resolveInvite)
}
async function resolveInvite() {
  if (user.value?.currentRoomId) {
    cleanInvite()
    navigate('group', user.value.currentRoomId)
    return
  }
  invite.value = null
  const data = await api(`/invites/${encodeURIComponent(inviteCode.value.trim().toUpperCase())}`)
  if (data.invite.memberRoomId) {
    cleanInvite()
    navigate('group', data.invite.memberRoomId)
    return
  }
  invite.value = data.invite
  sharing.value = false
  navigate('invite')
}
async function join() {
  if (!user.value || !user.value.consent) {
    requireLogin('invite')
    return
  }
  await action(async () => {
    const data = await write(`/invites/${inviteCode.value.trim().toUpperCase()}`, 'POST', {
      sharingConsent: sharing.value,
      ...(invite.value.status === 'ACTIVE'
        ? {
            height: Number(height.value),
            weight: Number(startWeight.value),
            date: invite.value.today,
            version: invite.value.version,
          }
        : {}),
    })
    cleanInvite()
    inviteCode.value = ''
    invite.value = null
    await loadUser()
    navigate('group', data.roomId)
  })
}
let loadTicket = 0
async function refresh(chosenRange = range.value) {
  if (!roomId.value || !user.value) return
  const ticket = ++loadTicket
  const id = roomId.value
  try {
    const data = await api<Snapshot>(`/rooms/${id}?range=${chosenRange}`)
    if (ticket !== loadTicket || id !== roomId.value) return
    snap.value = data
    loadedRange.value = chosenRange
    if (data.room.status === 'ENDED' && page.value === 'record') navigate('group', id)
  } catch (e) {
    if (ticket !== loadTicket) return
    range.value = loadedRange.value
    throw e
  }
}
async function openPreparation() {
  await action(async () => {
    const data = await api(`/rooms/${roomId.value}/preparation`)
    height.value = data.height ?? ''
    startWeight.value = data.weight ?? ''
    editVersion.value = data.version
    sheet.value = 'prepare'
  })
}
async function prepare() {
  await action(async () => {
    await write(`/rooms/${roomId.value}/preparation`, 'PUT', {
      height: Number(height.value),
      weight: Number(startWeight.value),
      version: editVersion.value,
    })
    sheet.value = ''
    await refresh()
  })
}
function openEdit() {
  groupName.value = room.value?.name || ''
  intro.value = room.value?.intro || ''
  days.value = room.value?.days || 14
  editVersion.value = room.value?.version || 0
  sheet.value = 'edit'
}
async function edit() {
  await action(async () => {
    const data = await write(`/rooms/${roomId.value}`, 'PATCH', {
      name: groupName.value,
      intro: intro.value,
      days: Number(days.value),
      version: editVersion.value,
    })
    sheet.value = ''
    if (data.needsReconfirmation) notice.value = '周期已更新，请所有成员重新确认准备'
    await refresh()
  })
}
async function startPreview() {
  await action(async () => {
    preview.value = await api(`/rooms/${roomId.value}/start-preview`)
    sheet.value = 'start'
  })
}
async function start() {
  await action(async () => {
    await write(`/rooms/${roomId.value}/start`, 'POST', {
      version: preview.value.version,
      date: preview.value.date,
      expiresAt: preview.value.expiresAt,
    })
    sheet.value = ''
    await refresh()
  })
}
async function leave() {
  await action(async () => {
    await write(`/rooms/${roomId.value}/leave`, 'POST', {})
    snap.value = null
    sheet.value = ''
    await loadUser()
    navigate('home')
  })
}
function initRecord() {
  if (pending.value?.room === roomId.value) return
  original.value = mine.value?.todayRecord
    ? { weight: mine.value.todayRecord.weight, version: mine.value.todayRecord.version || 0 }
    : null
  recordValue.value = original.value
    ? (original.value.weight * (unit.value === 'jin' ? 2 : 1)).toFixed(2)
    : ''
}
function switchUnit(value: string | number) {
  const next = String(value)
  if (next === unit.value) return
  recordDirty.value = true
  if (recordValue.value)
    recordValue.value = String(Number(recordValue.value) * (next === 'jin' ? 2 : 0.5))
  unit.value = next
}
function confirmRecord() {
  error.value = ''
  if (unknown.value) {
    void saveRecord()
    return
  }
  const weight = Number(recordValue.value)
  const kg = weight / (unit.value === 'jin' ? 2 : 1)
  if (!Number.isFinite(kg) || kg < 20 || kg > 300) {
    error.value = '请输入20至300公斤范围内的体重'
    return
  }
  if (original.value) sheet.value = 'overwrite'
  else void saveRecord()
}
async function saveRecord() {
  await action(async () => {
    if (!pending.value)
      pending.value = {
        key: requestKey(),
        room: roomId.value,
        body: {
          date: snap.value!.today,
          weight: Number(recordValue.value),
          unit: unit.value,
          version: original.value?.version || 0,
          overwrite: !!original.value,
        },
      }
    try {
      const request = pending.value
      const result = await api(`/rooms/${request.room}/records`, 'PUT', request.body, request.key)
      pending.value = null
      unknown.value = false
      conflict.value = null
      original.value = { weight: result.weight, version: result.version }
      sheet.value = ''
      notice.value = '今天的记录已保存'
      navigate('group', request.room)
      try {
        await refresh()
      } catch {
        notice.value = '记录已保存，数据同步暂时中断'
      }
    } catch (e) {
      if (e instanceof ApiError && e.uncertain) {
        unknown.value = true
        sheet.value = ''
        error.value = '暂时无法确认是否保存，请核对保存结果'
        return
      }
      pending.value = null
      unknown.value = false
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        conflict.value = e.details.latest
        original.value = e.details.latest
        sheet.value = 'conflict'
        return
      }
      if (e instanceof ApiError && e.code === 'BUSINESS_DATE_CHANGED') {
        await refresh()
        sheet.value = ''
        throw new Error('日期已变化，输入已保留，请重新确认今天的记录')
      }
      throw e
    }
  })
}
function analyze(member: Member) {
  analysisId.value = member.userId
  navigate('analysis')
}
async function showHistory() {
  await action(async () => {
    history.value = (await api('/history')).rooms
    sheet.value = 'history'
  })
}
function openAccount() {
  if (!user.value) {
    requireLogin('home')
    return
  }
  sheet.value = 'account'
}
async function logout() {
  await action(async () => {
    await api('/auth/logout', 'POST', {})
    clear()
    navigate('home')
  })
}
async function exportData() {
  await action(async () => {
    const data = await api('/me/export')
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'my-data.json'
    a.click()
    URL.revokeObjectURL(url)
  })
}
async function openSupport() {
  await action(async () => {
    supportRequests.value = (await api('/support')).requests
    sheet.value = 'support'
  })
}
async function submitSupport() {
  await action(async () => {
    const result = await write('/support', 'POST', { message: supportMessage.value })
    supportMessage.value = ''
    notice.value = `问题已保存，编号 ${result.supportRequestId.slice(0, 8)}`
    supportRequests.value = (await api('/support')).requests
  })
}
async function deleteAccount() {
  await action(async () => {
    await api('/me', 'DELETE', { confirm: deletionText.value })
    clear()
    deletionText.value = ''
    notice.value = '账号在线数据已删除，旧备份恢复时将重放删除清单'
    navigate('home')
  })
}
async function copyInvite() {
  try {
    await navigator.clipboard.writeText(link.value)
    copyDone.value = true
    setTimeout(() => (copyDone.value = false), 2000)
  } catch {
    notice.value = '请长按下方链接手动复制'
  }
}
let timer: ReturnType<typeof setTimeout>
let clockTimer: ReturnType<typeof setInterval>
let failures = 0
async function poll() {
  if (document.hidden) return
  try {
    if (user.value && roomId.value && ['group', 'record', 'analysis', 'data'].includes(page.value))
      await refresh()
    failures = 0
  } catch {
    failures++
    if (failures === 1) notice.value = '数据同步暂时中断，正在等待恢复'
  }
  timer = setTimeout(poll, Math.min(60000, 5000 * 2 ** failures))
}
function visibility() {
  clearTimeout(timer)
  if (!document.hidden) void poll()
}
watch(page, async (value) => {
  if (loading.value) return
  if (value === 'record') {
    recordDirty.value = false
    initRecord()
  }
  if (['group', 'record', 'data', 'analysis'].includes(value) && roomId.value) {
    try {
      await refresh()
      if (value === 'record' && !recordDirty.value) initRecord()
      if (value === 'group' && room.value?.status === 'ACTIVE') {
        const data = await write(`/rooms/${roomId.value}/reminders`, 'POST', {})
        if (data.reminders.length)
          notice.value = data.reminders
            .map((r: any) => `${r.nickname}已${r.missingDays}天未记录`)
            .join('；')
      }
    } catch (e) {
      error.value = message(e)
    }
  }
})
watch(roomId, async (value, previous) => {
  if (value !== previous) {
    snap.value = null
    recordDirty.value = false
    if (value && !loading.value)
      try {
        await refresh()
        if (page.value === 'record' && !recordDirty.value) initRecord()
      } catch (e) {
        error.value = message(e)
      }
  }
})
watch(range, async (value) => {
  if (value === loadedRange.value) return
  try {
    await refresh(value)
  } catch (e) {
    error.value = message(e)
  }
})
onMounted(() => {
  window.addEventListener('hashchange', route)
  window.addEventListener('session-expired', sessionExpired)
  document.addEventListener('visibilitychange', visibility)
  clockTimer = setInterval(() => (now.value = Date.now()), 1000)
  void bootstrap()
  timer = setTimeout(poll, 5000)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  clearInterval(clockTimer)
  window.removeEventListener('hashchange', route)
  window.removeEventListener('session-expired', sessionExpired)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <button
        class="brand"
        @click="navigate('home')"
      >
        <span class="brand-icon">
          <Scale
            :size="22"
            :stroke-width="1.6"
          />
        </span>
        <span>
          上秤
          <span class="brand-period">.</span>
        </span>
      </button>
      <div class="brand-caption">一点一滴，一起变好</div>
      <nav
        class="side-nav"
        aria-label="主导航"
      >
        <button
          :class="{ active: page === 'home' }"
          @click="navigate('home')"
        >
          <House :size="19" />
          首页
          <span
            v-if="page === 'home'"
            class="nav-dot"
          ></span>
        </button>
        <button
          :class="{ active: ['group', 'analysis'].includes(page) }"
          @click="
            user?.currentRoomId ? navigate('group', user.currentRoomId) : requireLogin('join')
          "
        >
          <UsersRound :size="19" />
          我的小组
        </button>
        <template v-if="room && room.status !== 'LOBBY'">
          <button
            :class="{ active: page === 'record' }"
            @click="navigate('record')"
          >
            <Scale :size="19" />
            记录今天
          </button>
          <button
            :class="{ active: page === 'data' }"
            @click="navigate('data')"
          >
            <ChartNoAxesCombined :size="19" />
            小组数据
          </button>
        </template>
        <button @click="user ? showHistory() : requireLogin('home')">
          <History :size="19" />
          历史小组
        </button>
      </nav>
      <div class="side-bottom">
        <div class="side-note">
          <Leaf :size="21" />
          <p>
            不必每一天都完美。
            <br />
            每天记得关心自己。
          </p>
        </div>
        <button
          class="account-button"
          @click="openAccount()"
        >
          <span class="avatar small">{{ user?.avatar || '🌱' }}</span>
          <span>
            {{ user?.nickname || '我的账号' }}
            <small>{{ user ? '账号与支持' : '登录，开启新的一天' }}</small>
          </span>
          <Settings2 :size="17" />
        </button>
      </div>
    </aside>
    <main>
      <header class="topbar">
        <button
          class="mobile-brand"
          @click="navigate('home')"
        >
          <Scale :size="21" />
          上秤
          <span>.</span>
        </button>
        <span class="breadcrumb">日常有记录，改变有迹可循</span>
        <button
          class="environment"
          @click="sheet = 'environment'"
        >
          <span></span>
          {{
            config?.mode === 'production'
              ? '短信登录'
              : config?.realSms
                ? '短信试用环境'
                : config?.mode === 'test'
                  ? '合成体验环境'
                  : '本地开发环境'
          }}
        </button>
        <button
          class="mobile-account"
          aria-label="账号与支持"
          @click="openAccount()"
        >
          {{ user?.avatar || '🌱' }}
        </button>
      </header>
      <div
        v-if="notice"
        class="notice"
        role="status"
      >
        <span>{{ notice }}</span>
        <button
          class="icon-button"
          aria-label="关闭提示"
          @click="notice = ''"
        >
          <X :size="16" />
        </button>
      </div>
      <div
        v-if="loading"
        class="loading-state"
      >
        <span class="spinner"></span>
        <p>正在准备你的上秤空间…</p>
      </div>
      <section
        v-else-if="fatal"
        class="empty-state"
      >
        <CircleHelp :size="36" />
        <h1>暂时无法连接上秤</h1>
        <p>{{ fatal }}</p>
        <button
          class="primary"
          @click="bootstrap"
        >
          重新连接
        </button>
      </section>
      <template v-else>
        <section
          v-if="page === 'home'"
          class="home-page"
        >
          <div class="home-hero">
            <div class="hero-copy">
              <div class="eyebrow">
                <span class="tiny-line"></span>
                和朋友一起养成小习惯
              </div>
              <h1>
                每一天，
                <br />
                都算
                <span class="coral">一点进步。</span>
              </h1>
              <p class="hero-description">
                记录身体的变化，也看见彼此的坚持。
                <br />
                不比较快慢，一起把日子过得更轻盈。
              </p>
              <div
                class="hero-actions"
                v-if="user?.currentRoomId"
              >
                <button
                  class="primary"
                  @click="navigate('group', user.currentRoomId)"
                >
                  返回当前小组
                  <ArrowRight :size="18" />
                </button>
              </div>
              <div
                class="hero-actions"
                v-else
              >
                <button
                  class="primary"
                  @click="newGroup"
                >
                  <Plus :size="19" />
                  创建一个小组
                </button>
                <button
                  class="secondary"
                  @click="requireLogin('join')"
                >
                  我有邀请码
                  <ArrowUpRight :size="17" />
                </button>
              </div>
              <div class="hero-footnote">
                <ShieldCheck :size="14" />
                只在你同意的小组里分享 · 随时导出本人数据
              </div>
            </div>
            <div
              class="hero-art"
              aria-hidden="true"
            >
              <span class="orbit orbit-one"></span>
              <span class="orbit orbit-two"></span>
              <span class="art-leaf leaf-one"><Leaf :size="29" /></span>
              <span class="art-leaf leaf-two"><Heart :size="21" /></span>
              <div class="scale-art">
                <span class="scale-label">SHANGCHENG</span>
                <div class="scale-display">
                  <span class="display-line"></span>
                  <span class="display-line short"></span>
                  <span class="display-dot"></span>
                </div>
                <div class="scale-feet">
                  <i></i>
                  <i></i>
                </div>
                <span class="scale-bottom">ONE DAY AT A TIME</span>
              </div>
              <div class="art-sticker">
                <span class="sticker-check"><Check :size="15" /></span>
                <div>
                  今天，也好好照顾自己
                  <small>A LITTLE BETTER, TOGETHER</small>
                </div>
              </div>
              <span class="art-star">✳</span>
            </div>
          </div>
          <div class="section-heading">
            <h2>简单三步，开始一段小改变</h2>
            <span>把坚持，变成有人陪伴的日常</span>
          </div>
          <div class="steps-grid">
            <article>
              <div class="step-heading">
                <span class="step-icon peach"><UsersRound :size="22" /></span>
                <span class="step-number">01</span>
              </div>
              <h3>找几个朋友</h3>
              <p>
                创建或加入一个小组，最多 8 人。
                <br />
                选好周期，按自己的节奏开始。
              </p>
            </article>
            <article>
              <div class="step-heading">
                <span class="step-icon sage"><Scale :size="22" /></span>
                <span class="step-number">02</span>
              </div>
              <h3>每天，记录一下</h3>
              <p>
                上秤、填一个数字，就这么简单。
                <br />
                真实记录，比完美曲线更有意义。
              </p>
            </article>
            <article>
              <div class="step-heading">
                <span class="step-icon lavender"><ChartNoAxesCombined :size="22" /></span>
                <span class="step-number">03</span>
              </div>
              <h3>看见彼此的坚持</h3>
              <p>
                在同一张图里看到每个人的变化。
                <br />
                周期结束，一起回顾这段旅程。
              </p>
            </article>
          </div>
          <div class="home-bottom">
            <div>
              <span class="quiet-dot"></span>
              关注习惯，不以减重速度排名
            </div>
            <button
              class="text-button"
              @click="sheet = 'privacy'"
            >
              关于你的数据
              <ArrowUpRight :size="15" />
            </button>
          </div>
        </section>

        <section
          v-else-if="page === 'login'"
          class="form-page"
        >
          <button
            class="back"
            @click="navigate('home')"
          >
            <ArrowLeft :size="18" />
            返回首页
          </button>
          <div class="eyebrow">HELLO, NEW DAY</div>
          <h1>{{ pageTitle }}</h1>
          <p class="subtitle">
            {{
              config?.mode === 'test'
                ? '使用专属体验凭据，进入合成数据环境。'
                : '登录后，和朋友开启一段小改变。'
            }}
          </p>
          <form
            class="form-card"
            @submit.prevent="login"
          >
            <template v-if="config?.mode !== 'test'">
              <label>
                手机号
                <input
                  v-model="phone"
                  type="tel"
                  inputmode="numeric"
                  autocomplete="tel"
                  maxlength="11"
                  placeholder="请输入手机号"
                  required
                />
              </label>
              <label>
                验证码
                <div class="input-action">
                  <input
                    aria-label="验证码"
                    v-model="code"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    placeholder="6 位验证码"
                    required
                  />
                  <button
                    type="button"
                    :disabled="cooldown > 0 || busy || !/^1[3-9]\d{9}$/.test(phone)"
                    @click="sendCode"
                  >
                    {{ cooldown ? `${cooldown}s 后重试` : '获取验证码' }}
                  </button>
                </div>
              </label>
              <div
                v-if="developmentCode"
                class="local-code"
              >
                未发送短信 · 本地模拟验证码
                <strong>{{ developmentCode }}</strong>
              </div>
            </template>
            <label v-else>
              体验凭据
              <input
                v-model="code"
                type="password"
                autocomplete="off"
                placeholder="请输入 24 位体验凭据"
                required
              />
            </label>
            <button
              class="primary full"
              :disabled="busy"
            >
              {{ busy ? '正在登录…' : '登录并继续' }}
              <ArrowRight :size="17" />
            </button>
            <p
              v-if="config?.syntheticOnly"
              class="field-hint"
            >
              本环境仅使用示例身体数据。
            </p>
          </form>
        </section>

        <section
          v-else-if="page === 'profile'"
          class="form-page"
        >
          <div class="eyebrow">NICE TO MEET YOU</div>
          <h1>{{ pageTitle }}</h1>
          <p class="subtitle">让朋友们一眼认出你。</p>
          <form
            class="form-card"
            @submit.prevent="saveProfile"
          >
            <div class="avatar-grid">
              <button
                v-for="a in avatars"
                :key="a"
                type="button"
                :class="{ selected: avatar === a }"
                :aria-pressed="avatar === a"
                :aria-label="`选择${a}头像`"
                @click="avatar = a"
              >
                {{ a }}
              </button>
            </div>
            <label>
              昵称
              <input
                v-model="nickname"
                maxlength="40"
                placeholder="怎么称呼你？"
                required
              />
            </label>
            <label class="check-row">
              <input
                v-model="adult"
                type="checkbox"
              />
              我确认已年满 18 岁
            </label>
            <label class="check-row">
              <input
                v-model="sensitive"
                type="checkbox"
              />
              <span>
                我同意身体数据的收集及组内共享，已阅读
                <button
                  class="inline-link"
                  type="button"
                  @click="sheet = 'privacy'"
                >
                  数据使用说明
                </button>
              </span>
            </label>
            <button
              class="primary full"
              :disabled="busy || !adult || !sensitive"
            >
              确认，继续
              <ArrowRight :size="18" />
            </button>
          </form>
        </section>

        <section
          v-else-if="page === 'create'"
          class="form-page"
        >
          <button
            class="back"
            @click="navigate('home')"
          >
            <ArrowLeft :size="18" />
            返回
          </button>
          <div class="eyebrow">A FRESH START</div>
          <h1>{{ pageTitle }}</h1>
          <p class="subtitle">邀请朋友，给彼此一点坚持的动力。</p>
          <form
            class="form-card"
            @submit.prevent="confirmCreate"
          >
            <label>
              小组名称
              <span class="optional">选填</span>
              <input
                v-model="groupName"
                maxlength="48"
                placeholder="晚饭后散步小队"
              />
            </label>
            <label>
              小组介绍
              <span class="optional">选填</span>
              <textarea
                v-model="intro"
                maxlength="400"
                rows="2"
                placeholder="写一句你们的小约定…"
              ></textarea>
            </label>
            <fieldset>
              <legend>这次，一起坚持多久？</legend>
              <div class="days-grid">
                <button
                  v-for="d in daysOptions"
                  :key="d.value"
                  type="button"
                  :class="{ selected: days === d.value }"
                  @click="days = Number(d.value)"
                >
                  {{ d.label }}
                </button>
                <label class="custom-days">
                  <input
                    :value="daysOptions.some((d) => d.value === days) ? '' : days"
                    type="number"
                    min="14"
                    max="90"
                    placeholder="自定义"
                    aria-label="自定义天数"
                    @input="days = ($event.target as HTMLInputElement).value"
                  />
                  <span v-if="!daysOptions.some((d) => d.value === days) && days">天</span>
                </label>
              </div>
              <p class="field-hint">14–90 天，从全员准备好后正式开始。</p>
            </fieldset>
            <fieldset>
              <legend>选择目标强度</legend>
              <div class="intensity-grid">
                <button
                  v-for="level in ['低', '中', '高', '极高']"
                  :key="level"
                  type="button"
                  :class="{ selected: intensity === level }"
                  @click="chooseIntensity(level)"
                >
                  {{ level }}
                  <small>
                    {{ { 低: '慢慢来', 中: '稳步走', 高: '挑战下', 极高: '需确认' }[level] }}
                  </small>
                </button>
              </div>
            </fieldset>
            <div class="gentle-note">
              <Leaf :size="18" />
              从低强度开始，也是一种很好的开始。
            </div>
            <button
              class="primary full"
              :disabled="busy"
            >
              下一步，确认创建
              <ArrowRight :size="17" />
            </button>
          </form>
        </section>

        <section
          v-else-if="page === 'join' || (page === 'invite' && !invite)"
          class="form-page"
        >
          <button
            class="back"
            @click="navigate('home')"
          >
            <ArrowLeft :size="18" />
            返回
          </button>
          <div class="eyebrow">BETTER TOGETHER</div>
          <h1>加入朋友的小组</h1>
          <p class="subtitle">输入朋友发来的邀请码，就能找到彼此。</p>
          <form
            class="form-card"
            @submit.prevent="lookupInvite"
          >
            <label>
              12 位邀请码
              <input
                v-model="inviteCode"
                class="invite-input"
                maxlength="12"
                placeholder="输入邀请码"
                autocomplete="off"
                autocapitalize="characters"
                required
              />
            </label>
            <button
              class="primary full"
              :disabled="busy || inviteCode.trim().length !== 12"
            >
              查看小组
              <ArrowRight :size="18" />
            </button>
          </form>
        </section>

        <section
          v-else-if="page === 'invite' && invite"
          class="form-page"
        >
          <button
            class="back"
            @click="navigate('join')"
          >
            <ArrowLeft :size="18" />
            重新输入
          </button>
          <div class="eyebrow">YOU'RE INVITED</div>
          <h1>一起记录这段改变</h1>
          <div class="form-card">
            <span class="status-badge">
              {{ invite.status === 'LOBBY' ? '正在组队' : '进行中' }}
            </span>
            <h2>{{ invite.name }}</h2>
            <p class="subtitle">{{ invite.intro || '一个人可以开始，一群人更容易坚持。' }}</p>
            <div class="three-stats">
              <div>
                <strong>
                  {{ invite.days }}
                  <small>天</small>
                </strong>
                <span>本期周期</span>
              </div>
              <div>
                <strong>
                  {{ invite.count }}
                  <small>/ 8</small>
                </strong>
                <span>小组人数</span>
              </div>
              <div>
                <strong>{{ invite.intensity }}</strong>
                <span>目标强度</span>
              </div>
            </div>
            <div
              v-if="invite.status === 'ACTIVE'"
              class="gentle-note"
            >
              剩余 {{ invite.remaining }} 天（含今天）
            </div>
            <template v-if="invite.status === 'ACTIVE' && user?.consent">
              <label>
                身高
                <span class="optional">cm · 仅本人可见</span>
                <input
                  v-model="height"
                  type="number"
                  step="any"
                  min="80"
                  max="250"
                  placeholder="填写身高"
                />
              </label>
              <label>
                起始体重
                <span class="optional">kg</span>
                <input
                  v-model="startWeight"
                  type="number"
                  step="any"
                  min="20"
                  max="300"
                  placeholder="填写体重"
                />
              </label>
              <p
                v-if="goalPreview"
                class="goal-preview"
              >
                本期目标
                <strong>{{ goalPreview }}</strong>
                kg
              </p>
            </template>
            <label class="check-row">
              <input
                v-model="sharing"
                type="checkbox"
              />
              <span>同意向组内成员共享昵称、体重记录、目标和变化趋势</span>
            </label>
            <button
              class="primary full"
              :disabled="busy || !invite.joinable || (user?.consent && !sharing)"
              @click="join"
            >
              {{
                !invite.joinable ? '当前无法加入' : user?.consent ? '确认加入小组' : '登录并继续'
              }}
              <ArrowRight :size="17" />
            </button>
          </div>
        </section>

        <template
          v-else-if="['group', 'data', 'record', 'analysis'].includes(page) && snap && room"
        >
          <section :class="['workspace-page', { 'record-page': page === 'record' }]">
            <button
              v-if="page === 'analysis'"
              class="back"
              @click="navigate('group')"
            >
              <ArrowLeft :size="18" />
              返回小组
            </button>
            <div class="page-heading">
              <div>
                <div class="eyebrow">
                  {{
                    room.status === 'LOBBY'
                      ? 'GET READY, TOGETHER'
                      : room.status === 'ENDED'
                        ? 'EVERY STEP COUNTS'
                        : page === 'record'
                          ? 'A MOMENT FOR YOURSELF'
                          : 'ONE DAY AT A TIME'
                  }}
                </div>
                <h1>{{ pageTitle }}</h1>
                <p class="subtitle">
                  {{
                    room.status === 'LOBBY'
                      ? '等大家准备好，我们就一起出发。'
                      : room.status === 'ENDED'
                        ? '这段旅程结束了，每一次记录都值得被看见。'
                        : page === 'record'
                          ? '一个数字，一次对自己的关心。'
                          : room.intro || '不必着急，你的每一点坚持都有意义。'
                  }}
                </p>
              </div>
              <button
                v-if="page === 'group' && room.status !== 'ENDED'"
                class="secondary invite-button"
                @click="sheet = 'invite'"
              >
                <Plus :size="16" />
                邀请朋友
              </button>
            </div>

            <template v-if="room.status === 'LOBBY' && page === 'group'">
              <div class="lobby-layout">
                <div>
                  <article class="card room-description">
                    <div class="card-heading">
                      <h2>这次的小约定</h2>
                      <button
                        v-if="isOwner"
                        class="text-button"
                        @click="openEdit"
                      >
                        <Pencil :size="14" />
                        编辑
                      </button>
                    </div>
                    <div class="three-stats">
                      <div>
                        <strong>
                          {{ room.days }}
                          <small>天</small>
                        </strong>
                        <span>小组周期</span>
                      </div>
                      <div>
                        <strong>{{ room.intensity }}</strong>
                        <span>目标强度</span>
                      </div>
                      <div>
                        <strong>
                          {{ snap.members.length }}
                          <small>/ 8</small>
                        </strong>
                        <span>小组成员</span>
                      </div>
                    </div>
                    <p class="field-hint">开始日期将在全员准备后确认。</p>
                  </article>
                  <article class="card">
                    <div class="card-heading">
                      <h2>同行的朋友</h2>
                      <span class="muted">
                        {{ snap.members.filter((m) => m.ready).length }} 人已准备
                      </span>
                    </div>
                    <div
                      v-for="m in snap.members"
                      :key="m.userId"
                      class="member-row"
                    >
                      <span class="avatar">{{ m.avatar }}</span>
                      <div class="member-identity">
                        <strong>
                          {{ m.nickname }}
                          <span
                            v-if="m.userId === user?.id"
                            class="me-tag"
                          >
                            我
                          </span>
                        </strong>
                        <small>{{ m.userId === room.ownerId ? '小组发起人' : '一起同行' }}</small>
                      </div>
                      <span :class="['ready-status', { ready: m.ready }]">
                        <Check
                          v-if="m.ready"
                          :size="14"
                        />
                        {{ m.ready ? '已准备' : '还未准备' }}
                      </span>
                    </div>
                    <button
                      v-if="snap.members.length < 8"
                      class="invite-row"
                      @click="sheet = 'invite'"
                    >
                      <span><Plus :size="18" /></span>
                      给朋友留一个位置
                      <ChevronRight :size="16" />
                    </button>
                  </article>
                </div>
                <div>
                  <button
                    class="card profile-card"
                    @click="openProfileEditor"
                  >
                    <span class="avatar">{{ user?.avatar }}</span>
                    <div>
                      <small>我的名片</small>
                      <strong>{{ user?.nickname }}</strong>
                    </div>
                    <Pencil :size="16" />
                  </button>
                  <article class="card preparation-card">
                    <div class="card-heading">
                      <h2>我的准备</h2>
                      <span class="small-icon"><Leaf :size="18" /></span>
                    </div>
                    <template v-if="mine?.ready">
                      <div class="goal-pair">
                        <div>
                          <span>起始体重</span>
                          <strong>
                            {{ mine.startWeight?.toFixed(2) }}
                            <small>kg</small>
                          </strong>
                        </div>
                        <ArrowRight :size="18" />
                        <div>
                          <span>本期目标</span>
                          <strong class="coral">
                            {{ mine.target?.toFixed(2) }}
                            <small>kg</small>
                          </strong>
                        </div>
                      </div>
                      <button
                        class="secondary full"
                        @click="openPreparation"
                      >
                        修改准备信息
                        <Pencil :size="14" />
                      </button>
                    </template>
                    <template v-else>
                      <p>
                        填写身高和起始体重，
                        <br />
                        为自己设定一个小目标。
                      </p>
                      <button
                        class="primary full"
                        @click="openPreparation"
                      >
                        填写身高体重
                        <ArrowRight :size="16" />
                      </button>
                    </template>
                  </article>
                  <button
                    class="text-button danger leave-button"
                    @click="sheet = 'leave'"
                  >
                    退出这个小组
                  </button>
                </div>
              </div>
              <div class="fixed-action">
                <span>
                  {{
                    allReady ? '大家都准备好了，随时可以出发' : '至少 2 人，且全员准备后可以开始'
                  }}
                </span>
                <button
                  class="primary"
                  :disabled="busy || !isOwner || !allReady"
                  @click="startPreview"
                >
                  {{ isOwner ? '确认开始本期' : '等待发起人开始' }}
                  <ArrowRight :size="17" />
                </button>
              </div>
            </template>

            <template v-else-if="page === 'group'">
              <article class="period-card">
                <div>
                  <span class="status-badge">
                    {{ room.status === 'ENDED' ? '已完成' : '正在进行' }}
                  </span>
                  <p>
                    {{ room.startDate }}
                    <span>—</span>
                    {{ room.endDate }}
                  </p>
                </div>
                <div class="period-count">
                  <strong>{{ room.status === 'ENDED' ? room.days : room.remaining }}</strong>
                  <span>{{ room.status === 'ENDED' ? '天，一起走过' : '天（含今天）' }}</span>
                  <small v-if="room.status === 'ACTIVE'">
                    {{
                      room.remaining === 1
                        ? '今天结束'
                        : `第 ${room.days - room.remaining + 1} 天 · 剩余天数`
                    }}
                  </small>
                </div>
              </article>
              <div class="section-heading">
                <h2>
                  {{ room.status === 'ENDED' ? '本期的坚持' : '同行的朋友' }}
                  <span class="count-label">{{ snap.members.length }} 人</span>
                </h2>
                <span>
                  {{
                    room.status === 'ENDED'
                      ? '按全期记录覆盖率排列'
                      : '每一次记录，都是一个小小的进步'
                  }}
                </span>
              </div>
              <div class="member-grid">
                <button
                  v-for="m in [...snap.members].sort((a, b) =>
                    room?.status === 'ENDED'
                      ? (snap!.ranks[a.userId] || 0) - (snap!.ranks[b.userId] || 0)
                      : 0,
                  )"
                  :key="m.userId"
                  class="card member-card"
                  @click="analyze(m)"
                >
                  <div class="card-heading">
                    <div class="member-name">
                      <span class="avatar">{{ m.avatar }}</span>
                      <span>
                        {{ m.nickname }}
                        <small v-if="m.userId === user?.id">我自己</small>
                      </span>
                    </div>
                    <ChevronRight :size="17" />
                  </div>
                  <template v-if="room.status === 'ENDED'">
                    <div class="member-reading">
                      {{ m.periodSummary?.coverage?.toFixed(0) ?? '—' }}
                      <small>%</small>
                    </div>
                    <div class="member-meta">
                      <span>
                        全期记录 {{ m.periodSummary?.count }} /
                        {{ m.periodSummary?.denominator }} 天
                      </span>
                      <span>第 {{ snap.ranks[m.userId] }} 名</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="member-reading">
                      {{ (m.summary?.latest?.weight ?? m.startWeight)?.toFixed(2) ?? '—' }}
                      <small>kg</small>
                    </div>
                    <div class="member-meta">
                      <span>
                        {{
                          !m.summary?.latest
                            ? '起始体重 · 准备时填写'
                            : m.summary.count === 1
                              ? '首次记录'
                              : `最近记录 ${m.summary.latest.date.slice(5)}`
                        }}
                      </span>
                      <span :class="{ coral: m.todayRecord }">
                        {{
                          m.todayRecord
                            ? '今日已记录'
                            : m.missingDays > 1
                              ? `${m.missingDays}天未记录`
                              : '今日未记录'
                        }}
                      </span>
                    </div>
                    <div class="card-bottom">
                      <span>
                        本期变化
                        <strong>
                          {{
                            m.summary?.change == null
                              ? '—'
                              : `${m.summary.change > 0 ? '+' : ''}${m.summary.change.toFixed(2)} kg`
                          }}
                        </strong>
                      </span>
                      <ArrowUpRight :size="15" />
                    </div>
                  </template>
                </button>
              </div>
              <div
                v-if="room.status === 'ACTIVE' && !mine?.todayRecord"
                class="record-callout"
              >
                <span class="step-icon peach"><Scale :size="23" /></span>
                <div>
                  <h3>给今天留一个小记录</h3>
                  <p>不需要完美，只需要真实。</p>
                </div>
                <button
                  class="primary"
                  @click="navigate('record')"
                >
                  去记录
                  <ArrowRight :size="16" />
                </button>
              </div>
              <button
                v-if="room.status === 'ENDED'"
                class="primary"
                @click="newGroup"
              >
                再组一期
                <Plus :size="17" />
              </button>
            </template>

            <template v-else-if="page === 'record'">
              <article class="record-card">
                <Segment
                  :model-value="unit"
                  :options="[
                    { value: 'kg', label: '公斤 kg' },
                    { value: 'jin', label: '斤' },
                  ]"
                  label="体重单位"
                  :class="{ disabled: unknown }"
                  @update:model-value="switchUnit"
                />
                <label
                  class="weight-label"
                  for="today-weight"
                >
                  今天的体重
                </label>
                <div class="weight-input">
                  <input
                    id="today-weight"
                    v-model="recordValue"
                    @input="recordDirty = true"
                    type="number"
                    inputmode="decimal"
                    step="any"
                    :readonly="unknown"
                    placeholder="0.00"
                    aria-label="今天的体重"
                  />
                  <span>{{ unit === 'kg' ? 'kg' : '斤' }}</span>
                </div>
                <div class="weight-rule"></div>
                <p class="target-label">
                  本期目标
                  <strong>{{ target }}</strong>
                  {{ unit === 'kg' ? 'kg' : '斤' }}
                  <span>慢慢来，照顾好自己</span>
                </p>
                <div
                  v-if="unknown"
                  class="unknown-note"
                >
                  保存结果暂未确认，输入已保留。请使用下方按钮核对原请求。
                </div>
              </article>
              <div class="record-gentle">
                <Leaf :size="17" />
                <span>数字只是记录，不定义今天的你。</span>
              </div>
              <div class="fixed-action record-fixed">
                <button
                  class="primary full"
                  :disabled="busy || room.status !== 'ACTIVE'"
                  @click="confirmRecord"
                >
                  {{
                    busy
                      ? '正在核对…'
                      : unknown
                        ? '核对保存结果'
                        : original
                          ? '修改今日记录'
                          : '保存今天的记录'
                  }}
                  <Check :size="18" />
                </button>
              </div>
            </template>

            <template v-else-if="page === 'data' || page === 'analysis'">
              <article class="card chart-card">
                <div class="card-heading">
                  <div>
                    <h2>{{ page === 'analysis' ? '体重记录' : '一起，看见变化' }}</h2>
                    <p class="field-hint">
                      {{
                        page === 'analysis'
                          ? '每一个点，都是认真对待自己的那一天'
                          : '每个人有自己的节奏，缺失日期不填补'
                      }}
                    </p>
                  </div>
                  <Segment
                    v-model="range"
                    :options="[
                      { value: 7, label: '近7天' },
                      { value: 28, label: '近28天' },
                    ]"
                    label="查看范围"
                  />
                </div>
                <Segment
                  v-if="page === 'data'"
                  v-model="dimension"
                  class="dimension-segment"
                  :options="[
                    { value: 'weight', label: '原始体重' },
                    { value: 'change', label: '体重变化' },
                    { value: 'percent', label: '变化比例' },
                  ]"
                  label="图表维度"
                />
                <Trend
                  :members="
                    page === 'analysis' ? (selectedMember ? [selectedMember] : []) : snap.members
                  "
                  :dimension="page === 'analysis' ? 'weight' : dimension"
                  :personal="page === 'analysis'"
                />
                <div
                  v-if="page === 'data'"
                  class="chart-legend"
                >
                  <div
                    v-for="(m, index) in snap.members"
                    :key="m.userId"
                  >
                    <i :style="{ background: colors[index % colors.length] }"></i>
                    <span>{{ m.nickname }}</span>
                    <strong>
                      {{
                        dimension === 'weight'
                          ? ((m.summary?.rows.at(-1)?.weight ?? m.startWeight)?.toFixed(2) ?? '—')
                          : (m.summary?.rows
                              .at(-1)
                              ?.[dimension as 'change' | 'percent']?.toFixed(2) ?? '—')
                      }}
                      <small>{{ dimension === 'percent' ? '%' : 'kg' }}</small>
                    </strong>
                  </div>
                </div>
              </article>
              <template v-if="page === 'analysis' && selectedMember">
                <div class="analysis-stats">
                  <article class="card">
                    <span>记录天数</span>
                    <strong>
                      {{ selectedMember.summary?.count ?? 0 }}
                      <small>天</small>
                    </strong>
                    <p>当前区间的实际记录</p>
                  </article>
                  <article class="card">
                    <span>记录覆盖率</span>
                    <strong>
                      {{ selectedMember.summary?.coverage?.toFixed(2) ?? '—' }}
                      <small>%</small>
                    </strong>
                    <p>
                      {{ selectedMember.summary?.count }} /
                      {{ selectedMember.summary?.denominator }} 天
                    </p>
                  </article>
                  <article class="card">
                    <span>本期目标</span>
                    <strong>
                      {{ selectedMember.target?.toFixed(2) ?? '—' }}
                      <small>kg</small>
                    </strong>
                    <p>按本期准备信息计算</p>
                  </article>
                </div>
                <button
                  class="card details-row"
                  @click="sheet = 'details'"
                >
                  <span>查看记录明细</span>
                  <ChevronRight :size="18" />
                </button>
              </template>
            </template>
          </section>
        </template>
        <div
          v-else
          class="empty-state"
        >
          <UsersRound :size="36" />
          <h2>还没有加载小组</h2>
          <p>请从首页进入当前小组，或输入朋友的邀请码。</p>
          <button
            class="primary"
            @click="navigate('home')"
          >
            返回首页
          </button>
        </div>
        <div
          v-if="error"
          class="error-message"
          role="alert"
        >
          {{ error }}
        </div>
      </template>
      <footer class="desktop-footer">
        <span>上秤 · 一起，慢慢变好</span>
        <button
          class="text-button"
          @click="sheet = 'privacy'"
        >
          数据与隐私
          <ShieldCheck :size="13" />
        </button>
      </footer>
    </main>
    <nav
      v-if="
        room && room.status !== 'LOBBY' && ['group', 'record', 'data', 'analysis'].includes(page)
      "
      class="bottom-nav"
      aria-label="小组导航"
    >
      <button
        :class="{ selected: ['group', 'analysis'].includes(page) }"
        @click="navigate('group')"
      >
        <UsersRound :size="21" />
        小组
      </button>
      <button
        :class="{ selected: page === 'record' }"
        @click="navigate('record')"
      >
        <Scale :size="21" />
        记录
      </button>
      <button
        :class="{ selected: page === 'data' }"
        @click="navigate('data')"
      >
        <ChartNoAxesCombined :size="21" />
        数据
      </button>
    </nav>
  </div>

  <Sheet
    v-if="sheet"
    :title="
      (
        {
          privacy: '关于你的数据',
          environment: '当前体验环境',
          create: '确认创建小组',
          extreme: '确认极高强度',
          prepare: '准备好，再出发',
          start: '一起开始吧',
          invite: '邀请朋友同行',
          profile: '修改我的名片',
          edit: '编辑小组信息',
          leave: '退出当前小组',
          overwrite: '修改今日记录',
          conflict: '今日记录已更新',
          account: '账号与支持',
          history: '走过的每一段旅程',
          support: '需要一点帮助',
          delete: '注销并删除数据',
          details: '记录明细',
        } as Record<string, string>
      )[sheet] || '上秤'
    "
    @close="closeSheet"
  >
    <template v-if="sheet === 'privacy'">
      <div class="privacy-copy">
        <p>上秤用于记录习惯和身体变化，不提供健康评分或医疗建议。</p>
        <h3>哪些数据会在组内展示？</h3>
        <p>
          昵称、头像、起始体重、目标、每日体重和变化趋势，仅向你有效参与的小组成员展示。身高和手机号不在组内公开。
        </p>
        <h3>你可以怎么管理自己的数据？</h3>
        <p>
          在“账号与支持”导出本人的 JSON
          数据，或申请注销并删除在线数据。旧备份恢复时必须重放独立删除清单；这不代表所有备份已物理擦除。
        </p>
        <h3>当前仅用于合成数据开发</h3>
        <p>请使用合成身份和示例身体数据。正式数据保存期限及真实身体数据准入仍待确认。</p>
      </div>
      <button
        class="secondary full"
        @click="sheet = ''"
      >
        我知道了
      </button>
    </template>
    <template v-else-if="sheet === 'environment'">
      <p class="subtitle">
        {{
          config?.realSms
            ? '使用手机短信验证码登录。'
            : config?.mode === 'test'
              ? '使用合成体验凭据登录，不提供手机号登录。'
              : '本地验证码由应用模拟生成，不发送短信。'
        }}
      </p>
      <p v-if="config?.syntheticOnly">当前仅用于示例身体数据。</p>
      <button
        class="secondary full"
        @click="sheet = ''"
      >
        明白了
      </button>
    </template>
    <template v-else-if="sheet === 'extreme'">
      <p>极高强度会计算更大的目标变化。请根据自己的情况谨慎选择，目标不构成健康建议。</p>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="sheet = ''"
        >
          保留原强度
        </button>
        <button
          class="primary"
          @click="confirmExtreme"
        >
          确认选择
        </button>
      </div>
    </template>
    <template v-else-if="sheet === 'create'">
      <div class="confirmation-summary">
        <h3>{{ groupName.trim() || '晚饭后散步小队' }}</h3>
        <p>{{ days }} 天 · {{ intensity }}强度 · 全员准备后开始</p>
      </div>
      <label class="check-row">
        <input
          v-model="sharing"
          type="checkbox"
        />
        <span>同意向组内成员共享昵称、体重记录、目标和变化趋势</span>
      </label>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="sheet = ''"
        >
          再想想
        </button>
        <button
          class="primary"
          :disabled="busy || !sharing"
          @click="create"
        >
          确认创建
        </button>
      </div>
    </template>
    <form
      v-else-if="sheet === 'prepare'"
      @submit.prevent="prepare"
    >
      <label>
        身高
        <span class="optional">cm · 仅本人可见</span>
        <input
          v-model="height"
          type="number"
          step="any"
          min="80"
          max="250"
          placeholder="填写身高"
          required
        />
      </label>
      <label>
        起始体重
        <span class="optional">kg</span>
        <input
          v-model="startWeight"
          type="number"
          step="any"
          min="20"
          max="300"
          placeholder="填写体重"
          required
        />
      </label>
      <div
        v-if="goalPreview"
        class="goal-preview"
      >
        本期目标
        <strong>{{ goalPreview }}</strong>
        kg
        <small>提交后以服务端计算结果为准</small>
      </div>
      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          @click="sheet = ''"
        >
          取消
        </button>
        <button
          class="primary"
          :disabled="busy || !goalPreview"
        >
          确认准备
        </button>
      </div>
    </form>
    <template v-else-if="sheet === 'start' && preview">
      <h3>{{ preview.name }}</h3>
      <p class="subtitle">{{ preview.days }} 天 · {{ preview.intensity }}强度 · 从今天开始</p>
      <div class="date-pair">
        <div>
          <span>开始日</span>
          <strong>{{ preview.date }}</strong>
        </div>
        <ArrowRight :size="18" />
        <div>
          <span>结束日</span>
          <strong>{{ preview.endDate }}</strong>
        </div>
      </div>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="sheet = ''"
        >
          再等等
        </button>
        <button
          class="primary"
          :disabled="busy"
          @click="start"
        >
          正式开始
        </button>
      </div>
    </template>
    <template v-else-if="sheet === 'invite'">
      <p class="subtitle">把邀请码或链接分享给朋友，一起开始。</p>
      <div class="invite-code">{{ room?.inviteCode }}</div>
      <div class="copy-link">{{ link }}</div>
      <button
        class="primary full"
        @click="copyInvite"
      >
        <Check
          v-if="copyDone"
          :size="17"
        />
        <Copy
          v-else
          :size="17"
        />
        {{ copyDone ? '已复制链接' : '复制邀请链接' }}
      </button>
      <p class="field-hint">所有小组成员都可以邀请，最多 8 人。</p>
    </template>
    <form
      v-else-if="sheet === 'profile'"
      @submit.prevent="saveProfile"
    >
      <div class="avatar-grid">
        <button
          v-for="a in avatars"
          :key="a"
          type="button"
          :class="{ selected: avatar === a }"
          :aria-pressed="avatar === a"
          :aria-label="`选择${a}头像`"
          @click="avatar = a"
        >
          {{ a }}
        </button>
      </div>
      <label>
        昵称
        <input
          v-model="nickname"
          maxlength="40"
          required
        />
      </label>
      <div class="modal-actions">
        <button
          class="secondary"
          type="button"
          @click="sheet = ''"
        >
          取消
        </button>
        <button
          class="primary"
          :disabled="busy"
        >
          保存名片
        </button>
      </div>
    </form>
    <form
      v-else-if="sheet === 'edit'"
      @submit.prevent="edit"
    >
      <label>
        名称
        <input
          v-model="groupName"
          maxlength="48"
        />
      </label>
      <label>
        介绍
        <textarea
          v-model="intro"
          maxlength="400"
          rows="2"
        ></textarea>
      </label>
      <label>
        周期
        <span class="optional">14–90 天</span>
        <input
          v-model="days"
          type="number"
          min="14"
          max="90"
          step="1"
          required
        />
      </label>
      <p class="field-hint">修改周期会取消全员准备，需要每人重新确认目标。</p>
      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          @click="sheet = ''"
        >
          取消
        </button>
        <button
          class="primary"
          :disabled="busy"
        >
          保存修改
        </button>
      </div>
    </form>
    <template v-else-if="sheet === 'leave'">
      <p>退出后会清除本次准备信息。重新加入需要再次准备；发起人权限将交给最早加入的在组成员。</p>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="sheet = ''"
        >
          留下来
        </button>
        <button
          class="primary"
          :disabled="busy"
          @click="leave"
        >
          确认退出
        </button>
      </div>
    </template>
    <template v-else-if="sheet === 'overwrite'">
      <div class="overwrite-pair">
        <div>
          <span>原记录</span>
          <strong>
            {{ ((original?.weight || 0) * (unit === 'jin' ? 2 : 1)).toFixed(2) }}
            <small>{{ unit === 'kg' ? 'kg' : '斤' }}</small>
          </strong>
        </div>
        <ArrowRight :size="20" />
        <div>
          <span>修改为</span>
          <strong>
            {{ Number(recordValue).toFixed(2) }}
            <small>{{ unit === 'kg' ? 'kg' : '斤' }}</small>
          </strong>
        </div>
      </div>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="sheet = ''"
        >
          取消
        </button>
        <button
          class="primary"
          :disabled="busy"
          @click="saveRecord"
        >
          确认修改
        </button>
      </div>
    </template>
    <template v-else-if="sheet === 'conflict'">
      <p>另一个设备更新了今日记录，请先核对最新数值。</p>
      <div class="confirmation-summary">
        <span>当前最新记录</span>
        <h2>
          {{ conflict?.weight?.toFixed(2) || '暂无记录' }}
          <small v-if="conflict">kg</small>
        </h2>
      </div>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="useLatestRecord"
        >
          使用最新值
        </button>
        <button
          class="primary"
          @click="keepRecordInput"
        >
          继续保存我的输入
        </button>
      </div>
    </template>
    <template v-else-if="sheet === 'account'">
      <div class="account-identity">
        <span class="avatar large">{{ user?.avatar }}</span>
        <div>
          <h3>{{ user?.nickname }}</h3>
          <p>{{ user?.phone }}</p>
        </div>
      </div>
      <div class="account-list">
        <button @click="openProfileEditor">
          <Pencil :size="18" />
          修改昵称与头像
          <ChevronRight :size="16" />
        </button>
        <button @click="showHistory">
          <History :size="18" />
          历史小组
          <ChevronRight :size="16" />
        </button>
        <button @click="sheet = 'privacy'">
          <ShieldCheck :size="18" />
          数据与隐私
          <ChevronRight :size="16" />
        </button>
        <button
          :disabled="busy"
          @click="exportData"
        >
          <Download :size="18" />
          导出本人数据
          <ArrowUpRight :size="16" />
        </button>
        <button @click="openSupport">
          <MessageCircle :size="18" />
          账号支持
          <ChevronRight :size="16" />
        </button>
        <button
          :disabled="busy"
          @click="logout"
        >
          <LogOut :size="18" />
          退出登录
          <ChevronRight :size="16" />
        </button>
      </div>
      <button
        class="text-button danger"
        @click="openDeletion"
      >
        注销并删除我的数据
      </button>
    </template>
    <template v-else-if="sheet === 'history'">
      <div
        v-if="!history.length"
        class="sheet-empty"
      >
        <History :size="32" />
        <p>每段旅程都值得记住</p>
        <small>结束后的小组会出现在这里。</small>
      </div>
      <button
        v-for="item in history"
        :key="item.id"
        class="history-item"
        @click="openHistoryRoom(item.id)"
      >
        <div>
          <strong>{{ item.name }}</strong>
          <small>{{ item.startDate }} · {{ item.days }} 天 · {{ item.intensity }}强度</small>
        </div>
        <ChevronRight :size="18" />
      </button>
    </template>
    <template v-else-if="sheet === 'support'">
      <form @submit.prevent="submitSupport">
        <label>
          想告诉我们什么？
          <textarea
            v-model="supportMessage"
            rows="4"
            maxlength="2000"
            placeholder="描述你遇到的问题，请勿填写敏感数据…"
            required
          ></textarea>
        </label>
        <button
          class="primary full"
          :disabled="busy || !supportMessage.trim()"
        >
          保存支持请求
        </button>
        <p class="field-hint">请求保存后可在此查看，不代表已经送达人工或承诺处理时限。</p>
      </form>
      <div class="support-list">
        <article
          v-for="item in supportRequests"
          :key="item.id"
        >
          <div>
            <code>{{ item.id.slice(0, 8) }}</code>
            <span class="status-badge">{{ item.status === 'OPEN' ? '待处理' : '已处理' }}</span>
          </div>
          <p>{{ item.message }}</p>
        </article>
      </div>
    </template>
    <template v-else-if="sheet === 'delete'">
      <p>
        将删除你的在线账号、准备信息、记录和支持请求，并撤销全部登录会话。其他成员的数据会保留。
      </p>
      <p class="field-hint">旧备份恢复时将重放删除清单，不代表备份已物理擦除。</p>
      <label>
        请输入“注销并删除我的数据”
        <input
          v-model="deletionText"
          autocomplete="off"
          placeholder="注销并删除我的数据"
        />
      </label>
      <div class="modal-actions">
        <button
          class="secondary"
          @click="sheet = 'account'"
        >
          取消
        </button>
        <button
          class="primary danger-fill"
          :disabled="busy || deletionText !== '注销并删除我的数据'"
          @click="deleteAccount"
        >
          确认注销
        </button>
      </div>
    </template>
    <template v-else-if="sheet === 'details'">
      <div class="record-list">
        <p
          v-if="!selectedMember?.records.length"
          class="sheet-empty"
        >
          当前区间还没有实际记录。
        </p>
        <div
          v-for="row in [...(selectedMember?.records || [])].reverse()"
          :key="row.date"
        >
          <span>{{ row.date }}</span>
          <strong>
            {{ row.weight.toFixed(2) }}
            <small>kg</small>
          </strong>
        </div>
      </div>
      <button
        class="secondary full"
        @click="sheet = ''"
      >
        关闭
      </button>
    </template>
    <p
      v-if="error"
      class="sheet-error"
      role="alert"
    >
      {{ error }}
    </p>
  </Sheet>
</template>
