import mongoose, { Schema } from 'mongoose';
import type { WarmupActionKind, WarmupDuration, WarmupProfile } from './plans.js';

export type NumberState = 'disconnected' | 'connecting' | 'connected' | 'hibernated' | 'error';
export type WarmupState = 'draft' | 'warming' | 'paused' | 'ready' | 'attention';

export interface AppConfigDocument {
  key: 'main';
  uazapiServerUrl: string;
  adminTokenEncrypted?: string;
  publicBaseUrl?: string;
  queuePaused: boolean;
  quietStartHour: number;
  quietEndHour: number;
  workerConcurrency: number;
}

export interface WarmupNumberDocument {
  name: string;
  phoneNumber?: string;
  instanceId: string;
  instanceTokenEncrypted: string;
  tokenFingerprint: string;
  connectionState: NumberState;
  warmupState: WarmupState;
  profile: WarmupProfile;
  slotId?: mongoose.Types.ObjectId;
  startedAt?: Date;
  readyAt?: Date;
  sentToday: number;
  receivedToday: number;
  successfulSends: number;
  failedSends: number;
  lastActivityAt?: Date;
  lastError?: string;
  dailyCounterDate: string;
  profileName?: string;
  profilePicUrl?: string;
  platform?: string;
  warmupDays: WarmupDuration;
}

export interface WarmupSlotDocument {
  name: string;
  profile: WarmupProfile;
  status: 'draft' | 'active' | 'paused' | 'ready';
  numberIds: mongoose.Types.ObjectId[];
  startedAt?: Date;
  completedAt?: Date;
  durationDays: WarmupDuration;
}

export interface WarmupJobDocument {
  idempotencyKey: string;
  slotId: mongoose.Types.ObjectId;
  senderNumberId: mongoose.Types.ObjectId;
  recipientNumberId: mongoose.Types.ObjectId;
  kind: WarmupActionKind;
  text: string;
  contentId?: mongoose.Types.ObjectId;
  mediaUrl?: string;
  mediaMimeType?: string;
  runAt: Date;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
  attempts: number;
  lockedAt?: Date;
  queueDispatchedAt?: Date;
  finishedAt?: Date;
  providerMessageId?: string;
  error?: string;
}

export interface WarmupContentDocument {
  label: string;
  kind: WarmupActionKind;
  text?: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
  active: boolean;
  usageCount: number;
  lastUsedAt?: Date;
}

const appConfigSchema = new Schema<AppConfigDocument>({
  key: { type: String, required: true, unique: true, default: 'main' },
  uazapiServerUrl: { type: String, default: '' },
  adminTokenEncrypted: String,
  publicBaseUrl: String,
  queuePaused: { type: Boolean, default: true },
  quietStartHour: { type: Number, default: 22, min: 0, max: 23 },
  quietEndHour: { type: Number, default: 8, min: 0, max: 23 },
  workerConcurrency: { type: Number, default: 2, min: 1, max: 5 },
}, { timestamps: true, collection: 'warmer_config' });

const warmupNumberSchema = new Schema<WarmupNumberDocument>({
  name: { type: String, required: true, trim: true },
  phoneNumber: String,
  instanceId: { type: String, required: true, unique: true },
  instanceTokenEncrypted: { type: String, required: true },
  tokenFingerprint: { type: String, required: true, unique: true, index: true },
  connectionState: { type: String, default: 'disconnected', index: true },
  warmupState: { type: String, default: 'draft', index: true },
  profile: { type: String, default: 'light' },
  slotId: { type: Schema.Types.ObjectId, ref: 'WarmupSlot', index: true },
  startedAt: Date,
  readyAt: Date,
  sentToday: { type: Number, default: 0 },
  receivedToday: { type: Number, default: 0 },
  successfulSends: { type: Number, default: 0 },
  failedSends: { type: Number, default: 0 },
  lastActivityAt: Date,
  lastError: String,
  dailyCounterDate: { type: String, default: '' },
  profileName: String,
  profilePicUrl: String,
  platform: String,
  warmupDays: { type: Number, enum: [7, 14, 30], default: 7 },
}, { timestamps: true, collection: 'warmer_numbers' });

