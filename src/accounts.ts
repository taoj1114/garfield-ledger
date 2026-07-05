// ============================================================
// 账户管理模块
// ============================================================

import type { Context } from 'hono';
import type { App, Account, AccountType } from './types';
import { getJSON, putJSON } from './s3';

const ACCOUNTS_FILE = 'accounts.json';

/** 默认账户（新用户初始化用） */
const DEFAULT_ACCOUNTS: Omit<Account, 'id' | 'created_at'>[] = [
  { name: '现金',        type: 'asset',    currency: 'CNY', sort_order: 1,  is_active: true },
  { name: '银行卡',      type: 'asset',    currency: 'CNY', sort_order: 2,  is_active: true },
  { name: '微信钱包',    type: 'asset',    currency: 'CNY', sort_order: 3,  is_active: true },
  { name: '支付宝',      type: 'asset',    currency: 'CNY', sort_order: 4,  is_active: true },
  { name: '工资收入',    type: 'income',   currency: 'CNY', sort_order: 10, is_active: true },
  { name: '投资收益',    type: 'income',   currency: 'CNY', sort_order: 11, is_active: true },
  { name: '其他收入',    type: 'income',   currency: 'CNY', sort_order: 12, is_active: true },
  { name: '餐饮费用',    type: 'expense',  currency: 'CNY', sort_order: 20, is_active: true },
  { name: '交通费用',    type: 'expense',  currency: 'CNY', sort_order: 21, is_active: true },
  { name: '购物支出',    type: 'expense',  currency: 'CNY', sort_order: 22, is_active: true },
  { name: '居住支出',    type: 'expense',  currency: 'CNY', sort_order: 23, is_active: true },
  { name: '医疗支出',    type: 'expense',  currency: 'CNY', sort_order: 24, is_active: true },
  { name: '娱乐支出',    type: 'expense',  currency: 'CNY', sort_order: 25, is_active: true },
  { name: '教育支出',    type: 'expense',  currency: 'CNY', sort_order: 26, is_active: true },
  { name: '其他支出',    type: 'expense',  currency: 'CNY', sort_order: 27, is_active: true },
];

async function getAccounts(env: App['Bindings'], userId: string): Promise<Account[]> {
  return (await getJSON<Account[]>(env, userId, ACCOUNTS_FILE)) || [];
}

async function saveAccounts(env: App['Bindings'], userId: string, accounts: Account[]): Promise<boolean> {
  return putJSON(env, userId, ACCOUNTS_FILE, accounts);
}

/** 确保用户有默认账户（首次使用时自动创建） */
export async function ensureDefaultAccounts(env: App['Bindings'], userId: string): Promise<Account[]> {
  let accounts = await getAccounts(env, userId);
  if (accounts.length > 0) return accounts;

  const now = new Date().toISOString();
  accounts = DEFAULT_ACCOUNTS.map((a, i) => ({
    ...a,
    id: crypto.randomUUID(),
    created_at: now,
  }));
  await saveAccounts(env, userId, accounts);
  return accounts;
}

/** GET /api/accounts - 列表 */
export async function listAccounts(c: Context<App>) {
  const user = c.get('user');
  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  return c.json({ success: true, data: accounts.sort((a, b) => a.sort_order - b.sort_order) });
}

/** POST /api/accounts - 创建 */
export async function createAccount(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<{ name: string; type: AccountType; currency?: string }>();
  if (!body.name?.trim() || !body.type) {
    return c.json({ success: false, error: '请提供账户名称和类型' }, 400);
  }

  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  if (accounts.some(a => a.name === body.name.trim())) {
    return c.json({ success: false, error: '账户名已存在' }, 409);
  }

  const maxOrder = Math.max(...accounts.map(a => a.sort_order), 0);
  const account: Account = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    type: body.type,
    currency: body.currency || 'CNY',
    sort_order: maxOrder + 1,
    is_active: true,
    created_at: new Date().toISOString(),
  };

  accounts.push(account);
  await saveAccounts(c.env, user.user_id, accounts);
  return c.json({ success: true, data: account }, 201);
}

/** PUT /api/accounts/:id - 更新 */
export async function updateAccount(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少 ID' }, 400);

  const body = await c.req.json<Partial<Account>>();
  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) return c.json({ success: false, error: '账户未找到' }, 404);

  accounts[idx] = { ...accounts[idx], ...body, id };
  await saveAccounts(c.env, user.user_id, accounts);
  return c.json({ success: true, data: accounts[idx] });
}

/** DELETE /api/accounts/:id - 删除 */
export async function deleteAccount(c: Context<App>) {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: '缺少 ID' }, 400);

  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) return c.json({ success: false, error: '账户未找到' }, 404);

  accounts.splice(idx, 1);
  await saveAccounts(c.env, user.user_id, accounts);
  return c.json({ success: true });
}
