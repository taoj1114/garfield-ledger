// ============================================================
// AI 分析模块
// ============================================================

import type { Context } from 'hono';
import type {
  App, ChatMessage, ChatSession,
  AnalyzeImportRequest, ImportAnalysisResult, Transaction, Account,
} from './types';
import { createAiClient, type AiRuntimeConfig } from './ai-client';
import { getJSON, putJSON } from './s3';
import { ensureDefaultAccounts } from './accounts';

const CHATS_FILE = 'chats.json';

/** 读取 AI 运行时配置（settings 覆盖 env vars） */
async function getAiRuntimeConfig(env: App['Bindings']): Promise<AiRuntimeConfig> {
  const settings = await getJSON<{
    ai_provider?: string; openai_api_key?: string; openai_base_url?: string;
    openai_model?: string; gemini_api_key?: string; gemini_model?: string;
  }>(env, '_global', 'config/settings.json');
  if (!settings) return {};
  return {
    ai_provider: settings.ai_provider || env.AI_PROVIDER,
    openai_api_key: settings.openai_api_key || env.OPENAI_API_KEY,
    openai_base_url: settings.openai_base_url || env.OPENAI_BASE_URL,
    openai_model: settings.openai_model || env.OPENAI_MODEL,
    gemini_api_key: settings.gemini_api_key || env.GEMINI_API_KEY,
    gemini_model: settings.gemini_model || env.GEMINI_MODEL,
  };
}

/** 检查是否真正配置了 AI Key */
export async function checkAiConfigured(env: App['Bindings']): Promise<boolean> {
  const cfg = await getAiRuntimeConfig(env);
  if (cfg.ai_provider === 'openai') return !!cfg.openai_api_key;
  return !!cfg.gemini_api_key;
}

async function getChats(env: App['Bindings'], userId: string): Promise<ChatSession[]> {
  return (await getJSON<ChatSession[]>(env, userId, CHATS_FILE)) || [];
}

async function saveChats(env: App['Bindings'], userId: string, chats: ChatSession[]): Promise<boolean> {
  return putJSON(env, userId, CHATS_FILE, chats);
}

// ============================================================
// 构造分析提示 — 基于复式交易数据
// ============================================================
async function buildAnalysisPrompt(env: App['Bindings'], userId: string): Promise<string> {
  const txns: Transaction[] = (await getJSON<Transaction[]>(env, userId, 'transactions.json')) || [];
  const accounts: Account[] = await ensureDefaultAccounts(env, userId);
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // 统计各账户余额
  const balances = new Map<string, number>();
  for (const a of accounts) balances.set(a.id, 0);
  for (const t of txns) {
    for (const e of t.entries) {
      const acc = accountMap.get(e.account_id);
      if (!acc) continue;
      const cur = balances.get(e.account_id) || 0;
      if (acc.type === 'asset' || acc.type === 'expense') {
        balances.set(e.account_id, cur + e.debit - e.credit);
      } else {
        balances.set(e.account_id, cur + e.credit - e.debit);
      }
    }
  }

  const assetBals = accounts.filter(a => a.type === 'asset').map(a => `  ${a.name}: ${(balances.get(a.id) || 0).toFixed(2)} ${a.currency}`);
  const incomeTotal = accounts.filter(a => a.type === 'income').reduce((s, a) => s + (balances.get(a.id) || 0), 0);
  const expenseTotal = accounts.filter(a => a.type === 'expense').reduce((s, a) => s + (balances.get(a.id) || 0), 0);

  const recent = [...txns]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
    .map(t => {
      const parts = t.entries.map(e => {
        const name = accountMap.get(e.account_id)?.name || '?';
        return e.debit > 0 ? `借:${name}(${e.debit})` : `贷:${name}(${e.credit})`;
      });
      return `[${t.timestamp.slice(0, 10)}] ${t.description}: ${parts.join(', ')}`;
    })
    .join('\n');

  return `你是一个个人财务记账助手，帮助用户分析其复式记账数据。

## 资产余额
${assetBals.join('\n')}

## 收支概况
- 总收入: ${incomeTotal.toFixed(2)}
- 总支出: ${expenseTotal.toFixed(2)}
- 净收入: ${(incomeTotal - expenseTotal).toFixed(2)}

## 最近 10 笔交易
${recent || '暂无交易'}

请基于以上数据回答用户的问题。可以做：消费趋势分析、收支占比、月度对比、异常支出提醒、预算建议等。
回答请用中文，简洁专业。`;
}

