// ============================================================
// S3 兼容存储客户端 — KV 配置 + S3 数据
// ============================================================

import { AwsClient } from 'aws4fetch';
import type { App } from './types';

/** S3 连接配置（可在运行时修改） */
export interface S3ConnectionConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

const CONFIG_KV_KEY = 's3:connection_config';
const CONFIG_CACHE_TTL = 10_000; // 10 秒

// 模块级缓存（Worker 实例复用期间有效）
let cachedConfig: { config: S3ConnectionConfig; timestamp: number } | null = null;

/** 从环境变量构造 bootstrap 配置 */
function bootstrapConfig(env: App['Bindings']): S3ConnectionConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION || 'auto',
    bucket: env.S3_BUCKET,
  };
}

/** 解析 S3 配置：KV → 缓存 → S3._config → 环境变量 */
async function resolveConfig(env: App['Bindings']): Promise<S3ConnectionConfig> {
  // 1. 检查内存缓存
  if (cachedConfig && (Date.now() - cachedConfig.timestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig.config;
  }

  const bootstrap = bootstrapConfig(env);

  // 2. KV（最快，零凭证依赖）
  if (env.LEDGER_CONFIG) {
    try {
      const raw = await env.LEDGER_CONFIG.get(CONFIG_KV_KEY);
      if (raw) {
        const config: S3ConnectionConfig = JSON.parse(raw);
        cachedConfig = { config, timestamp: Date.now() };
        return config;
      }
    } catch { /* KV 不可用，继续 */ }
  }

  // 3. S3 _config/s3.json（需要 bootstrap 凭证）
  try {
    const client = new AwsClient({
      accessKeyId: bootstrap.accessKeyId,
      secretAccessKey: bootstrap.secretAccessKey,
      service: 's3',
      region: bootstrap.region,
    });
    const url = `${bootstrap.endpoint}/${bootstrap.bucket}/_config/s3.json`;
    const res = await client.fetch(url, { method: 'GET' });
    if (res.ok) {
      const config: S3ConnectionConfig = await res.json();
      cachedConfig = { config, timestamp: Date.now() };

      // 如果 KV 可用，同步写入 KV（下次走 KV 更快）
      if (env.LEDGER_CONFIG) {
        env.LEDGER_CONFIG.put(CONFIG_KV_KEY, JSON.stringify(config)).catch(() => {});
      }

      return config;
    }
  } catch { /* 忽略，回退 */ }

  // 4. 最终回退：环境变量
  cachedConfig = { config: bootstrap, timestamp: Date.now() };
  return bootstrap;
}

/** 保存运行时 S3 配置 — 同时写入 KV + 新旧两个 S3 桶 */
export async function saveRuntimeConfig(env: App['Bindings'], config: S3ConnectionConfig): Promise<boolean> {
  const configJson = JSON.stringify(config);
  const bootstrap = bootstrapConfig(env);
  let wroteAny = false;

  // 1. KV（立即生效，零依赖）
  if (env.LEDGER_CONFIG) {
    try {
      await env.LEDGER_CONFIG.put(CONFIG_KV_KEY, configJson);
      wroteAny = true;
      console.log('Config written to KV');
    } catch (err) {
      console.error('Write to KV failed:', err);
    }
  }

  // 2. 旧桶 _config/s3.json（用 bootstrap 凭证）
  try {
    const oldClient = new AwsClient({
      accessKeyId: bootstrap.accessKeyId,
      secretAccessKey: bootstrap.secretAccessKey,
      service: 's3',
      region: bootstrap.region,
    });
    const res = await oldClient.fetch(
      `${bootstrap.endpoint}/${bootstrap.bucket}/_config/s3.json`,
      { method: 'PUT', body: configJson, headers: { 'Content-Type': 'application/json' } },
    );
    if (res.ok) { wroteAny = true; console.log('Config written to old bucket'); }
  } catch (err) { console.error('Write to old bucket failed:', err); }

  // 3. 新桶 _config/s3.json（用新凭证，确保迁移后也能 bootstrap）
  try {
    const newClient = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region,
    });
    const res = await newClient.fetch(
      `${config.endpoint}/${config.bucket}/_config/s3.json`,
      { method: 'PUT', body: configJson, headers: { 'Content-Type': 'application/json' } },
    );
    if (res.ok) { wroteAny = true; console.log('Config written to new bucket'); }
  } catch (err) { console.error('Write to new bucket failed:', err); }

  // 清除内存缓存，下次请求强制重读
  cachedConfig = null;
  return wroteAny;
}

/** 获取 S3 客户端（每次调用重新创建，确保配置最新） */
async function getClient(env: App['Bindings']): Promise<AwsClient> {
  const cfg = await resolveConfig(env);
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region,
  });
}

/** 生成 S3 对象键 */
function objKey(scope: string, type: string): string {
  return `${scope}/${type}`;
}

/** 从 S3 读取 JSON */
export async function getJSON<T>(env: App['Bindings'], scope: string, type: string): Promise<T | null> {
  try {
    const cfg = await resolveConfig(env);
    const client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
    });
    const url = `${cfg.endpoint}/${cfg.bucket}/${objKey(scope, type)}`;
    const res = await client.fetch(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

/** 写入 JSON 到 S3 */
export async function putJSON(env: App['Bindings'], scope: string, type: string, data: unknown): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
    });
    const url = `${cfg.endpoint}/${cfg.bucket}/${objKey(scope, type)}`;
    const res = await client.fetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch { return false; }
}

/** 删除对象 */
export async function deleteObject(env: App['Bindings'], scope: string, type: string): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
    });
    const url = `${cfg.endpoint}/${cfg.bucket}/${objKey(scope, type)}`;
    const res = await client.fetch(url, { method: 'DELETE' });
    return res.ok || res.status === 204;
  } catch { return false; }
}

/** 列出对象 */
export async function listObjects(env: App['Bindings'], prefix: string): Promise<string[]> {
  try {
    const cfg = await resolveConfig(env);
    const client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
    });
    const url = `${cfg.endpoint}/${cfg.bucket}?prefix=${encodeURIComponent(prefix)}`;
    const res = await client.fetch(url, { method: 'GET' });
    if (!res.ok) return [];
    const xml = await res.text();
    const keys: string[] = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) keys.push(m[1]);
    return keys;
  } catch { return []; }
}

/** 健康检查 */
export async function healthCheck(env: App['Bindings']): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
    });
    const res = await client.fetch(`${cfg.endpoint}/${cfg.bucket}`, { method: 'HEAD' });
    return res.ok;
  } catch { return false; }
}
