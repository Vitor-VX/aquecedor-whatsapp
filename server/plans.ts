export type WarmupProfile = 'light' | 'moderate' | 'intensive';

export const PROFILE_LABELS: Record<WarmupProfile, string> = {
  light: 'Leve',
  moderate: 'Moderado',
  intensive: 'Intenso controlado',
};

export const DAILY_LIMITS: Record<WarmupProfile, number[]> = {
  light: [4, 6, 8, 10, 12, 14, 16],
  moderate: [6, 9, 12, 15, 18, 22, 26],
  intensive: [8, 12, 16, 20, 24, 30, 36],
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

export function dayOfPlan(startedAt: Date, now = new Date()): number {
  const start = new Date(startedAt);
  start.setHours(0, 0, 0, 0);
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  return Math.max(1, Math.min(7, Math.floor((current.getTime() - start.getTime()) / 86_400_000) + 1));
}

export function dailyLimit(profile: WarmupProfile, day: number): number {
  const limits = DAILY_LIMITS[profile];
  return limits[Math.max(0, Math.min(6, day - 1))];
}

export function progressPercent(startedAt?: Date | string | null, now = new Date()): number {
  if (!startedAt) return 0;
  const startMs = new Date(startedAt).getTime();
  return Math.max(0, Math.min(100, Math.round(((now.getTime() - startMs) / (7 * 86_400_000)) * 100)));
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