// ============================================================
// AI 导入分析提示
// ============================================================
const IMPORT_ANALYSIS_PROMPT = `你是一个智能数据导入识别助手。将用户输入的任意格式文本解析为结构化记账数据。

## 支持的输入类型
- 银行流水 / 支付宝 / 微信账单文本
- CSV / TSV 原始数据
- JSON 数组
- 自然语言描述（如 "昨天买菜花了35块"）

## 要求
1. 识别数据来源类型
2. 提取: source(来源), amount(金额), currency(货币), category(分类), description(备注), timestamp(时间)
3. 时间统一为 ISO 8601 格式

## 输出 JSON
{
  "source_type": "数据来源",
  "total": 数量,
  "description": "分析说明",
  "records": [{ "source", "amount", "currency": "CNY", "category", "description", "timestamp" }]
}

只输出 JSON，不要多余文字。`;

// ============================================================
// POST /api/ai/chat
// ============================================================
export async function aiChat(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<{ message: string }>();
  if (!body.message?.trim()) return c.json({ success: false, error: '请输入消息' }, 400);

  const chats = await getChats(c.env, user.user_id);
  const now = new Date().toISOString();
  const currentSession: ChatSession = chats.length > 0 ? chats[0] : {
    id: crypto.randomUUID(), messages: [], created_at: now, updated_at: now,
  };

  try {
    const client = createAiClient(c.env, await getAiRuntimeConfig(c.env));
    const systemPrompt = await buildAnalysisPrompt(c.env, user.user_id);
    const history = currentSession.messages.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const reply = await client.chat([
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: body.message },
    ]);

    currentSession.messages.push(
      { role: 'user', content: body.message, timestamp: now },
      { role: 'assistant', content: reply, timestamp: now },
    );
    currentSession.updated_at = now;

    const updatedChats = chats.filter(c => c.id !== currentSession.id);
    updatedChats.unshift(currentSession);
    await saveChats(c.env, user.user_id, updatedChats.slice(0, 10));

    return c.json({ success: true, data: { reply } });
  } catch (err) {
    console.error('AI chat error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'AI 异常' }, 500);
  }
}

// ============================================================
// POST /api/ai/analyze-import
// ============================================================
export async function analyzeImport(c: Context<App>) {
  const body = await c.req.json<AnalyzeImportRequest>();
  if (!body.text?.trim()) return c.json({ success: false, error: '请提供数据文本' }, 400);

  try {
    const client = createAiClient(c.env, await getAiRuntimeConfig(c.env));
    const formatHint = body.format ? `\n\n提示: 输入格式为 ${body.format}` : '';
    const reply = await client.chat([
      { role: 'system', content: IMPORT_ANALYSIS_PROMPT },
      { role: 'user', content: `请分析以下数据:\n\n\`\`\`\n${body.text}\n\`\`\`${formatHint}` },
    ], { responseFormat: 'json', temperature: 0.3 });

    const result: ImportAnalysisResult = JSON.parse(reply);
    if (!result.records?.length) throw new Error('AI 未识别出有效记录');

    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('AI analyze error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : '分析失败' }, 500);
  }
}

// ============================================================
// GET /api/ai/history
// ============================================================
export async function getChatHistory(c: Context<App>) {
  const user = c.get('user');
  const chats = await getChats(c.env, user.user_id);
  return c.json({ success: true, data: chats.length > 0 ? chats[0].messages : [] });
}

// ============================================================
// DELETE /api/ai/history
// ============================================================
export async function clearChatHistory(c: Context<App>) {
  const user = c.get('user');
  await saveChats(c.env, user.user_id, []);
  return c.json({ success: true });
}
