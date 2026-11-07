import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import {
  AppConfig,
  WarmupEvent,
  WarmupJob,
  WarmupNumber,
  WarmupSlot,
  connectDatabase,
  getOrCreateConfig,
} from './models.js';
import { decryptSecret, encryptSecret, secretFingerprint } from './crypto.js';
import { DAILY_LIMITS, PROFILE_LABELS, progressPercent, type WarmupProfile } from './plans.js';
import { enqueueWebhook, ensureJobsForToday, refreshNumberStatus, startWorkers } from './scheduler.js';
import { UazapiError, uazapi } from './uazapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3100);
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const isProfile = (value: unknown): value is WarmupProfile => ['light', 'moderate', 'intensive'].includes(String(value));
const normalizeOrigin = (value: string) => value.trim().replace(/\/$/, '');

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
}

function safeNumber(document: any) {
  const raw = document?.toObject ? document.toObject() : document;
  const { instanceTokenEncrypted: _token, tokenFingerprint: _fingerprint, ...number } = raw;
  return { ...number, hasInstanceToken: Boolean(_token), progress: progressPercent(raw.startedAt) };
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    service: 'warmflow',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
}));

app.get('/api/config', asyncRoute(async (_req, res) => {
  const config = await getOrCreateConfig();
  const hasEnvToken = Boolean(process.env.UAZAPI_ADMIN_TOKEN?.trim());
  res.json({
    serverUrl: config.uazapiServerUrl || process.env.UAZAPI_SERVER_URL || '',
    hasAdminToken: Boolean(config.adminTokenEncrypted) || hasEnvToken,
    publicBaseUrl: config.publicBaseUrl || process.env.PUBLIC_BASE_URL || '',
    queuePaused: config.queuePaused,
    quietStartHour: config.quietStartHour,
    quietEndHour: config.quietEndHour,
    workerConcurrency: config.workerConcurrency,
    databaseName: 'AquecedorWhatsApp',
  });
}));

app.post('/api/config', asyncRoute(async (req, res) => {
  const config = await getOrCreateConfig();
  if (req.body.serverUrl !== undefined) config.uazapiServerUrl = normalizeOrigin(String(req.body.serverUrl));
  if (String(req.body.adminToken || '').trim()) config.adminTokenEncrypted = encryptSecret(String(req.body.adminToken).trim());
  if (req.body.publicBaseUrl !== undefined) config.publicBaseUrl = normalizeOrigin(String(req.body.publicBaseUrl));
  if (req.body.queuePaused !== undefined) config.queuePaused = Boolean(req.body.queuePaused);
  if (req.body.quietStartHour !== undefined) config.quietStartHour = Math.max(0, Math.min(23, Number(req.body.quietStartHour)));
  if (req.body.quietEndHour !== undefined) config.quietEndHour = Math.max(0, Math.min(23, Number(req.body.quietEndHour)));
  if (req.body.workerConcurrency !== undefined) config.workerConcurrency = Math.max(1, Math.min(5, Number(req.body.workerConcurrency)));
  await config.save();
  res.json({ success: true, message: 'Configuração salva sem expor credenciais.' });
}));

app.post('/api/config/test', asyncRoute(async (_req, res) => {
  const result = await uazapi.listInstances();
  const items = Array.isArray(result) ? result : Array.isArray(result?.instances) ? result.instances : [];
  res.json({ success: true, instances: items.length, message: 'Servidor UazAPI validado.' });
}));

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  const [numbers, slots, queueCounts, events, config] = await Promise.all([
    WarmupNumber.find().sort({ createdAt: -1 }),
    WarmupSlot.find().sort({ createdAt: -1 }),
    WarmupJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    WarmupEvent.find().sort({ createdAt: -1 }).limit(12).lean(),
    getOrCreateConfig(),
  ]);
  const queue = Object.fromEntries(queueCounts.map((item) => [item._id, item.count]));
  res.json({
    metrics: {
      totalNumbers: numbers.length,
      connected: numbers.filter((item) => item.connectionState === 'connected').length,
      warming: numbers.filter((item) => item.warmupState === 'warming').length,
      ready: numbers.filter((item) => item.warmupState === 'ready').length,
      attention: numbers.filter((item) => item.connectionState === 'error' || item.warmupState === 'attention').length,
      sentToday: numbers.reduce((sum, item) => sum + item.sentToday, 0),
      receivedToday: numbers.reduce((sum, item) => sum + item.receivedToday, 0),
      queued: queue.queued || 0,
      failed: queue.failed || 0,
    },
    numbers: numbers.map(safeNumber),
    slots,
    queue,
    events,
    queuePaused: config.queuePaused,
    profiles: Object.entries(PROFILE_LABELS).map(([id, label]) => ({ id, label, limits: DAILY_LIMITS[id as WarmupProfile] })),
  });
}));

app.get('/api/numbers', asyncRoute(async (_req, res) => {
  const numbers = await WarmupNumber.find().sort({ createdAt: -1 });
  res.json(numbers.map(safeNumber));
}));

