// ============================================================
// 财务报表模块
// ============================================================

import type { Context } from 'hono';
import type { App, Transaction, Account } from './types';
import { getJSON } from './s3';
import { ensureDefaultAccounts } from './accounts';

interface AccountBalance {
  account: Account;
  balance: number;
}

interface BalanceSheet {
  assets: AccountBalance[];
  total_assets: number;
  liabilities: AccountBalance[];
  total_liabilities: number;
  equity: number;
}

/** 计算所有账户余额 */
async function calculateBalances(env: App['Bindings'], userId: string): Promise<Map<string, number>> {
  const txns: Transaction[] = (await getJSON<Transaction[]>(env, userId, 'transactions.json')) || [];
  const accounts = await ensureDefaultAccounts(env, userId);

  // 初始化余额为 0
  const balances = new Map<string, number>();
  for (const a of accounts) balances.set(a.id, 0);

  // 逐笔计算
  for (const t of txns) {
    for (const e of t.entries) {
      const acc = accounts.find(a => a.id === e.account_id);
      if (!acc) continue;

      const current = balances.get(e.account_id) || 0;
      switch (acc.type) {
        case 'asset':
        case 'expense':
          // 资产/费用类: 借方增加, 贷方减少
          balances.set(e.account_id, current + e.debit - e.credit);
          break;
        case 'income':
        case 'liability':
          // 收入/负债类: 贷方增加, 借方减少 (反向)
          balances.set(e.account_id, current + e.credit - e.debit);
          break;
      }
    }
  }

  return balances;
}

/** GET /api/reports/balances - 所有账户余额 */
export async function getBalances(c: Context<App>) {
  const user = c.get('user');
  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  const balances = await calculateBalances(c.env, user.user_id);

  const result: AccountBalance[] = accounts
    .filter(a => a.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(a => ({
      account: a,
      balance: balances.get(a.id) || 0,
    }));

  return c.json({ success: true, data: result });
}

/** GET /api/reports/balance-sheet - 资产负债表 */
export async function getBalanceSheet(c: Context<App>) {
  const user = c.get('user');
  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  const balances = await calculateBalances(c.env, user.user_id);

  const assets: AccountBalance[] = [];
  const liabilities: AccountBalance[] = [];
  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const a of accounts) {
    if (!a.is_active) continue;
    const bal = balances.get(a.id) || 0;

    if (a.type === 'asset') {
      assets.push({ account: a, balance: bal });
      totalAssets += bal;
    } else if (a.type === 'liability') {
      liabilities.push({ account: a, balance: bal });
      totalLiabilities += bal;
    }
  }

  // 权益 = 资产 - 负债 (未考虑收入/费用结转到权益)
  const incomeBalance = accounts
    .filter(a => a.type === 'income')
    .reduce((s, a) => s + (balances.get(a.id) || 0), 0);
  const expenseBalance = accounts
    .filter(a => a.type === 'expense')
    .reduce((s, a) => s + (balances.get(a.id) || 0), 0);
  const equity = totalAssets - totalLiabilities;

  const report: BalanceSheet = {
    assets: assets.sort((a, b) => a.account.sort_order - b.account.sort_order),
    total_assets: totalAssets,
    liabilities: liabilities.sort((a, b) => a.account.sort_order - b.account.sort_order),
    total_liabilities: totalLiabilities,
    equity,
  };

  return c.json({ success: true, data: report });
}

/** GET /api/reports/income-statement - 损益表 */
export async function getIncomeStatement(c: Context<App>) {
  const user = c.get('user');
  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  const balances = await calculateBalances(c.env, user.user_id);

  const incomes = accounts.filter(a => a.type === 'income' && a.is_active).map(a => ({
    account: a,
    balance: balances.get(a.id) || 0,
  }));

  const expenses = accounts.filter(a => a.type === 'expense' && a.is_active).map(a => ({
    account: a,
    balance: balances.get(a.id) || 0,
  }));

  const totalIncome = incomes.reduce((s, i) => s + i.balance, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.balance, 0);

  return c.json({
    success: true,
    data: {
      incomes,
      expenses,
      total_income: totalIncome,
      total_expense: totalExpense,
      net_income: totalIncome - totalExpense,
    },
  });
}

/** GET /api/reports/account-txns/:accountId - 某账户的交易明细 */
export async function getAccountTransactions(c: Context<App>) {
  const user = c.get('user');
  const accountId = c.req.param('accountId');
  if (!accountId) return c.json({ success: false, error: '缺少账户 ID' }, 400);

  const txns: Transaction[] = (await getJSON<Transaction[]>(c.env, user.user_id, 'transactions.json')) || [];
  const accountMap = new Map<string, Account>();
  const accounts = await ensureDefaultAccounts(c.env, user.user_id);
  for (const a of accounts) accountMap.set(a.id, a);

  const target = accounts.find(a => a.id === accountId);
  if (!target) return c.json({ success: false, error: '账户未找到' }, 404);

  // 找出涉及该账户的所有交易
  const related = txns
    .filter(t => t.entries.some(e => e.account_id === accountId))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 200)
    .map(t => {
      const selfEntry = t.entries.find(e => e.account_id === accountId)!;
      // 计算方向：资产类借方为正，贷方为负；反之亦然
      let amount = target.type === 'asset' || target.type === 'expense'
        ? selfEntry.debit - selfEntry.credit
        : selfEntry.credit - selfEntry.debit;

      return {
        id: t.id,
        description: t.description,
        timestamp: t.timestamp,
        amount,
        entries: t.entries.map(e => ({
          ...e,
          account_name: accountMap.get(e.account_id)?.name || '未知',
        })),
      };
    });

  return c.json({
    success: true,
    data: {
      account: target,
      transactions: related,
    },
  });
}
