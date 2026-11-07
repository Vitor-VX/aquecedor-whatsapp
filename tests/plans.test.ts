import assert from 'node:assert/strict';
import test from 'node:test';
import { DAILY_LIMITS, dailyLimit, dayOfPlan, isWithinQuietHours, progressPercent } from '../server/plans.js';

test('os perfis crescem gradualmente durante sete dias', () => {
  for (const limits of Object.values(DAILY_LIMITS)) {
    assert.equal(limits.length, 7);
    assert.ok(limits.every((value, index) => index === 0 || value >= limits[index - 1]));
  }
});

test('o limite diário respeita as extremidades do plano', () => {
  assert.equal(dailyLimit('light', 0), 4);
  assert.equal(dailyLimit('moderate', 4), 15);
  assert.equal(dailyLimit('intensive', 99), 36);
});

test('calcula o dia do plano sem ultrapassar sete', () => {
  assert.equal(dayOfPlan(new Date('2026-11-01T12:00:00Z'), new Date('2026-11-01T18:00:00Z')), 1);
  assert.equal(dayOfPlan(new Date('2026-11-01T12:00:00Z'), new Date('2026-11-04T18:00:00Z')), 4);
  assert.equal(dayOfPlan(new Date('2026-10-01T12:00:00Z'), new Date('2026-11-04T18:00:00Z')), 7);
});

test('reconhece descanso que atravessa a meia-noite', () => {
  assert.equal(isWithinQuietHours(23, 22, 8), true);
  assert.equal(isWithinQuietHours(4, 22, 8), true);
  assert.equal(isWithinQuietHours(12, 22, 8), false);
});

test('progresso fica sempre entre zero e cem', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  assert.equal(progressPercent(undefined, now), 0);
  assert.equal(progressPercent('2026-11-01T00:00:00Z', now), 100);
  assert.equal(progressPercent('2026-12-01T00:00:00Z', now), 0);
});