app.post('/api/numbers', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const profile = isProfile(req.body.profile) ? req.body.profile : 'light';
  if (!name) return res.status(400).json({ error: 'Informe o nome da linha.' });
  if (req.body.ownedAndAuthorized !== true) {
    return res.status(400).json({ error: 'Confirme que o número é próprio ou autorizado para este teste.' });
  }
  const created = await uazapi.createInstance(name);
  const instance = created.instance || created;
  if (!instance.id || !instance.token) throw new Error('A UazAPI não retornou ID e token da instância.');
  const number = await WarmupNumber.create({
    name,
    profile,
    instanceId: String(instance.id),
    instanceTokenEncrypted: encryptSecret(String(instance.token)),
    tokenFingerprint: secretFingerprint(String(instance.token)),
    connectionState: instance.status || 'disconnected',
    warmupState: 'draft',
    dailyCounterDate: new Date().toISOString().slice(0, 10),
  });
  const connection = await uazapi.connect(String(instance.token));
  number.connectionState = connection?.instance?.status || 'connecting';
  await number.save();
  const config = await getOrCreateConfig();
  const origin = config.publicBaseUrl || process.env.PUBLIC_BASE_URL || '';
  let webhookConfigured = false;
  if (/^https:\/\//i.test(origin)) {
    await uazapi.configureWebhook(String(instance.token), `${normalizeOrigin(origin)}/api/webhooks/uazapi`);
    webhookConfigured = true;
  }
  await WarmupEvent.create({ type: 'number_created', level: 'success', title: `${name} criado`, numberId: number._id });
  res.json({
    success: true,
    number: safeNumber(number),
    qrcode: connection?.instance?.qrcode || connection?.qrcode || '',
    webhookConfigured,
    warning: webhookConfigured ? undefined : 'Configure uma URL pública HTTPS para receber eventos.',
  });
}));

app.get('/api/numbers/:id/status', asyncRoute(async (req, res) => {
  const result = await refreshNumberStatus(req.params.id);
  res.json({ success: true, number: safeNumber(result.number), instance: result.instance, status: result.status });
}));

app.post('/api/numbers/:id/connect', asyncRoute(async (req, res) => {
  const number = await WarmupNumber.findById(req.params.id);
  if (!number) return res.status(404).json({ error: 'Número não encontrado.' });
  const token = decryptSecret(number.instanceTokenEncrypted);
  const result = await uazapi.connect(token);
  number.connectionState = result?.instance?.status || 'connecting';
  await number.save();
  res.json({ success: true, qrcode: result?.instance?.qrcode || result?.qrcode || '', number: safeNumber(number) });
}));

app.get('/api/slots', asyncRoute(async (_req, res) => {
  const slots = await WarmupSlot.find().populate('numberIds').sort({ createdAt: -1 });
  res.json(slots);
}));

app.post('/api/slots', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const profile = isProfile(req.body.profile) ? req.body.profile : 'light';
  if (!name) return res.status(400).json({ error: 'Informe o nome do slot.' });
  const slot = await WarmupSlot.create({ name, profile, status: 'draft', numberIds: [] });
  res.json({ success: true, slot });
}));

app.post('/api/slots/:id/assign', asyncRoute(async (req, res) => {
  const [slot, number] = await Promise.all([
    WarmupSlot.findById(req.params.id),
    WarmupNumber.findById(String(req.body.numberId || '')),
  ]);
  if (!slot || !number) return res.status(404).json({ error: 'Slot ou número não encontrado.' });
  await WarmupSlot.updateMany({ _id: { $ne: slot._id } }, { $pull: { numberIds: number._id } });
  if (!slot.numberIds.some((id) => id.equals(number._id))) slot.numberIds.push(number._id);
  number.slotId = slot._id;
  number.profile = slot.profile;
  await Promise.all([slot.save(), number.save()]);
  res.json({ success: true });
}));

app.post('/api/slots/:id/start', asyncRoute(async (req, res) => {
  const slot = await WarmupSlot.findById(req.params.id);
  if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
  const connected = await WarmupNumber.countDocuments({ _id: { $in: slot.numberIds }, connectionState: 'connected' });
  if (connected < 2) return res.status(409).json({ error: 'Conecte pelo menos dois números próprios no slot.' });
  slot.status = 'active';
  slot.startedAt ||= new Date();
  await slot.save();
  await WarmupNumber.updateMany({ _id: { $in: slot.numberIds } }, { $set: { warmupState: 'warming', startedAt: slot.startedAt, profile: slot.profile } });
  await WarmupEvent.create({ type: 'slot_started', level: 'success', title: `${slot.name} iniciado`, slotId: slot._id });
  await ensureJobsForToday();
  res.json({ success: true, message: 'Aquecimento iniciado e fila diária planejada.' });
}));

app.post('/api/slots/:id/pause', asyncRoute(async (req, res) => {
  const slot = await WarmupSlot.findById(req.params.id);
  if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
  slot.status = 'paused';
  await slot.save();
  await WarmupNumber.updateMany({ slotId: slot._id, warmupState: 'warming' }, { $set: { warmupState: 'paused' } });
  res.json({ success: true });
}));

app.get('/api/queue', asyncRoute(async (req, res) => {
  const status = String(req.query.status || '');
  const query: Record<string, unknown> = {};
  if (status) query.status = status;
  const jobs = await WarmupJob.find(query).sort({ runAt: -1 }).limit(100).populate('senderNumberId', 'name').populate('recipientNumberId', 'name').lean();
  res.json(jobs);
}));

app.get('/api/events', asyncRoute(async (_req, res) => {
  res.json(await WarmupEvent.find().sort({ createdAt: -1 }).limit(100).lean());
}));

app.post('/api/webhooks/uazapi', (req, res) => {
  res.sendStatus(200);
  void enqueueWebhook(req.body).catch((error) => console.error('[Webhook inbox]', error));
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API]', error);
  const status = error instanceof UazapiError && error.status ? error.status : 500;
  res.status(status).json({ error: error.message || 'Erro interno.', details: error instanceof UazapiError ? error.body : undefined });
});

async function bootstrap() {
  await connectDatabase();
  await getOrCreateConfig();
  startWorkers();

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(projectRoot, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(projectRoot, 'dist', 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: projectRoot, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`WarmFlow em http://0.0.0.0:${port}`);
    console.log('Banco dedicado: AquecedorWhatsApp');
  });
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar WarmFlow:', error);
  process.exit(1);
});
