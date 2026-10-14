import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGoal, timeFactor, businessDate, stats, rankCoverage, normalizeWeight } from '../packages/domain/index.mjs';
test('confirmed goal samples and algorithm version', () => {
  for (const [days, target] of [[14, 78.29], [28, 77.15], [56, 74.87]]) assert.equal(calculateGoal(175, 80, days, '中').target, target);
  assert.equal(calculateGoal(175, 80, 28, '中').algorithm, 'bmi22-piecewise-v1');
});
test('four intensities, BMI clamp, time interpolation and boundaries', () => {
  assert.deepEqual([14, 28, 56, 90].map(timeFactor), [.6, 1, 1.8, 2.6]);
  assert.equal(timeFactor(21), .8); assert.equal(timeFactor(42), 1.4); assert.equal(timeFactor(73), 2.2);
  for (const days of [14, 21, 28, 42, 56, 73, 90]) {
    for (const [height, weight] of [[175, 80], [160, 50], [200, 30], [150, 150]]) {
      const targets = ['低', '中', '高', '极高'].map(i => calculateGoal(height, weight, days, i).target);
      assert.ok(targets.every((t, i) => !i || t < targets[i - 1]));
    }
  }
  assert.equal(calculateGoal(250, 20, 28, '低').target, 19.7); // No invented low-BMI policy in local arithmetic.
  assert.equal(calculateGoal(80, 300, 28, '低').target, 292.5);
  assert.throws(() => timeFactor(13)); assert.throws(() => timeFactor(91)); assert.throws(() => timeFactor(14.5));
  assert.throws(() => calculateGoal('175', 80, 14, '低')); assert.throws(() => calculateGoal(175, 80, 14, 'constructor'));
});
test('Beijing day, unit normalization and one-time rounding', () => {
  assert.equal(businessDate(new Date('2026-10-13T15:59:59Z')), '2026-10-13');
  assert.equal(businessDate(new Date('2026-10-13T16:00:00Z')), '2026-10-14');
  assert.equal(normalizeWeight(140, 'jin'), 70); assert.equal(normalizeWeight(70.005, 'kg'), 70.01);
  assert.throws(() => normalizeWeight(19.999, 'kg')); assert.throws(() => normalizeWeight(300.001, 'kg'));
});
test('coverage sample, no invented missing observations, period-wide baseline', () => {
  const room = { start_date: '2026-10-01', days: 28 }, member = { join_date: '2026-10-01' };
  const s = stats(room, member, [{ date: '2026-10-01', weight: 70 }, { date: '2026-10-03', weight: 69.5 }], '2026-10-03');
  assert.equal(s.count, 2); assert.equal(s.denominator, 3); assert.equal(s.coverage, 66.67); assert.equal(s.change, -.5); assert.equal(s.rows.at(-1).percent, -.71);
  const rows = [{ date: '2026-10-01', weight: 70 }, { date: '2026-10-22', weight: 69 }, { date: '2026-10-28', weight: 68.5 }];
  const week = stats(room, member, rows, '2026-10-30', 7); assert.equal(week.anchor, '2026-10-28'); assert.equal(week.rows.at(-1).change, -1.5); assert.equal(week.rows.at(-1).percent, -2.14);
  const late = stats(room, { join_date: '2026-10-03' }, [{ date: '2026-10-03', weight: 70 }], '2026-10-03'); assert.equal(late.denominator, 1); assert.equal(late.change, null);
  assert.equal(stats(room, member, [], '2026-10-03').count, 0);
});
test('unrounded coverage ranks keep 2/3 and 4/6 tied', () => {
  const result = rankCoverage([{ joined_order: 1, summary: { count: 2, denominator: 3 } }, { joined_order: 2, summary: { count: 4, denominator: 6 } }, { joined_order: 3, summary: { count: 1, denominator: 3 } }]);
  assert.deepEqual(result.map(r => r.rank), [1, 1, 3]);
});