const warmupSlotSchema = new Schema<WarmupSlotDocument>({
  name: { type: String, required: true, trim: true },
  profile: { type: String, default: 'light' },
  status: { type: String, default: 'draft', index: true },
  numberIds: [{ type: Schema.Types.ObjectId, ref: 'WarmupNumber' }],
  startedAt: Date,
  completedAt: Date,
  durationDays: { type: Number, enum: [7, 14, 30], default: 7 },
}, { timestamps: true, collection: 'warmer_slots' });

const warmupJobSchema = new Schema<WarmupJobDocument>({
  idempotencyKey: { type: String, required: true, unique: true },
  slotId: { type: Schema.Types.ObjectId, ref: 'WarmupSlot', required: true, index: true },
  senderNumberId: { type: Schema.Types.ObjectId, ref: 'WarmupNumber', required: true, index: true },
  recipientNumberId: { type: Schema.Types.ObjectId, ref: 'WarmupNumber', required: true },
  kind: { type: String, default: 'text' },
  text: { type: String, default: '' },
  contentId: { type: Schema.Types.ObjectId, ref: 'WarmupContent', index: true },
  mediaUrl: String,
  mediaMimeType: String,
  runAt: { type: Date, required: true, index: true },
  status: { type: String, default: 'queued', index: true },
  attempts: { type: Number, default: 0 },
  lockedAt: Date,
  queueDispatchedAt: Date,
  finishedAt: Date,
  providerMessageId: String,
  error: String,
}, { timestamps: true, collection: 'warmer_jobs' });
warmupJobSchema.index({ status: 1, runAt: 1 });

const warmupContentSchema = new Schema<WarmupContentDocument>({
  label: { type: String, required: true, trim: true },
  kind: { type: String, required: true, index: true },
  text: String,
  url: String,
  mimeType: String,
  fileName: String,
  active: { type: Boolean, default: true, index: true },
  usageCount: { type: Number, default: 0 },
  lastUsedAt: Date,
}, { timestamps: true, collection: 'warmer_content' });

const warmupEventSchema = new Schema({
  type: { type: String, required: true, index: true },
  level: { type: String, default: 'info' },
  numberId: { type: Schema.Types.ObjectId, ref: 'WarmupNumber', index: true },
  slotId: { type: Schema.Types.ObjectId, ref: 'WarmupSlot', index: true },
  title: { type: String, required: true },
  detail: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true, collection: 'warmer_events' });

const webhookInboxSchema = new Schema({
  fingerprint: { type: String, required: true, index: true },
  eventType: { type: String, required: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, default: 'queued', index: true },
  attempts: { type: Number, default: 0 },
  lockedAt: Date,
  processedAt: Date,
  error: String,
}, { timestamps: true, collection: 'warmer_webhook_inbox' });
webhookInboxSchema.index({ status: 1, createdAt: 1 });

export const AppConfig = mongoose.model<AppConfigDocument>('WarmerConfig', appConfigSchema);
export const WarmupNumber = mongoose.model<WarmupNumberDocument>('WarmupNumber', warmupNumberSchema);
export const WarmupSlot = mongoose.model<WarmupSlotDocument>('WarmupSlot', warmupSlotSchema);
export const WarmupJob = mongoose.model<WarmupJobDocument>('WarmupJob', warmupJobSchema);
export const WarmupContent = mongoose.model<WarmupContentDocument>('WarmupContent', warmupContentSchema);
export const WarmupEvent = mongoose.model('WarmupEvent', warmupEventSchema);
export const WebhookInbox = mongoose.model('WebhookInbox', webhookInboxSchema);

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('Configure MONGODB_URI.');
  await mongoose.connect(uri, { dbName: 'AquecedorWhatsApp' });
}

export async function getOrCreateConfig(): Promise<AppConfigDocument & mongoose.Document> {
  const defaults: Partial<AppConfigDocument> = {
    uazapiServerUrl: process.env.UAZAPI_SERVER_URL?.replace(/\/$/, '') || '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || '',
  };
  return AppConfig.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main', ...defaults } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}
