// ============================================================
// S3 兼容存储客户端 — 支持运行时配置切换
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

// 模块级配置缓存（Worker 实例复用期间有效）
let cachedConfig: { config: S3ConnectionConfig; timestamp: number } | null = null;
const CONFIG_CACHE_TTL = 10_000; // 10 秒

/** 从 S3 读取运行时配置，失败则回退到环境变量 */
async function resolveConfig(env: App['Bindings']): Promise<S3ConnectionConfig> {
  // 检查缓存
  if (cachedConfig && (Date.now() - cachedConfig.timestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig.config;
  }

  // 先用环境变量构造一个临时客户端来读取 _config/s3.json
  const bootstrap: S3ConnectionConfig = {
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION || 'auto',
    bucket: env.S3_BUCKET,
  };

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
      const runtime: S3ConnectionConfig = await res.json();
      cachedConfig = { config: runtime, timestamp: Date.now() };
      return runtime;
    }
  } catch {
    // 忽略错误，回退到 bootstrap
  }

  cachedConfig = { config: bootstrap, timestamp: Date.now() };
  return bootstrap;
}

/** 保存运行时 S3 配置到 _config/s3.json */
export async function saveRuntimeConfig(env: App['Bindings'], config: S3ConnectionConfig): Promise<boolean> {
  const bootstrap: S3ConnectionConfig = {
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION || 'auto',
    bucket: env.S3_BUCKET,
  };

  try {
    const client = new AwsClient({
      accessKeyId: bootstrap.accessKeyId,
      secretAccessKey: bootstrap.secretAccessKey,
      service: 's3',
      region: bootstrap.region,
    });

    const url = `${bootstrap.endpoint}/${bootstrap.bucket}/_config/s3.json`;
    const res = await client.fetch(url, {
      method: 'PUT',
      body: JSON.stringify(config),
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      // 清除缓存，下次请求使用新配置
      cachedConfig = null;
      return true;
    }
    return false;
  } catch (err) {
    console.error('Save S3 config error:', err);
    return false;
  }
}

/** 获取一个配置好的 S3 客户端 */
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
function objectKey(scope: string, type: string): string {
  return `${scope}/${type}`;
}

/** 从 S3 读取 JSON */
export async function getJSON<T>(env: App['Bindings'], scope: string, type: string): Promise<T | null> {
  try {
    const cfg = await resolveConfig(env);
    const client = await getClient(env);
    const url = `${cfg.endpoint}/${cfg.bucket}/${objectKey(scope, type)}`;
    const res = await client.fetch(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

/** 写入 JSON 到 S3 */
export async function putJSON(env: App['Bindings'], scope: string, type: string, data: unknown): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const client = await getClient(env);
    const url = `${cfg.endpoint}/${cfg.bucket}/${objectKey(scope, type)}`;
    const res = await client.fetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 删除对象 */
export async function deleteObject(env: App['Bindings'], scope: string, type: string): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const client = await getClient(env);
    const url = `${cfg.endpoint}/${cfg.bucket}/${objectKey(scope, type)}`;
    const res = await client.fetch(url, { method: 'DELETE' });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

/** 列出对象 */
export async function listObjects(env: App['Bindings'], prefix: string): Promise<string[]> {
  try {
    const cfg = await resolveConfig(env);
    const client = await getClient(env);
    const url = `${cfg.endpoint}/${cfg.bucket}?prefix=${encodeURIComponent(prefix)}`;
    const res = await client.fetch(url, { method: 'GET' });
    if (!res.ok) return [];
    const xml = await res.text();
    const keys: string[] = [];
    const regex = /<Key>([^<]+)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(xml)) !== null) keys.push(m[1]);
    return keys;
  } catch {
    return [];
  }
}

/** 健康检查 */
export async function healthCheck(env: App['Bindings']): Promise<boolean> {
  try {
    const cfg = await resolveConfig(env);
    const client = await getClient(env);
    const url = `${cfg.endpoint}/${cfg.bucket}`;
    const res = await client.fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
