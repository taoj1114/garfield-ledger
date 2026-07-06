// ============================================================
// S3 兼容存储客户端 — aws4fetch + KV 配置
// ============================================================

import { AwsClient } from 'aws4fetch';
import type { App } from './types';

export interface S3ConnectionConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

const CONFIG_KV_KEY = 's3:connection_config';
const CONFIG_CACHE_TTL = 10_000;
let cachedConfig: { config: S3ConnectionConfig; timestamp: number } | null = null;

function bootstrapConfig(env: App['Bindings']): S3ConnectionConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION || 'auto',
    bucket: env.S3_BUCKET,
  };
}

function makeClient(cfg: S3ConnectionConfig): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region,
  });
}

/** aws4fetch 包装：禁止自动重定向，手动处理（解决 CDN/反代重定向循环） */
async function s3Fetch(client: AwsClient, url: string, options: RequestInit = {}): Promise<Response> {
  const res = await client.fetch(url, { ...options, redirect: 'manual' });
  if ([301, 302, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (loc) return client.fetch(new URL(loc, url).href, { ...options, redirect: 'manual' });
  }
  return res;
}

async function resolveConfig(env: App['Bindings']): Promise<S3ConnectionConfig> {
  if (cachedConfig && (Date.now() - cachedConfig.timestamp) < CONFIG_CACHE_TTL) return cachedConfig.config;
  const bootstrap = bootstrapConfig(env);

  if (env.LEDGER_CONFIG) {
    try {
      const raw = await env.LEDGER_CONFIG.get(CONFIG_KV_KEY);
      if (raw) { const c = JSON.parse(raw); cachedConfig = { config: c, timestamp: Date.now() }; return c; }
    } catch {}
  }

  try {
    const client = makeClient(bootstrap);
    const url = `${bootstrap.endpoint}/${bootstrap.bucket}/_config/s3.json`;
    const res = await s3Fetch(client, url, { method: 'GET' });
    if (res.ok) {
      const c: S3ConnectionConfig = await res.json();
      cachedConfig = { config: c, timestamp: Date.now() };
      if (env.LEDGER_CONFIG) env.LEDGER_CONFIG.put(CONFIG_KV_KEY, JSON.stringify(c)).catch(() => {});
      return c;
    }
  } catch {}

  cachedConfig = { config: bootstrap, timestamp: Date.now() };
  return bootstrap;
}

export async function saveRuntimeConfig(env: App['Bindings'], config: S3ConnectionConfig): Promise<boolean> {
  const body = JSON.stringify(config);
  let ok = false;
  if (env.LEDGER_CONFIG) { try { await env.LEDGER_CONFIG.put(CONFIG_KV_KEY, body); ok = true; } catch {} }
  const b = bootstrapConfig(env);
  const oldClient = makeClient(b);
  try { const r = await s3Fetch(oldClient, `${b.endpoint}/${b.bucket}/_config/s3.json`, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } }); if (r.ok) ok = true; } catch {}
  const newClient = makeClient(config);
  try { const r = await s3Fetch(newClient, `${config.endpoint}/${config.bucket}/_config/s3.json`, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } }); if (r.ok) ok = true; } catch {}
  cachedConfig = null;
  return ok;
}

async function fetchJSON(cfg: S3ConnectionConfig, path: string, method: string, body?: string): Promise<Response> {
  const client = makeClient(cfg);
  const init: RequestInit = { method };
  if (body) { init.body = body; init.headers = { 'Content-Type': 'application/json' }; }
  return s3Fetch(client, `${cfg.endpoint}${path}`, init);
}

export async function getJSON<T>(env: App['Bindings'], scope: string, type: string): Promise<T | null> {
  try {
    const cfg = await resolveConfig(env);
    const res = await fetchJSON(cfg, `/${cfg.bucket}/${scope}/${type}`, 'GET');
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

export async function putJSON(env: App['Bindings'], scope: string, type: string, data: unknown): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const res = await fetchJSON(cfg, `/${cfg.bucket}/${scope}/${type}`, 'PUT', JSON.stringify(data));
    return res.ok;
  } catch { return false; }
}

export async function deleteObject(env: App['Bindings'], scope: string, type: string): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const res = await fetchJSON(cfg, `/${cfg.bucket}/${scope}/${type}`, 'DELETE');
    return res.ok || res.status === 204;
  } catch { return false; }
}

export async function listObjects(env: App['Bindings'], prefix: string): Promise<string[]> {
  try {
    const cfg = await resolveConfig(env);
    const res = await fetchJSON(cfg, `/${cfg.bucket}?prefix=${encodeURIComponent(prefix)}`, 'GET');
    if (!res.ok) return [];
    const xml = await res.text();
    const keys: string[] = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) keys.push(m[1]);
    return keys;
  } catch { return []; }
}

export async function healthCheck(env: App['Bindings']): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const res = await fetchJSON(cfg, `/${cfg.bucket}?max-keys=1`, 'GET');
    return res.ok;
  } catch { return false; }
}
