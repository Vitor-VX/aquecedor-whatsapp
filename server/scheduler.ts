import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  AppConfig,
  WarmupEvent,
  WarmupJob,
  WarmupNumber,
  WarmupSlot,
  WebhookInbox,
  getOrCreateConfig,
} from './models.js';
import { secretFingerprint } from './crypto.js';
import { MESSAGE_TEMPLATES, dailyLimit, dayOfPlan, progressPercent, scheduleTimesForPlanDay } from './plans.js';
import { publishWarmupJob, rabbitConfigured, startRabbitConsumer } from './rabbitmq.js';
import { UazapiError, uazapi } from './uazapi.js';

const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);
async function recordEvent(input: {
  type: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  numberId?: mongoose.Types.ObjectId;
  slotId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
}) {
  await WarmupEvent.create(input);
}

async function resetDailyCounters() {
  const today = dateKey();
  await WarmupNumber.updateMany(
    { dailyCounterDate: { $ne: today } },
    { $set: { dailyCounterDate: today, sentToday: 0, receivedToday: 0 } },
  );
}

export async function ensureJobsForToday() {
  await resetDailyCounters();
  const now = new Date();
  const slots = await WarmupSlot.find({ status: 'active' });
  for (const slot of slots) {
    if (!slot.startedAt) continue;
    const durationDays = slot.durationDays || 7;
    const planDay = dayOfPlan(slot.startedAt, now, durationDays);
    const progress = progressPercent(slot.startedAt, now, durationDays);
    if (progress >= 100) {
      slot.status = 'ready';
      slot.completedAt = now;
      await slot.save();
      await WarmupNumber.updateMany({ slotId: slot._id }, { $set: { warmupState: 'ready', readyAt: now } });
      await recordEvent({ type: 'slot_ready', level: 'success', title: `${slot.name} concluiu ${durationDays} dias`, slotId: slot._id });
      continue;
    }

    const numbers = await WarmupNumber.find({
      _id: { $in: slot.numberIds },
      connectionState: 'connected',
      warmupState: { $in: ['warming', 'draft'] },
      phoneNumber: { $exists: true, $ne: '' },
    });
    if (numbers.length < 2) continue;
    const config = await getOrCreateConfig();
    const activeStart = config.quietEndHour;
    const activeEnd = config.quietStartHour;

    for (let senderIndex = 0; senderIndex < numbers.length; senderIndex++) {
      const sender = numbers[senderIndex];
      const cap = dailyLimit(slot.profile, planDay, durationDays);
      const remaining = Math.max(0, cap - sender.sentToday);
      const times = scheduleTimesForPlanDay(remaining, slot.startedAt, planDay, activeStart, activeEnd, now);
      for (let index = 0; index < remaining; index++) {
        const recipient = numbers[(senderIndex + index + 1) % numbers.length];
        if (recipient._id.equals(sender._id)) continue;
        const idempotencyKey = `${slot._id}:day-${planDay}:${sender._id}:${index}`;
        await WarmupJob.updateOne(
          { idempotencyKey },
          {
            $setOnInsert: {
              idempotencyKey,
              slotId: slot._id,
              senderNumberId: sender._id,
              recipientNumberId: recipient._id,
              kind: 'text',
              text: MESSAGE_TEMPLATES[(senderIndex + index + planDay) % MESSAGE_TEMPLATES.length],
              runAt: times[index],
              status: 'queued',
              attempts: 0,
            },
          },
          { upsert: true },
        );
      }
    }
  }
}

async function claimJob(jobId?: string) {
  const filter: Record<string, unknown> = { status: 'queued', runAt: { $lte: new Date() } };
  if (jobId) filter._id = jobId;
  return WarmupJob.findOneAndUpdate(
    filter,
    { $set: { status: 'processing', lockedAt: new Date() }, $unset: { queueDispatchedAt: 1 }, $inc: { attempts: 1 } },
    { returnDocument: 'after', sort: { runAt: 1 } },
  );
}

