// ============================================================
// 系统设置模块 — S3 / 备份 / 缓存 / AI 配置
// ============================================================

import { AwsClient } from 'aws4fetch';
import type { Context } from 'hono';
import type { App, S3ConnectionConfig } from './types';
import { getJSON, putJSON, listObjects, saveRuntimeConfig, healthCheck } from './s3';
import { createAiClient } from './ai-client';

const CONFIG_KEY = 'config/settings.json';

interface AppSettings {
  backup_folder: string;
  cache_enabled: boolean;
  ai_provider?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  openai_model?: string;
  gemini_api_key?: string;
  gemini_model?: string;
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

// ============================================================
// 通用设置
// ============================================================
export async function getSystemSettings(c: Context<App>) {
  const s = await getSettings(c.env);
  return c.json({
    success: true,
    data: {
      s3: { endpoint: c.env.S3_ENDPOINT, region: c.env.S3_REGION || 'auto', bucket: c.env.S3_BUCKET },
      settings: { backup_folder: s.backup_folder, cache_enabled: s.cache_enabled, updated_at: s.updated_at },
      ai: maskAiConfig(s),
    },
  });
}

export async function updateSystemSettings(c: Context<App>) {
  const body = await c.req.json<Partial<AppSettings>>();
  const current = await getSettings(c.env);
  const updated: AppSettings = {
    ...current,
    ...body,
    updated_at: new Date().toISOString(),
  };
  await saveSettings(c.env, updated);
  return c.json({ success: true, data: { ...updated, ...maskAiConfig(updated) } });
}

function maskAiConfig(s: AppSettings) {
  return {
    ai_provider: s.ai_provider,
    openai_api_key: s.openai_api_key ? s.openai_api_key.slice(0, 8) + '****' : undefined,
    openai_base_url: s.openai_base_url,
    openai_model: s.openai_model,
    gemini_api_key: s.gemini_api_key ? s.gemini_api_key.slice(0, 8) + '****' : undefined,
    gemini_model: s.gemini_model,
  };
}

// ============================================================
// AI 配置专用端点
// ============================================================
/** GET /api/settings/ai — 获取 AI 配置（密钥脱敏） */
export async function getAiConfig(c: Context<App>) {
  const s = await getSettings(c.env);
  return c.json({ success: true, data: maskAiConfig(s) });
}

/** PUT /api/settings/ai — 保存 AI 配置 */
export async function updateAiConfig(c: Context<App>) {
  const body = await c.req.json<{
    ai_provider?: string;
    openai_api_key?: string;
    openai_base_url?: string;
    openai_model?: string;
    gemini_api_key?: string;
    gemini_model?: string;
  }>();
  const current = await getSettings(c.env);
  const updated: AppSettings = {
    ...current,
    ai_provider: body.ai_provider ?? current.ai_provider,
    openai_api_key: body.openai_api_key ?? current.openai_api_key,
    openai_base_url: body.openai_base_url ?? current.openai_base_url,
    openai_model: body.openai_model ?? current.openai_model,
    gemini_api_key: body.gemini_api_key ?? current.gemini_api_key,
    gemini_model: body.gemini_model ?? current.gemini_model,
    updated_at: new Date().toISOString(),
  };
  await saveSettings(c.env, updated);
  return c.json({ success: true, data: maskAiConfig(updated) });
}

/** POST /api/settings/ai/test — 测试 AI 连接 */
export async function testAiConnection(c: Context<App>) {
  try {
    const client = createAiClient(c.env, await getAiSettings(c.env));
    const reply = await client.chat(
      [{ role: 'user', content: '回复"AI 连接测试通过 ✅" 这六个字，不要其他内容。' }],
      { temperature: 0.1, maxTokens: 50 },
    );
    const passed = reply.includes('✅');
    return c.json({
      success: passed,
      data: { reply: reply.trim(), passed },
    });
  } catch (err) {
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : 'AI 测试失败',
    });
  }
}

