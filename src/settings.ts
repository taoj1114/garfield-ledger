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
    openai_api_key: s.openai_api_key,
    openai_base_url: s.openai_base_url,
    openai_model: s.openai_model,
    gemini_api_key: s.gemini_api_key,
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
      [{ role: 'user', content: '回复"ok" 这一个字，不要其他内容。' }],
      { temperature: 0.1, maxTokens: 200 },
    );
    const passed = !!reply.trim();
    return c.json({
      success: passed,
      data: { reply: reply.trim().slice(0, 50), passed },
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
  if (!body.endpoint) return c.json({ success: false, error: '请填写 endpoint' }, 400);
  if (!body.access_key_id) return c.json({ success: false, error: '请填写 access_key_id' }, 400);
  if (!body.bucket) return c.json({ success: false, error: '请填写 bucket' }, 400);

  // 读取当前运行时配置（如果有），保留旧 secret
  const current = await getJSON<S3ConnectionConfig>(c.env, '_config', 's3.json');
  const secretKey = body.secret_access_key || current?.secretAccessKey || c.env.S3_SECRET_ACCESS_KEY;
  if (!secretKey) return c.json({ success: false, error: '请填写 secret_access_key' }, 400);
  const config: S3ConnectionConfig = {
    endpoint: body.endpoint.replace(/\/+$/, ''),
    accessKeyId: body.access_key_id,
    secretAccessKey: secretKey || '',
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
/** 用指定配置测试 S3 连接 */
async function testConnectionWithConfig(config: S3ConnectionConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region,
    });
    const testKey = `_config_validate_/test_${Date.now()}.json`;
    const url = `${config.endpoint}/${config.bucket}/${testKey}`;

    // 写入（禁止自动跟随重定向，自己处理）
    let writeRes = await client.fetch(url, {
      method: 'PUT', body: JSON.stringify({ ping: true }),
      headers: { 'Content-Type': 'application/json' },
      redirect: 'manual',
    });
    if ([301, 302, 307, 308].includes(writeRes.status)) {
      const loc = writeRes.headers.get('location');
      if (loc) writeRes = await client.fetch(new URL(loc, url).href, {
        method: 'PUT', body: JSON.stringify({ ping: true }),
        headers: { 'Content-Type': 'application/json' },
        redirect: 'manual',
      });
    }
    if (!writeRes.ok) return { ok: false, error: `写入失败 (${writeRes.status})` };

    // 读取
    let readRes = await client.fetch(url, { method: 'GET', redirect: 'manual' });
    if ([301, 302, 307, 308].includes(readRes.status)) {
      const loc = readRes.headers.get('location');
      if (loc) readRes = await client.fetch(new URL(loc, url).href, { method: 'GET', redirect: 'manual' });
    }
    if (!readRes.ok) return { ok: false, error: `读取失败 (${readRes.status})` };
    const data: { ping?: boolean } = await readRes.json();
    if (!data?.ping) return { ok: false, error: '内容校验失败' };

    await client.fetch(url, { method: 'DELETE', redirect: 'manual' }).catch(() => {});
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
  const testId = `ping_${Date.now()}.json`;
  try { const ok = await healthCheck(c.env); results.health_check = ok; if (!ok) allOk = false; } catch { results.health_check = false; allOk = false; }
  try { const ok = await putJSON(c.env, '_test_', testId, { test: true }); results.write_test = ok; if (!ok) allOk = false; } catch { results.write_test = false; allOk = false; }
  try { const d = await getJSON<{ test: boolean }>(c.env, '_test_', testId); results.read_test = d?.test === true; if (!results.read_test) allOk = false; } catch { results.read_test = false; allOk = false; }
  try { const keys = await listObjects(c.env, '_test_'); results.list_success = true; results.file_count = keys.length; } catch { results.list_success = false; allOk = false; }
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
