// ============================================================
// 存储层 — S3 兼容存储 (aws4fetch)
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
  // @ts-ignore - Node.js 运行时
  const pe = typeof globalThis !== 'undefined' && (globalThis as any).process?.env || {};
  const endpoint = env?.S3_ENDPOINT || pe.S3_ENDPOINT || '';
  const accessKeyId = env?.S3_ACCESS_KEY_ID || pe.S3_ACCESS_KEY_ID || '';
  const secretAccessKey = env?.S3_SECRET_ACCESS_KEY || pe.S3_SECRET_ACCESS_KEY || '';
  const region = env?.S3_REGION || pe.S3_REGION || 'auto';
  const bucket = env?.S3_BUCKET || pe.S3_BUCKET || '';
  return { endpoint, accessKeyId, secretAccessKey, region, bucket };
}

function makeClient(cfg: S3ConnectionConfig): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region,
  });
}

/** aws4fetch 包装：禁止自动重定向，解决反代/CDN 重定向循环 */
async function s3Fetch(client: AwsClient, url: string, options: RequestInit = {}): Promise<Response> {
  const res = await client.fetch(url, { ...options, redirect: 'manual' });
  if ([301, 302, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (loc) return client.fetch(new URL(loc, url).href, { ...options, redirect: 'manual' });
  }
  return res;
}

async function resolveConfig(env: App['Bindings']): Promise<S3ConnectionConfig> {
  if (cachedConfig && (Date.now() - cachedConfig.timestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig.config;
  }

  const bootstrap = bootstrapConfig(env);

  // 1. KV (Workers only)
  if (env.LEDGER_CONFIG) {
    try {
      const raw = await env.LEDGER_CONFIG.get(CONFIG_KV_KEY);
      if (raw) {
        const c: S3ConnectionConfig = JSON.parse(raw);
        cachedConfig = { config: c, timestamp: Date.now() };
        return c;
      }
    } catch { /* ignore */ }
  }

  // 2. S3._config/s3.json
  try {
    const client = makeClient(bootstrap);
    const url = `${bootstrap.endpoint}/${bootstrap.bucket}/_config/s3.json`;
    const res = await s3Fetch(client, url, { method: 'GET' });
    if (res.ok) {
      const c: S3ConnectionConfig = await res.json();
      cachedConfig = { config: c, timestamp: Date.now() };
      return c;
    }
  } catch { /* ignore */ }

  cachedConfig = { config: bootstrap, timestamp: Date.now() };
  return bootstrap;
}

export async function saveRuntimeConfig(env: App['Bindings'], config: S3ConnectionConfig): Promise<boolean> {
  let ok = false;
  const body = JSON.stringify(config);
  if (env.LEDGER_CONFIG) { try { await env.LEDGER_CONFIG.put(CONFIG_KV_KEY, body); ok = true; } catch {} }
  const b = bootstrapConfig(env);
  const oldClient = makeClient(b);
  try { const r = await s3Fetch(oldClient, `${b.endpoint}/${b.bucket}/_config/s3.json`, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } }); if (r.ok) ok = true; } catch {}
  const newClient = makeClient(config);
  try { const r = await s3Fetch(newClient, `${config.endpoint}/${config.bucket}/_config/s3.json`, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } }); if (r.ok) ok = true; } catch {}
  cachedConfig = null;
  return ok;
}

// ---- 数据操作 ----

async function fetchJSON(cfg: S3ConnectionConfig, path: string, method: string, body?: string): Promise<Response> {
  const client = makeClient(cfg);
  const init: RequestInit = { method };
  if (body) { init.body = body; init.headers = { 'Content-Type': 'application/json' }; }
  return s3Fetch(client, `${cfg.endpoint}${path}`, init);
}

export async function getJSON<T>(env: App['Bindings'], scope: string, type: string): Promise<T | null> {
  const cfg = await resolveConfig(env);
  const res = await fetchJSON(cfg, `/${cfg.bucket}/${scope}/${type}`, 'GET');
  if (!res.ok) return null;
  return await res.json() as T;
}

export async function putJSON(env: App['Bindings'], scope: string, type: string, data: unknown): Promise<boolean> {
  const cfg = await resolveConfig(env);
  const res = await fetchJSON(cfg, `/${cfg.bucket}/${scope}/${type}`, 'PUT', JSON.stringify(data));
  return res.ok;
}

export async function listObjects(env: App['Bindings'], prefix: string): Promise<string[]> {
  const cfg = await resolveConfig(env);
  const url = `${cfg.endpoint}/${cfg.bucket}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const client = makeClient(cfg);
  const res = await s3Fetch(client, url, { method: 'GET' });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map(m => m[1]);
}

export async function listDir(env: App['Bindings'], prefix: string): Promise<string[]> {
  // listObjects 已经返回完整路径，提取目录前缀
  const keys = await listObjects(env, prefix);
  const dirs = new Set<string>();
  for (const k of keys) {
    const parts = k.replace(prefix, '').split('/');
    if (parts.length > 1) dirs.add(parts[0]);
  }
  return [...dirs];
}

export async function healthCheck(env: App['Bindings']): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    if (!cfg.endpoint || !cfg.bucket) return false;
    const client = makeClient(cfg);
    const url = `${cfg.endpoint}/${cfg.bucket}?max-keys=1`;
    console.error?.('S3 URL:', url, 'ep:', cfg.endpoint, 'bk:', cfg.bucket);
    const res = await s3Fetch(client, url, { method: 'GET' });
    return res.ok;
  } catch (e) {
    console.error?.('healthCheck error:', (e as Error)?.message);
    return false;
  }
}
