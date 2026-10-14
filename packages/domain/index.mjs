import { RULES, INTENSITIES, ALGORITHM_VERSION, number, ensure } from '../contracts/index.mjs';
export const round2 = n => { const value = Math.round((n + Number.EPSILON) * 100) / 100; return Object.is(value, -0) ? 0 : value; };
export function businessDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const endDate = room => addDays(room.start_date, room.days - 1);
export const remainingDays = (room, today) => Math.max(0, daysBetween(today, endDate(room)) + 1);
export function timeFactor(days) {
  number(days, 14, 90, '参与天数', true);
  if (days <= 28) return .6 + (days - 14) * .4 / 14;
  if (days <= 56) return 1 + (days - 28) * .8 / 28;
  return 1.8 + (days - 56) * .8 / 34;
}
export function calculateGoal(height, weight, days, intensity) {
  number(height, RULES.minHeight, RULES.maxHeight, '身高');
  number(weight, RULES.minWeight, RULES.maxWeight, '起始体重');
  ensure(Object.hasOwn(INTENSITIES, intensity), 'VALIDATION', '请选择有效强度');
  const bmi = weight / (height / 100) ** 2, factor = Math.min(1.25, Math.max(.75, bmi / 22));
  const target = round2(weight - weight * INTENSITIES[intensity] * factor * timeFactor(days));
  return { target, loss: round2(weight - target), algorithm: ALGORITHM_VERSION };
}
export function normalizeWeight(value, unit) {
  ensure(['kg', 'jin'].includes(unit), 'VALIDATION', '体重单位不正确');
  const kg = unit === 'jin' ? value / 2 : value;
  number(kg, RULES.minWeight, RULES.maxWeight, '体重');
  return round2(kg);
}
export function stats(room, member, records, today, range = 28) {
  const anchor = [today, endDate(room)].sort()[0];
  const start = [addDays(anchor, -range + 1), room.start_date, member.join_date].sort().at(-1);
  const denominator = Math.max(0, daysBetween(start, anchor) + 1);
  const all = records.filter(r => r.date <= anchor), first = all[0]?.weight;
  const rows = all.filter(r => r.date >= start).map(r => ({ ...r, change: round2(r.weight - first), percent: round2((r.weight - first) / first * 100) }));
  const last = all.at(-1);
  return { start, anchor, count: rows.length, denominator, coverage: denominator ? round2(rows.length / denominator * 100) : null, first: first ?? null, latest: last ?? null, change: all.length >= 2 ? round2(last.weight - first) : null, rows };
}
export function rankCoverage(members) {
  const sorted = [...members].sort((a, b) => b.summary.count * a.summary.denominator - a.summary.count * b.summary.denominator || a.joined_order - b.joined_order);
  return sorted.map((m, i) => ({ ...m, rank: 1 + sorted.findIndex(n => n.summary.count * m.summary.denominator === m.summary.count * n.summary.denominator) }));
}
