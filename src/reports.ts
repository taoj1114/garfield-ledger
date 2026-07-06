// ============================================================
// 财务报表模块 — 支持多币种
// ============================================================

import type { Context } from 'hono';
import type { App, Transaction, Account } from './types';
import { getJSON } from './s3';
import { ensureDefaultAccounts } from './accounts';

interface AccountBalance {
  account: Account;
  balance: number;
  currency: string;
}

/** 计算所有账户余额（按账户+币种） */
async function calculateBalances(env: App['Bindings'], userId: string): Promise<AccountBalance[]> {
  const txns: Transaction[] = (await getJSON<Transaction[]>(env, userId, 'transactions.json')) || [];
  const accounts = await ensureDefaultAccounts(env, userId);
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // key = account_id:currency
  const raw = new Map<string, number>();

  function add(accountId: string, currency: string, amount: number) {
    const key = `${accountId}:${currency}`;
    raw.set(key, (raw.get(key) || 0) + amount);
  }

  for (const t of txns) {
    for (const e of t.entries) {
      const acc = accountMap.get(e.account_id);
      if (!acc) continue;
      const cc = e.currency || acc.currency || 'CNY';
      const net = e.debit - e.credit;
      switch (acc.type) {
        case 'asset':
        case 'expense':
          // 资产/费用: 借方增加, 贷方减少
          add(e.account_id, cc, net);
          break;
        case 'income':
        case 'liability':
          // 收入/负债: 贷方增加, 借方减少
          add(e.account_id, cc, -net);
          break;
      }
    }
  }

  // 转成 AccountBalance 列表
  const result: AccountBalance[] = [];
  for (const a of accounts) {
    for (const [key, balance] of raw) {
      const [accId, currency] = key.split(':');
      if (accId === a.id) {
        result.push({ account: a, balance, currency });
      }
    }
    // 确保每个账户至少有一个余额记录
    if (!result.some(r => r.account.id === a.id)) {
      result.push({ account: a, balance: 0, currency: a.currency });
    }
  }

  return result;
}

/** GET /api/reports/balances — 各账户余额 */
export async function getBalances(c: Context<App>) {
  const user = c.get('user');
  const balances = await calculateBalances(c.env, user.user_id);
  return c.json({ success: true, data: balances });
}

/** GET /api/reports/balance-sheet — 资产负债表 */
export async function getBalanceSheet(c: Context<App>) {
  const user = c.get('user');
  const balances = await calculateBalances(c.env, user.user_id);
  const assets = balances.filter(b => b.account.type === 'asset' && b.balance !== 0);
  const liabilities = balances.filter(b => b.account.type === 'liability' && b.balance !== 0);
  const totalAssets = assets.reduce((s, b) => s + b.balance, 0);
  const totalLiabilities = liabilities.reduce((s, b) => s + b.balance, 0);
  return c.json({
    success: true,
    data: {
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      equity: totalAssets - totalLiabilities,
      assets, liabilities,
    },
  });
}

/** GET /api/reports/income-statement — 损益表 */
export async function getIncomeStatement(c: Context<App>) {
  const user = c.get('user');
  const balances = await calculateBalances(c.env, user.user_id);
  const incomes = balances.filter(b => b.account.type === 'income' && b.balance !== 0);
  const expenses = balances.filter(b => b.account.type === 'expense' && b.balance !== 0);
  return c.json({
    success: true,
    data: { incomes, expenses, total_income: incomes.reduce((s, b) => s + b.balance, 0), total_expense: expenses.reduce((s, b) => s + b.balance, 0) },
  });
}

/** GET /api/reports/account-txns/:accountId — 获取指定账户的交易 */
export async function getAccountTransactions(c: Context<App>) {
  const user = c.get('user');
  const accountId = c.req.param('accountId');
  const txns: Transaction[] = (await getJSON<Transaction[]>(c.env, user.user_id, 'transactions.json')) || [];
  const filtered = txns.filter(t => t.entries.some(e => e.account_id === accountId));
  return c.json({ success: true, data: filtered });
}
