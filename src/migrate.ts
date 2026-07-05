// ============================================================
// 数据迁移：旧单式记录 → 复式交易
// ============================================================

import type { Context } from 'hono';
import type { App, LegacyRecord, Transaction, Entry, Account } from './types';
import { getJSON, putJSON } from './s3';
import { ensureDefaultAccounts } from './accounts';

/** 将旧分类名称映射到账户 ID */
async function categoryToAccountId(env: App['Bindings'], userId: string, category: string, isPositive: boolean): Promise<string | null> {
  const accounts = await ensureDefaultAccounts(env, userId);

  // 收入类分类
  const incomeCategories: Record<string, string> = {
    '工资': '工资收入',
    '投资': '投资收益',
  };

  // 支出类分类映射到费用账户
  const expenseCategories: Record<string, string> = {
    '餐饮': '餐饮费用',
    '交通': '交通费用',
    '购物': '购物支出',
    '居住': '居住支出',
    '医疗': '医疗支出',
    '娱乐': '娱乐支出',
    '教育': '教育支出',
  };

  if (isPositive) {
    // 正数 = 收入
    const targetName = incomeCategories[category] || '其他收入';
    return accounts.find(a => a.name === targetName)?.id || null;
  } else {
    // 负数 = 支出
    const targetName = expenseCategories[category] || '其他支出';
    return accounts.find(a => a.name === targetName)?.id || null;
  }
}

/** 获取默认资产账户 ID */
async function getDefaultAssetAccount(env: App['Bindings'], userId: string): Promise<string | null> {
  const accounts = await ensureDefaultAccounts(env, userId);
  return accounts.find(a => a.name === '现金')?.id || accounts.find(a => a.type === 'asset')?.id || null;
}

/** POST /api/migrate - 将旧 records.json 迁移为 transactions */
export async function migrateFromLegacy(c: Context<App>) {
  const user = c.get('user');

  // 读取旧数据
  const oldRecords: LegacyRecord[] = (await getJSON<LegacyRecord[]>(c.env, user.user_id, 'records.json')) || [];
  if (oldRecords.length === 0) {
    return c.json({ success: false, error: '没有需要迁移的旧数据' });
  }

  // 检查是否已迁移
  const existingTxns: Transaction[] = (await getJSON<Transaction[]>(c.env, user.user_id, 'transactions.json')) || [];
  if (existingTxns.length > 0) {
    return c.json({
      success: false,
      error: '已有交易数据，无法重复迁移。如需重置请先删除 transactions.json',
      data: { old_count: oldRecords.length, existing_count: existingTxns.length },
    });
  }

  const defaultAssetId = await getDefaultAssetAccount(c.env, user.user_id);
  if (!defaultAssetId) {
    return c.json({ success: false, error: '未找到默认资产账户' }, 500);
  }

  const newTxns: Transaction[] = [];
  let skipped = 0;

  for (const r of oldRecords) {
    const isIncome = r.amount > 0;
    const targetAccountId = await categoryToAccountId(c.env, user.user_id, r.category, isIncome);

    if (!targetAccountId) {
      skipped++;
      continue;
    }

    const absAmount = Math.abs(r.amount);
    const entries: Entry[] = isIncome
      ? [
          { account_id: defaultAssetId, debit: absAmount, credit: 0, description: r.source },
          { account_id: targetAccountId, debit: 0, credit: absAmount, description: r.description },
        ]
      : [
          { account_id: targetAccountId, debit: absAmount, credit: 0, description: r.description },
          { account_id: defaultAssetId, debit: 0, credit: absAmount, description: r.source },
        ];

    newTxns.push({
      id: crypto.randomUUID(),
      description: r.source,
      timestamp: r.timestamp,
      entries,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }

  // 保存交易数据
  await putJSON(c.env, user.user_id, 'transactions.json', newTxns);

  return c.json({
    success: true,
    data: {
      migrated: newTxns.length,
      skipped,
      total_old: oldRecords.length,
      message: `成功迁移 ${newTxns.length} 条记录，跳过 ${skipped} 条`,
    },
  });
}
