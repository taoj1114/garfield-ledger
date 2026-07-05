// ============================================================
// 系统设置模块 — S3 配置管理 / 测试 / 备份 / 缓存
// ============================================================

import type { Context } from 'hono';
import type { App } from './types';
import { getJSON, putJSON, listObjects } from './s3';

const CONFIG_KEY = 'config/settings.json';

/** 可运行时修改的设置 */
export interface AppSettings {
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
  // settings 是全局的，使用固定键 'system'
  const settings = await getJSON<AppSettings>(env, '_global', CONFIG_KEY);
  return settings || DEFAULT_SETTINGS;
}

async function saveSettings(env: App['Bindings'], settings: AppSettings): Promise<boolean> {
  return putJSON(env, '_global', CONFIG_KEY, settings);
}

/** GET /api/settings — 获取当前配置 */
export async function getSystemSettings(c: Context<App>) {
  const settings = await getSettings(c.env);

  // 返回 S3 连接信息（仅显示非敏感字段）
  return c.json({
    success: true,
    data: {
      // S3 配置（只读，来自环境变量）
      s3: {
        endpoint: c.env.S3_ENDPOINT,
        region: c.env.S3_REGION || 'auto',
        bucket: c.env.S3_BUCKET,
        connected: false, // 下面测试填充
      },
      // 可运行时修改的设置
      settings: {
        backup_folder: settings.backup_folder,
        cache_enabled: settings.cache_enabled,
        updated_at: settings.updated_at,
      },
    },
  });
}

/** POST /api/settings — 更新设置 */
export async function updateSystemSettings(c: Context<App>) {
  const body = await c.req.json<Partial<AppSettings>>();
  const current = await getSettings(c.env);

  const updated: AppSettings = {
    backup_folder: body.backup_folder !== undefined ? body.backup_folder : current.backup_folder,
    cache_enabled: body.cache_enabled !== undefined ? body.cache_enabled : current.cache_enabled,
    updated_at: new Date().toISOString(),
  };

  await saveSettings(c.env, updated);

  return c.json({ success: true, data: updated });
}

/** POST /api/settings/test — 测试 S3 连通性 */
export async function testS3Connection(c: Context<App>) {
  const results: Record<string, unknown> = {};
  let allOk = true;

  // 1. 写入测试文件
  let writeOk = false;
  try {
    const testKey = `_test_/ping_${Date.now()}.json`;
    writeOk = await putJSON(c.env, '_test_', `ping_${Date.now()}.json`, { test: true });
    results.write_test = writeOk;
    if (!writeOk) allOk = false;
  } catch (e) {
    results.write_test = false;
    results.write_error = String(e);
    allOk = false;
  }

  // 2. 读取测试文件
  try {
    const readData = await getJSON<{ test: boolean }>(c.env, '_test_', `ping_${Date.now()}.json`);
    results.read_test = readData?.test === true;
    if (!results.read_test) allOk = false;
  } catch (e) {
    results.read_test = false;
    results.read_error = String(e);
    allOk = false;
  }

  // 3. 列出文件
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
    data: {
      all_ok: allOk,
      results,
      timestamp: new Date().toISOString(),
    },
  });
}

/** GET /api/settings/stats — 桶使用统计 */
export async function getBucketStats(c: Context<App>) {
  // 由于 S3 LIST 操作和计算需要 aws4fetch 签名，使用已有的 listObjects
  const { listObjects } = await import('./s3');

  try {
    const keys = await listObjects(c.env, 'data/');
    const userDirs = new Set(keys.map(k => k.split('/')[1]));
    const dataFiles = keys.filter(k => k.endsWith('.json'));

    // 粗略统计各类文件数
    const typeCount: Record<string, number> = {};
    for (const k of dataFiles) {
      const parts = k.split('/');
      const fileName = parts[parts.length - 1];
      typeCount[fileName] = (typeCount[fileName] || 0) + 1;
    }

    return c.json({
      success: true,
      data: {
        total_files: keys.length,
        json_files: dataFiles.length,
        user_count: userDirs.size,
        file_types: typeCount,
        backup_folder: (await getSettings(c.env)).backup_folder,
      },
    });
  } catch (err) {
    console.error('Stats error:', err);
    return c.json({
      success: false,
      error: '获取统计失败',
      data: {
        total_files: 0,
        json_files: 0,
        user_count: 0,
        file_types: {},
      },
    });
  }
}
