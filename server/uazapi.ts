import { decryptSecret } from './crypto.js';
import { getOrCreateConfig, type WarmupNumberDocument } from './models.js';
import type { WarmupActionKind } from './plans.js';

export class UazapiError extends Error {
  constructor(message: string, public status: number, public body: unknown, public retryAfter?: number) {
    super(message);
  }
}

async function baseConfig() {
  const config = await getOrCreateConfig();
  const serverUrl = (config.uazapiServerUrl || process.env.UAZAPI_SERVER_URL || '').replace(/\/$/, '');
  const adminToken = config.adminTokenEncrypted
    ? decryptSecret(config.adminTokenEncrypted)
    : process.env.UAZAPI_ADMIN_TOKEN?.trim() || '';
  if (!serverUrl) throw new Error('Configure a Server URL da UazAPI.');
  return { serverUrl, adminToken };
}

async function request<T>(path: string, options: RequestInit & { token?: string; admin?: boolean } = {}): Promise<T> {
  const { serverUrl, adminToken } = await baseConfig();
  const { token, admin, ...fetchOptions } = options;
  const credential = admin ? adminToken : token;
  if (!credential) throw new Error(admin ? 'Configure o Admin Token.' : 'Token da instância ausente.');
  const headers = new Headers(fetchOptions.headers);
  headers.set(admin ? 'admintoken' : 'token', credential);
  if (fetchOptions.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, { ...fetchOptions, headers, signal: AbortSignal.timeout(15_000) });
  } catch (error: any) {
    throw new UazapiError(error?.name === 'TimeoutError' ? 'Tempo limite da UazAPI excedido; resultado incerto.' : error.message, 0, null);
  }
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  if (!response.ok) {
    const message = body.message_ptbr || body.provider_message_ptbr || body.error || body.message || `HTTP ${response.status}`;
    throw new UazapiError(String(message), response.status, body, Number(response.headers.get('retry-after')) || undefined);
  }
  return body as T;
}

export const uazapi = {
  listInstances: () => request<any>('/instance/all', { method: 'GET', admin: true }),
  createInstance: (name: string) => request<any>('/instance/create', {
    method: 'POST', admin: true, body: JSON.stringify({ name }),
  }),
  connect: (token: string) => request<any>('/instance/connect', {
    method: 'POST', token, body: JSON.stringify({ history_days: 0 }),
  }),
  status: (number: Pick<WarmupNumberDocument, 'instanceTokenEncrypted'>) => request<any>('/instance/status', {
    method: 'GET', token: decryptSecret(number.instanceTokenEncrypted),
  }),
  configureWebhook: (token: string, url: string) => request<any>('/webhook', {
    method: 'POST', token, body: JSON.stringify({
      enabled: true,
      url,
      events: ['connection', 'messages', 'messages_update'],
      excludeMessages: ['wasSentByApi', 'isGroupYes'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    }),
  }),
  sendText: (number: Pick<WarmupNumberDocument, 'instanceTokenEncrypted'>, destination: string, text: string) => request<any>('/send/text', {
    method: 'POST',
    token: decryptSecret(number.instanceTokenEncrypted),
    body: JSON.stringify({ number: destination, text, track_source: 'warmflow' }),
  }),
  sendMedia: (number: Pick<WarmupNumberDocument, 'instanceTokenEncrypted'>, destination: string, kind: Exclude<WarmupActionKind, 'text'>, file: string, caption = '') => request<any>('/send/media', {
    method: 'POST',
    token: decryptSecret(number.instanceTokenEncrypted),
    body: JSON.stringify({ number: destination, type: kind, file, text: caption, track_source: 'warmflow' }),
  }),
};