/** 获取 AI 设置，优先运行时配置，回退环境变量 */
async function getAiSettings(env: App['Bindings']): Promise<AppSettings> {
  const s = await getSettings(env);
  return {
    ...s,
    // 环境变量作为后备
    ai_provider: s.ai_provider || env.AI_PROVIDER || 'gemini',
    openai_api_key: s.openai_api_key || env.OPENAI_API_KEY,
    openai_base_url: s.openai_base_url || env.OPENAI_BASE_URL,
    openai_model: s.openai_model || env.OPENAI_MODEL,
    gemini_api_key: s.gemini_api_key || env.GEMINI_API_KEY,
    gemini_model: s.gemini_model || env.GEMINI_MODEL,
  };
}

// ============================================================
// S3 配置
// ============================================================
export async function getS3Config(c: Context<App>) {
  const runtime = await getJSON<S3ConnectionConfig>(c.env, '_config', 's3.json');
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

export async function updateS3Config(c: Context<App>) {
  const body = await c.req.json<{
    endpoint?: string; access_key_id?: string; secret_access_key?: string;
    region?: string; bucket?: string;
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
  const testResult = await testConnectionWithConfig(config);
  if (!testResult.ok) {
    return c.json({ success: false, error: `新配置验证失败，未保存。${testResult.error || '无法连接'}` }, 400);
  }
  const ok = await saveRuntimeConfig(c.env, config);
  if (!ok) return c.json({ success: false, error: '保存失败' }, 500);
  return c.json({ success: true, data: { source: 'runtime', ...config, secret_access_key: '********' } });
}

async function testConnectionWithConfig(config: S3ConnectionConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new AwsClient({
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
      service: 's3', region: config.region,
    });
    const testKey = `_config_validate_/test_${Date.now()}.json`;
    const writeRes = await client.fetch(`${config.endpoint}/${config.bucket}/${testKey}`, {
      method: 'PUT', body: JSON.stringify({ ping: true }), headers: { 'Content-Type': 'application/json' },
    });
    if (!writeRes.ok) return { ok: false, error: `写入测试文件失败 (${writeRes.status})` };
    const readRes = await client.fetch(`${config.endpoint}/${config.bucket}/${testKey}`, { method: 'GET' });
    if (!readRes.ok) return { ok: false, error: `读取测试文件失败 (${readRes.status})` };
    const data: { ping?: boolean } = await readRes.json();
    if (!data?.ping) return { ok: false, error: '内容校验失败' };
    await client.fetch(`${config.endpoint}/${config.bucket}/${testKey}`, { method: 'DELETE' }).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ============================================================
// 测试 & 统计
// ============================================================
export async function testS3Connection(c: Context<App>) {
  const results: Record<string, unknown> = {};
  let allOk = true;
  try { const ok = await healthCheck(c.env); results.health_check = ok; if (!ok) allOk = false; } catch (e) { results.health_check = false; allOk = false; }
  try { const ok = await putJSON(c.env, '_test_', `ping_${Date.now()}.json`, { test: true }); results.write_test = ok; if (!ok) allOk = false; } catch (e) { results.write_test = false; allOk = false; }
  try { const d = await getJSON<{ test: boolean }>(c.env, '_test_', `ping_${Date.now()}.json`); results.read_test = d?.test === true; if (!results.read_test) allOk = false; } catch { results.read_test = false; allOk = false; }
  try { const keys = await listObjects(c.env, 'data/'); results.list_success = true; results.file_count = keys.length; } catch { results.list_success = false; allOk = false; }
  return c.json({ success: allOk, data: { all_ok: allOk, results } });
}

export async function getBucketStats(c: Context<App>) {
  try {
    const keys = await listObjects(c.env, 'data/');
    const users = new Set(keys.map(k => k.split('/')[1]));
    const jsonFiles = keys.filter(k => k.endsWith('.json'));
    const typeCount: Record<string, number> = {};
    for (const k of jsonFiles) { const name = k.split('/').pop() || ''; typeCount[name] = (typeCount[name] || 0) + 1; }
    return c.json({ success: true, data: { total_files: keys.length, json_files: jsonFiles.length, user_count: users.size, file_types: typeCount, backup_folder: (await getSettings(c.env)).backup_folder } });
  } catch { return c.json({ success: false, error: '获取统计失败' }); }
}