async function processJob(jobId?: string) {
  const config = await getOrCreateConfig();
  if (config.queuePaused) return;
  const job = await claimJob(jobId);
  if (!job) return;
  const [slot, sender, recipient] = await Promise.all([
    WarmupSlot.findById(job.slotId),
    WarmupNumber.findById(job.senderNumberId),
    WarmupNumber.findById(job.recipientNumberId),
  ]);
  if (!slot || slot.status !== 'active' || !sender || !recipient) {
    job.status = 'cancelled';
    job.error = 'Slot ou número indisponível.';
    job.finishedAt = new Date();
    await job.save();
    return;
  }
  if (sender.connectionState !== 'connected' || !recipient.phoneNumber) {
    job.status = 'queued';
    job.runAt = new Date(Date.now() + 15 * 60_000);
    job.error = 'Aguardando conexão e telefone do par.';
    job.queueDispatchedAt = undefined;
    await job.save();
    return;
  }
  const durationDays = slot.durationDays || 7;
  const planDay = dayOfPlan(slot.startedAt || new Date(), new Date(), durationDays);
  if (sender.sentToday >= dailyLimit(slot.profile, planDay, durationDays)) {
    job.status = 'cancelled';
    job.error = 'Limite diário atingido.';
    job.finishedAt = new Date();
    await job.save();
    return;
  }
  try {
    const result = await uazapi.sendText(sender, recipient.phoneNumber, job.text);
    job.status = 'completed';
    job.providerMessageId = String(result.messageid || result.id || result.message?.id || '');
    job.finishedAt = new Date();
    await Promise.all([
      job.save(),
      WarmupNumber.updateOne({ _id: sender._id }, {
        $inc: { sentToday: 1, successfulSends: 1 },
        $set: { lastActivityAt: new Date(), lastError: '' },
      }),
      recordEvent({
        type: 'message_sent', level: 'success', title: `${sender.name} → ${recipient.name}`,
        detail: 'Mensagem controlada enviada dentro do slot.', numberId: sender._id, slotId: slot._id,
      }),
    ]);
  } catch (error: any) {
    const uncertain = error instanceof UazapiError && error.status === 0;
    const retryable = error instanceof UazapiError && (error.status === 429 || error.status >= 500);
    if (uncertain) {
      job.status = 'uncertain';
      job.error = error.message;
      job.finishedAt = new Date();
    } else if (retryable && job.attempts < 3) {
      const waitSeconds = error.retryAfter || 2 ** job.attempts * 15;
      job.status = 'queued';
      job.runAt = new Date(Date.now() + (waitSeconds * 1000) + crypto.randomInt(1_000, 10_000));
      job.error = error.message;
      job.queueDispatchedAt = undefined;
    } else {
      job.status = 'failed';
      job.error = error.message;
      job.finishedAt = new Date();
      await WarmupNumber.updateOne({ _id: sender._id }, { $inc: { failedSends: 1 }, $set: { lastError: error.message } });
    }
    await job.save();
    await recordEvent({ type: 'message_failed', level: uncertain ? 'warning' : 'error', title: `Falha em ${sender.name}`, detail: error.message, numberId: sender._id, slotId: slot._id });
  }
}

async function dispatchDueJobs() {
  if (!rabbitConfigured()) return;
  const jobs = await WarmupJob.find({
    status: 'queued',
    runAt: { $lte: new Date() },
    $or: [{ queueDispatchedAt: { $exists: false } }, { queueDispatchedAt: null }],
  }).select('_id').sort({ runAt: 1 }).limit(20).lean();
  for (const job of jobs) {
    const dispatchedAt = new Date();
    const reserved = await WarmupJob.updateOne(
      { _id: job._id, status: 'queued', $or: [{ queueDispatchedAt: { $exists: false } }, { queueDispatchedAt: null }] },
      { $set: { queueDispatchedAt: dispatchedAt } },
    );
    if (!reserved.modifiedCount) continue;
    if (!await publishWarmupJob(String(job._id))) {
      await WarmupJob.updateOne({ _id: job._id, status: 'queued' }, { $unset: { queueDispatchedAt: 1 } });
    }
  }
}

