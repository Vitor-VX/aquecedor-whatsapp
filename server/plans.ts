export type WarmupProfile = 'light' | 'moderate' | 'intensive' | 'aggressive';
export const PLAN_DURATIONS = [7, 14, 30] as const;
export type WarmupDuration = (typeof PLAN_DURATIONS)[number];

export const PROFILE_LABELS: Record<WarmupProfile, string> = {
  light: 'Leve',
  moderate: 'Moderado',
  intensive: 'Intenso controlado',
  aggressive: 'Agressivo controlado',
};

export const DAILY_LIMITS: Record<WarmupProfile, number[]> = {
  light: [4, 6, 8, 10, 12, 14, 16],
  moderate: [6, 9, 12, 15, 18, 22, 26],
  intensive: [8, 12, 16, 20, 24, 30, 36],
  aggressive: [12, 18, 24, 30, 36, 42, 48],
};

export const MESSAGE_TEMPLATES = [
  'Oi! Tudo certo por aí?',
  'Passando para desejar um ótimo dia.',
  'Como estão as coisas hoje?',
  'Recebeu minha mensagem direitinho?',
  'Que seu dia seja tranquilo e produtivo.',
  'Olá! Testando a conexão por aqui.',
  'Tudo funcionando desse lado 👍',
  'Bom te encontrar por aqui. Como vai?',
  'Só confirmando que está tudo online.',
  'Até mais! Depois a gente se fala.',
];

export function normalizeDuration(value: unknown): WarmupDuration {
  const days = Number(value);
  return PLAN_DURATIONS.includes(days as WarmupDuration) ? days as WarmupDuration : 7;
}

export function dayOfPlan(startedAt: Date, now = new Date(), durationDays: number = 7): number {
  const start = new Date(startedAt);
  const elapsed = new Date(now).getTime() - start.getTime();
  return Math.max(1, Math.min(normalizeDuration(durationDays), Math.floor(elapsed / 86_400_000) + 1));
}

export function dailyLimit(profile: WarmupProfile, day: number, durationDays: number = 7): number {
  const limits = DAILY_LIMITS[profile];
  const duration = normalizeDuration(durationDays);
  if (duration === 7) return limits[Math.max(0, Math.min(6, day - 1))];
  const start = limits[0];
  const end = limits[limits.length - 1];
  const fraction = Math.max(0, Math.min(1, (day - 1) / (duration - 1)));
  return Math.round(start + ((end - start) * fraction));
}

export function progressPercent(startedAt?: Date | string | null, now = new Date(), durationDays: number = 7): number {
  if (!startedAt) return 0;
  const duration = normalizeDuration(durationDays);
  const startMs = new Date(startedAt).getTime();
  return Math.max(0, Math.min(100, Math.round(((now.getTime() - startMs) / (duration * 86_400_000)) * 100)));
}

export function healthScore(input: {
  connectionState?: string;
  progress?: number;
  sentToday?: number;
  receivedToday?: number;
  successfulSends?: number;
  failedSends?: number;
  lastError?: string;
}): number {
  const totalAttempts = Math.max(0, Number(input.successfulSends || 0) + Number(input.failedSends || 0));
  const failureRate = totalAttempts ? Number(input.failedSends || 0) / totalAttempts : 0;
  const connection = input.connectionState === 'connected' ? 55 : input.connectionState === 'connecting' ? 30 : 12;
  const progress = Math.min(20, Math.max(0, Number(input.progress || 0) * 0.2));
  const activity = Math.min(16, Number(input.receivedToday || 0) * 2) + Math.min(10, Number(input.sentToday || 0));
  const penalty = Math.min(28, failureRate * 45) + (input.lastError ? 8 : 0);
  return Math.max(0, Math.min(100, Math.round(connection + progress + activity - penalty)));
}

export function healthLabel(score: number): string {
  if (score >= 85) return 'Saudável';
  if (score >= 70) return 'Estável';
  if (score >= 35) return 'Atenção';
  return 'Crítico';
}

export function isWithinQuietHours(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function scheduleTimesForDay(count: number, date: Date, activeStartHour: number, activeEndHour: number): Date[] {
  if (count <= 0) return [];
  const start = new Date(date);
  start.setHours(activeStartHour, 0, 0, 0);
  const end = new Date(date);
  end.setHours(activeEndHour, 0, 0, 0);
  const range = Math.max(60_000, end.getTime() - start.getTime());
  return Array.from({ length: count }, (_, index) => {
    const center = start.getTime() + ((index + 0.5) / count) * range;
    const jitter = (Math.random() - 0.5) * Math.min(range / count / 2, 20 * 60_000);
    return new Date(Math.max(Date.now() + 5_000, center + jitter));
  }).sort((a, b) => a.getTime() - b.getTime());
}

export function scheduleTimesForPlanDay(
  count: number,
  planStartedAt: Date,
  planDay: number,
  activeStartHour: number,
  activeEndHour: number,
  now = new Date(),
): Date[] {
  if (count <= 0) return [];
  const dayStart = new Date(new Date(planStartedAt).getTime() + ((Math.max(1, planDay) - 1) * 86_400_000));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const floor = Math.max(dayStart.getTime(), now.getTime() + 5_000);
  const candidates: Date[] = [];
  for (let timestamp = dayStart.getTime(); timestamp < dayEnd.getTime(); timestamp += 15 * 60_000) {
    const candidate = new Date(timestamp + 7 * 60_000);
    const hour = candidate.getHours();
    const active = activeStartHour === activeEndHour
      || (activeStartHour < activeEndHour ? hour >= activeStartHour && hour < activeEndHour : hour >= activeStartHour || hour < activeEndHour);
    if (active && candidate.getTime() >= floor && candidate.getTime() < dayEnd.getTime()) candidates.push(candidate);
  }
  if (!candidates.length) return [new Date(Math.max(floor, dayStart.getTime()))];
  return Array.from({ length: count }, (_, index) => candidates[Math.min(candidates.length - 1, Math.floor(((index + 0.5) * candidates.length) / count))]);
}
