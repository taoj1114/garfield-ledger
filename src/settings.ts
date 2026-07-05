// ============================================================
// 系统设置模块 — S3 配置 / 备份 / 缓存 / 测试
// ============================================================

import type { Context } from 'hono';
import type { App, S3ConnectionConfig } from './types';
import { getJSON, putJSON, listObjects, saveRuntimeConfig, healthCheck } from './s3';

const CONFIG_KEY = 'config/settings.json';

interface AppSettings {
  backup_folder: string;
  cache_enabled: boolean;
  updated_at: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  backup_folder: 'backup',
  cache_enabled: true,
  updated_at: new Date().toISOString(),
};

async function getSettings(env: App['Bindings']): Promise<AppSettings> {
  return (await getJSON<AppSettings>(env, '_global', CONFIG_KEY)) || DEFAULT_SETTINGS;
}

async function saveSettings(env: App['Bindings'], s: AppSettings): Promise<boolean> {
  return putJSON(env, '_global', CONFIG_KEY, s);
}

/** GET /api/settings — 全部配置 */
export async function getSystemSettings(c: Context<App>) {
  const settings = await getSettings(c.env);
  return c.json({
    success: true,
    data: {
      s3: {
        endpoint: c.env.S3_ENDPOINT,
        region: c.env.S3_REGION || 'auto',
        bucket: c.env.S3_BUCKET,
      },
      settings: {
        backup_folder: settings.backup_folder,
        cache_enabled: settings.cache_enabled,
        updated_at: settings.updated_at,
      },
    },
  });
}

/** PUT /api/settings — 更新备份/缓存设置 */
export async function updateSystemSettings(c: Context<App>) {
  const body = await c.req.json<Partial<AppSettings>>();
  const current = await getSettings(c.env);
  const updated: AppSettings = {
    backup_folder: body.backup_folder ?? current.backup_folder,
    cache_enabled: body.cache_enabled ?? current.cache_enabled,
    updated_at: new Date().toISOString(),
  };
  await saveSettings(c.env, updated);
  return c.json({ success: true, data: updated });
}

/** GET /api/settings/s3 — 读取运行时 S3 配置（脱敏） */
export async function getS3Config(c: Context<App>) {
  // 读 _config/s3.json
  const runtime = await getJSON<S3ConnectionConfig>(c.env, '_config', 's3.json');
  // 返回脱敏信息
  return c.json({
    success: true,
    data: {
      endpoint: runtime?.endpoint || c.env.S3_ENDPOINT,
      access_key_id: runtime?.accessKeyId || c.env.S3_ACCESS_KEY_ID,
      secret_access_key: runtime ? '********' : '（来自环境变量）',
      region: runtime?.region || c.env.S3_REGION || 'auto',
      bucket: runtime?.bucket || c.env.S3_BUCKET,
      source: runtime ? 'runtime' : 'env',
    },
  });
}

/** PUT /api/settings/s3 — 保存运行时 S3 配置 */
export async function updateS3Config(c: Context<App>) {
  const body = await c.req.json<{
    endpoint?: string;
    access_key_id?: string;
    secret_access_key?: string;
    region?: string;
    bucket?: string;
  }>();

  if (!body.endpoint || !body.access_key_id || !body.secret_access_key || !body.bucket) {
    return c.json({ success: false, error: '请填写 endpoint, access_key_id, secret_access_key, bucket' }, 400);
  }

  const config: S3ConnectionConfig = {
    endpoint: body.endpoint.replace(/\/+$/, ''),
    accessKeyId: body.access_key_id,
    secretAccessKey: body.secret_access_key,
    region: body.region || 'auto',
    bucket: body.bucket,
  };

  const ok = await saveRuntimeConfig(c.env, config);
  if (!ok) return c.json({ success: false, error: '保存 S3 配置失败' }, 500);

  return c.json({ success: true, data: { source: 'runtime', ...config, secret_access_key: '********' } });
}

/** POST /api/settings/test — 测试 S3 */
export async function testS3Connection(c: Context<App>) {
  const results: Record<string, unknown> = {};
  let allOk = true;

  try {
    const ok = await healthCheck(c.env);
    results.health_check = ok;
    if (!ok) allOk = false;
  } catch (e) {
    results.health_check = false;
    results.error = String(e);
    allOk = false;
  }

  try {
    const writeOk = await putJSON(c.env, '_test_', `ping_${Date.now()}.json`, { test: true });
    results.write_test = writeOk;
    if (!writeOk) allOk = false;
  } catch (e) {
    results.write_test = false;
    results.write_error = String(e);
    allOk = false;
  }

  try {
    const readData = await getJSON<{ test: boolean }>(c.env, '_test_', `ping_${Date.now()}.json`);
    results.read_test = readData?.test === true;
    if (!results.read_test) allOk = false;
  } catch (e) {
    results.read_test = false;
    results.read_error = String(e);
    allOk = false;
  }

  try {
    const keys = await listObjects(c.env, 'data/');
    results.list_success = true;
    results.file_count = keys.length;
  } catch {
    results.list_success = false;
    allOk = false;
  }

  return c.json({
    success: allOk,
    data: { all_ok: allOk, results, timestamp: new Date().toISOString() },
  });
}

/** GET /api/settings/stats — 桶统计 */
export async function getBucketStats(c: Context<App>) {
  try {
    const keys = await listObjects(c.env, 'data/');
    const users = new Set(keys.map(k => k.split('/')[1]));
    const jsonFiles = keys.filter(k => k.endsWith('.json'));
    const typeCount: Record<string, number> = {};
    for (const k of jsonFiles) {
      const name = k.split('/').pop() || '';
      typeCount[name] = (typeCount[name] || 0) + 1;
    }

    return c.json({
      success: true,
      data: {
        total_files: keys.length,
        json_files: jsonFiles.length,
        user_count: users.size,
        file_types: typeCount,
        backup_folder: (await getSettings(c.env)).backup_folder,
      },
    });
  } catch {
    return c.json({ success: false, error: '获取统计失败' });
  }
}