async function processWebhookInbox() {
  const item = await WebhookInbox.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'processing', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { returnDocument: 'after', sort: { createdAt: 1 } },
  );
  if (!item) return;
  try {
    const number = await WarmupNumber.findOne({ tokenFingerprint: item.fingerprint });
    if (!number) throw new Error('Evento de instância não cadastrada.');
    const payload: any = item.payload;
    if (item.eventType === 'connection') {
      const instance = payload.instance || {};
      number.connectionState = instance.status || number.connectionState;
      number.phoneNumber = String(payload.owner || instance.owner || number.phoneNumber || '').replace(/\D/g, '') || undefined;
      number.profileName = instance.profileName || number.profileName;
      number.profilePicUrl = instance.profilePicUrl || number.profilePicUrl;
      number.platform = instance.plataform || instance.platform || number.platform;
      number.lastActivityAt = new Date();
      await number.save();
      await recordEvent({ type: 'connection', level: number.connectionState === 'connected' ? 'success' : 'warning', title: `${number.name}: ${number.connectionState}`, numberId: number._id });
    } else if (item.eventType === 'messages') {
      const message = payload.message || {};
      if (!message.fromMe && !message.wasSentByApi && !message.isGroup) {
        await WarmupNumber.updateOne({ _id: number._id }, { $inc: { receivedToday: 1 }, $set: { lastActivityAt: new Date() } });
        await recordEvent({ type: 'message_received', level: 'success', title: `${number.name} recebeu uma mensagem`, numberId: number._id });
      }
    }
    item.status = 'completed';
    item.processedAt = new Date();
    await item.save();
  } catch (error: any) {
    item.status = item.attempts < 3 ? 'queued' : 'failed';
    item.error = error.message;
    await item.save();
  }
}

export async function enqueueWebhook(payload: any) {
  const token = String(payload?.token || '');
  if (!token) return;
  const sanitized = { ...payload, token: '[redacted]' };
  await WebhookInbox.create({
    fingerprint: secretFingerprint(token),
    eventType: String(payload.EventType || 'unknown'),
    payload: sanitized,
  });
}

export async function refreshNumberStatus(numberId: string) {
  const number = await WarmupNumber.findById(numberId);
  if (!number) throw new Error('Número não encontrado.');
  const result = await uazapi.status(number);
  const instance = result.instance || {};
  const connected = result.status?.connected === true || result.status?.loggedIn === true || instance.status === 'connected';
  number.connectionState = connected ? 'connected' : instance.status || number.connectionState;
  if (connected) number.lastError = '';
  number.phoneNumber = String(instance.owner || result.status?.jid?.user || number.phoneNumber || '').replace(/\D/g, '') || undefined;
  number.profileName = instance.profileName || number.profileName;
  number.profilePicUrl = instance.profilePicUrl || number.profilePicUrl;
  number.platform = instance.plataform || instance.platform || number.platform;
  await number.save();
  return { number, instance: { ...instance, token: undefined }, status: result.status };
}

export function startWorkers() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const config = await AppConfig.findOne({ key: 'main' });
      const concurrency = Math.max(1, Math.min(5, config?.workerConcurrency || 2));
      await Promise.all([
        dispatchDueJobs(),
        ...Array.from({ length: concurrency }, () => processJob()),
        processWebhookInbox(),
      ]);
    } catch (error) {
      console.error('[Workers]', error);
    } finally {
      running = false;
    }
  };
  if (rabbitConfigured()) {
    void startRabbitConsumer((jobId) => processJob(jobId)).then((connected) => {
      if (connected) console.log('[RabbitMQ] consumidor do aquecedor ativo');
    });
  }
  void ensureJobsForToday();
  const workerTimer = setInterval(tick, 5_000);
  const plannerTimer = setInterval(() => void ensureJobsForToday(), 60_000);
  return () => { clearInterval(workerTimer); clearInterval(plannerTimer); };
}
