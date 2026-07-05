// ============================================================
// 记账记录 CRUD 模块
// ============================================================

import type { Context } from 'hono';
import type { App, LegacyRecord, StatsData } from './types';
import { getJSON, putJSON } from './s3';

const RECORDS_FILE = 'records.json';

/** 获取用户的所有记录 */
async function getRecords(env: App['Bindings'], userId: string): Promise<LegacyRecord[]> {
  const records = await getJSON<LegacyRecord[]>(env, userId, RECORDS_FILE);
  return records || [];
}

/** 保存用户的所有记录 */
async function saveRecords(env: App['Bindings'], userId: string, records: LegacyRecord[]): Promise<boolean> {
  return putJSON(env, userId, RECORDS_FILE, records);
}

/** GET /api/records - 获取所有记录 */
export async function listRecords(c: Context<App>) {
  const user = c.get('user');
  const records = await getRecords(c.env, user.user_id);

  const url = new URL(c.req.url);
  const category = url.searchParams.get('category');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const limit = parseInt(url.searchParams.get('limit') || '200');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let filtered = records;
  if (category) filtered = filtered.filter(r => r.category === category);
  if (startDate) filtered = filtered.filter(r => r.timestamp >= startDate);
  if (endDate) filtered = filtered.filter(r => r.timestamp <= endDate);

  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return c.json({
    success: true,
    data: {
      records: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    },
  });
}

/** POST /api/records - 添加记录 */
export async function createRecord(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<Partial<LegacyRecord>>();

  if (!body.source || body.amount === undefined || !body.currency) {
    return c.json({ success: false, error: '缺少必填字段: source, amount, currency' }, 400);
  }

  const now = new Date().toISOString();
  const record: LegacyRecord = {
    id: crypto.randomUUID(),
    source: body.source,
    amount: Number(body.amount),
    currency: body.currency,
    category: body.category || '其他',
    description: body.description || '',
    timestamp: body.timestamp || now,
    created_at: now,
    updated_at: now,
  };

  const records = await getRecords(c.env, user.user_id);
  records.push(record);
  const saved = await saveRecords(c.env, user.user_id, records);

  if (!saved) {
    return c.json({ success: false, error: '保存记录失败' }, 500);
  }

  return c.json({ success: true, data: record }, 201);
}

/** GET /api/records/:id - 获取单条记录 */
export async function getRecord(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少记录 ID' }, 400);

  const records = await getRecords(c.env, user.user_id);
  const record = records.find(r => r.id === id);
  if (!record) return c.json({ success: false, error: '记录未找到' }, 404);

  return c.json({ success: true, data: record });
}

/** PUT /api/records/:id - 更新记录 */
export async function updateRecord(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少记录 ID' }, 400);

  const body = await c.req.json<Partial<LegacyRecord>>();
  const records = await getRecords(c.env, user.user_id);
  const index = records.findIndex(r => r.id === id);

  if (index === -1) return c.json({ success: false, error: '记录未找到' }, 404);

  const now = new Date().toISOString();
  records[index] = { ...records[index], ...body, id, updated_at: now };

  const saved = await saveRecords(c.env, user.user_id, records);
  if (!saved) return c.json({ success: false, error: '保存失败' }, 500);

  return c.json({ success: true, data: records[index] });
}

/** DELETE /api/records/:id - 删除记录 */
export async function deleteRecord(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少记录 ID' }, 400);

  const records = await getRecords(c.env, user.user_id);
  const index = records.findIndex(r => r.id === id);
  if (index === -1) return c.json({ success: false, error: '记录未找到' }, 404);

  records.splice(index, 1);
  const saved = await saveRecords(c.env, user.user_id, records);
  if (!saved) return c.json({ success: false, error: '删除失败' }, 500);

  return c.json({ success: true });
}

/** GET /api/stats - 获取统计数据 */
export async function getStats(c: Context<App>) {
  const user = c.get('user');
  const records = await getRecords(c.env, user.user_id);

  const currencyBreakdown: Record<string, number> = {};
  const categoryBreakdown: Record<string, number> = {};
  const monthlySummary: Record<string, number> = {};
  let totalAmount = 0;

  for (const r of records) {
    currencyBreakdown[r.currency] = (currencyBreakdown[r.currency] || 0) + r.amount;
    const cat = r.category || '其他';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + r.amount;
    const month = r.timestamp.substring(0, 7);
    monthlySummary[month] = (monthlySummary[month] || 0) + r.amount;
    totalAmount += r.amount;
  }

  return c.json({
    success: true,
    data: {
      total_records: records.length,
      total_amount: totalAmount,
      currency_breakdown: currencyBreakdown,
      category_breakdown: categoryBreakdown,
      monthly_summary: monthlySummary,
    } as StatsData,
  });
}

/** GET /api/categories - 获取所有分类 */
export async function getCategories(c: Context<App>) {
  const user = c.get('user');
  const records = await getRecords(c.env, user.user_id);
  const categories = [...new Set(records.map(r => r.category || '其他'))].sort();
  return c.json({ success: true, data: categories });
}

/** POST /api/records/import - 批量导入 */
export async function importRecords(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<{ records: Partial<LegacyRecord>[] }>();

  if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
    return c.json({ success: false, error: '请提供要导入的记录数组' }, 400);
  }

  const existing = await getRecords(c.env, user.user_id);
  const now = new Date().toISOString();
  const newRecords: LegacyRecord[] = [];

  for (const r of body.records) {
    if (!r.source || r.amount === undefined || !r.currency) continue;
    newRecords.push({
      id: crypto.randomUUID(),
      source: r.source,
      amount: Number(r.amount),
      currency: r.currency,
      category: r.category || '其他',
      description: r.description || '',
      timestamp: r.timestamp || now,
      created_at: now,
      updated_at: now,
    });
  }

  const allRecords = [...existing, ...newRecords];
  const saved = await saveRecords(c.env, user.user_id, allRecords);
  if (!saved) return c.json({ success: false, error: '保存失败' }, 500);

  return c.json({ success: true, data: { imported: newRecords.length, total: allRecords.length } }, 201);
}
