export const RULES = Object.freeze({ minDays: 14, maxDays: 90, maxMembers: 8, nameLength: 24, nicknameLength: 20, introLength: 200, minWeight: 20, maxWeight: 300, minHeight: 80, maxHeight: 250 });
export const CONSENT_VERSION = 'local-development-2026-10-13';
export const ALGORITHM_VERSION = 'bmi22-piecewise-v1';
export const INTENSITIES = Object.freeze({ '低': .02, '中': .03, '高': .04, '极高': .05 });
export class AppError extends Error {
  constructor(code, message, status = 400, details) { super(message); this.code = code; this.status = status; this.details = details; }
}
export function ensure(condition, code, message, status = 400, details) { if (!condition) throw new AppError(code, message, status, details); }
export function text(value, max, label, fallback = '') {
  ensure(typeof value === 'string', 'VALIDATION', `${label}格式不正确`);
  const clean = value.trim();
  ensure([...clean].length <= max, 'VALIDATION', `${label}最多 ${max} 字`);
  return clean || fallback;
}
export function number(value, min, max, label, integer = false) {
  ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), 'VALIDATION', `${label}须为 ${min}–${max} ${integer ? '之间的整数' : '之间的数字'}`);
  return value;
}
