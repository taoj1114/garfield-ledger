// ============================================================
// 交易模块（复式记账）
// ============================================================

import type { Context } from 'hono';
import type { App, Transaction, Entry, Account } from './types';
import { getJSON, putJSON } from './s3';
import { ensureDefaultAccounts } from './accounts';

const TXNS_FILE = 'transactions.json';

async function getTxns(env: App['Bindings'], userId: string): Promise<Transaction[]> {
  return (await getJSON<Transaction[]>(env, userId, TXNS_FILE)) || [];
}

async function saveTxns(env: App['Bindings'], userId: string, txns: Transaction[]): Promise<boolean> {
  return putJSON(env, userId, TXNS_FILE, txns);
}

/** 校验一组分录是否借贷平衡 */
function validateEntries(entries: Entry[]): string | null {
  if (entries.length < 2) return '一笔交易至少需要两条分录（一借一贷）';

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

  // 每条分录金额必须 >= 0
  for (const e of entries) {
    if (e.debit < 0 || e.credit < 0) return '金额不能为负数';
    if (e.debit === 0 && e.credit === 0) return '每条分录必须有金额';
    if (e.debit > 0 && e.credit > 0) return '每条分录只能为借或贷，不能同时有借和贷';
  }

  // 使用 1e-6 容差比较浮点
  if (Math.abs(totalDebit - totalCredit) > 1e-6) {
    return `借贷不平衡: 借方 ${totalDebit} ≠ 贷方 ${totalCredit}`;
  }

  return null;
}

/** 获取账户映射 { id → name } */
async function getAccountMap(env: App['Bindings'], userId: string): Promise<Map<string, Account>> {
  const accounts = await ensureDefaultAccounts(env, userId);
  const map = new Map<string, Account>();
  for (const a of accounts) map.set(a.id, a);
  return map;
}

/** GET /api/transactions - 列表 */
export async function listTransactions(c: Context<App>) {
  const user = c.get('user');
  const txns = await getTxns(c.env, user.user_id);
  const accountMap = await getAccountMap(c.env, user.user_id);

  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const accountId = url.searchParams.get('account_id');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  let filtered = txns;
  if (accountId) {
    filtered = filtered.filter(t => t.entries.some(e => e.account_id === accountId));
  }
  if (startDate) filtered = filtered.filter(t => t.timestamp >= startDate);
  if (endDate) filtered = filtered.filter(t => t.timestamp <= endDate);

  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const list = filtered.slice(offset, offset + limit).map(t => ({
    ...t,
    entries: t.entries.map(e => ({
      ...e,
      account_name: accountMap.get(e.account_id)?.name || '未知',
      account_type: accountMap.get(e.account_id)?.type || 'expense',
    })),
  }));

  return c.json({
    success: true,
    data: { transactions: list, total: filtered.length, offset, limit },
  });
}

/** POST /api/transactions - 创建交易 */
export async function createTransaction(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<{
    description: string;
    timestamp?: string;
    entries: Entry[];
  }>();

  if (!body.description?.trim()) {
    return c.json({ success: false, error: '请填写交易描述' }, 400);
  }
  if (!body.entries?.length) {
    return c.json({ success: false, error: '请提供分录' }, 400);
  }

  const err = validateEntries(body.entries);
  if (err) return c.json({ success: false, error: err }, 400);

  const now = new Date().toISOString();
  const txn: Transaction = {
    id: crypto.randomUUID(),
    description: body.description.trim(),
    timestamp: body.timestamp || now,
    entries: body.entries,
    created_at: now,
    updated_at: now,
  };

  const txns = await getTxns(c.env, user.user_id);
  txns.push(txn);
  await saveTxns(c.env, user.user_id, txns);

  return c.json({ success: true, data: txn }, 201);
}

/** GET /api/transactions/:id - 单条 */
export async function getTransaction(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少 ID' }, 400);

  const txns = await getTxns(c.env, user.user_id);
  const txn = txns.find(t => t.id === id);
  if (!txn) return c.json({ success: false, error: '交易未找到' }, 404);

  const accountMap = await getAccountMap(c.env, user.user_id);
  return c.json({
    success: true,
    data: {
      ...txn,
      entries: txn.entries.map(e => ({
        ...e,
        account_name: accountMap.get(e.account_id)?.name || '未知',
        account_type: accountMap.get(e.account_id)?.type || 'expense',
      })),
    },
  });
}

/** PUT /api/transactions/:id - 更新 */
export async function updateTransaction(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少 ID' }, 400);

  const txns = await getTxns(c.env, user.user_id);
  const idx = txns.findIndex(t => t.id === id);
  if (idx === -1) return c.json({ success: false, error: '交易未找到' }, 404);

  const body = await c.req.json<{ description?: string; timestamp?: string; entries?: Entry[] }>();

  if (body.entries) {
    const err = validateEntries(body.entries);
    if (err) return c.json({ success: false, error: err }, 400);
  }

  txns[idx] = {
    ...txns[idx],
    ...body,
    id,
    updated_at: new Date().toISOString(),
  };

  await saveTxns(c.env, user.user_id, txns);
  return c.json({ success: true, data: txns[idx] });
}

/** DELETE /api/transactions/:id - 删除 */
export async function deleteTransaction(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少 ID' }, 400);

  const txns = await getTxns(c.env, user.user_id);
  const idx = txns.findIndex(t => t.id === id);
  if (idx === -1) return c.json({ success: false, error: '交易未找到' }, 404);

  txns.splice(idx, 1);
  await saveTxns(c.env, user.user_id, txns);
  return c.json({ success: true });
}

/** GET /api/transactions/:id/entries - 分录详情 */
export async function getTransactionEntries(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  const txns = await getTxns(c.env, user.user_id);
  const txn = txns.find(t => t.id === id);
  if (!txn) return c.json({ success: false, error: '交易未找到' }, 404);

  const accountMap = await getAccountMap(c.env, user.user_id);
  return c.json({
    success: true,
    data: txn.entries.map(e => ({
      ...e,
      account_name: accountMap.get(e.account_id)?.name || '未知',
      account_type: accountMap.get(e.account_id)?.type || 'expense',
    })),
  });
}
