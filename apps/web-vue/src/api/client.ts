export type User = {
  id: string
  nickname: string
  avatar: string
  phone: string
  consent: boolean
  currentRoomId: string | null
  csrf: string
}
export type Reading = {
  date: string
  weight: number
  version?: number
  change?: number | null
  percent?: number | null
  source?: string
}
export type Summary = {
  start: string
  anchor: string
  count: number
  denominator: number
  coverage: number | null
  first: number | null
  latest: Reading | null
  change: number | null
  rows: Reading[]
}
export type Member = {
  id: string
  userId: string
  memberId: string
  nickname: string
  avatar: string
  ready: boolean
  startWeight: number | null
  target: number | null
  joinDate: string | null
  summary: Summary | null
  periodSummary: Summary | null
  points: Reading[]
  records: Reading[]
  missingDays: number
  todayRecord: Reading | null
}
export type Room = {
  id: string
  name: string
  intro: string
  days: number
  intensity: string
  status: 'LOBBY' | 'ACTIVE' | 'ENDED' | 'CANCELLED'
  ownerId: string
  inviteCode: string
  version: number
  startDate: string | null
  endDate: string | null
  remaining: number
}
export type Snapshot = {
  room: Room
  members: Member[]
  ranks: Record<string, number>
  today: string
  range: number
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, any> = {},
    public status = 0,
  ) {
    super(message)
  }
  get uncertain() {
    return !this.status || this.status >= 500
  }
}
let csrf = ''
let generation = 0
export function resetIdentity(token = '') {
  csrf = token
  generation++
}
export function token(value: string) {
  csrf = value
}
export const requestKey = () => crypto.randomUUID()
export async function api<T = any>(
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
): Promise<T> {
  const current = generation
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      headers['X-App-Request'] = '1'
      if (csrf) headers['X-CSRF-Token'] = csrf
      if (key) headers['Idempotency-Key'] = key
    }
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    })
    let data: any
    try {
      data = await response.json()
    } catch {
      throw new ApiError(
        'RESPONSE_UNKNOWN',
        '暂时无法确认操作结果',
        {},
        response.ok ? 0 : response.status,
      )
    }
    if (current !== generation) throw new ApiError('ACCOUNT_CHANGED', '账号已切换，请重新操作')
    if (!response.ok) {
      const error = new ApiError(
        data.error?.code || 'INTERNAL_ERROR',
        data.error?.message || '服务暂时不可用',
        data.error?.details || {},
        response.status,
      )
      if ((error.code === 'UNAUTHENTICATED' || error.code === 'CSRF_REJECTED') && csrf) {
        resetIdentity()
        window.dispatchEvent(new Event('session-expired'))
      }
      throw error
    }
    return data as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError('NETWORK_UNKNOWN', '网络暂时中断，请核对操作结果')
  } finally {
    clearTimeout(timeout)
  }
}
