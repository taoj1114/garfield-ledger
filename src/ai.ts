// ============================================================
// AI 分析模块 — 统一客户端 + 智能导入分析
// ============================================================

import type { Context } from 'hono';
import type {
  App, LedgerRecord, ChatMessage, ChatSession,
  AnalyzeImportRequest, ImportAnalysisResult,
} from './types';
import { getJSON, putJSON } from './s3';
import { createAiClient, type AiMessage } from './ai-client';

const CHATS_FILE = 'chats.json';

async function getChats(env: App['Bindings'], userId: string): Promise<ChatSession[]> {
  return (await getJSON<ChatSession[]>(env, userId, CHATS_FILE)) || [];
}

async function saveChats(env: App['Bindings'], userId: string, chats: ChatSession[]): Promise<boolean> {
  return putJSON(env, userId, CHATS_FILE, chats);
}

// ============================================================
// 记账分析系统提示
// ============================================================
function buildAnalysisPrompt(records: LedgerRecord[]): string {
  const catStats: Record<string, { count: number; amount: number }> = {};
  const monthlyTrend: Record<string, number> = {};
  let totalAmount = 0;

  for (const r of records) {
    const cat = r.category || '其他';
    if (!catStats[cat]) catStats[cat] = { count: 0, amount: 0 };
    catStats[cat].count++;
    catStats[cat].amount += r.amount;
    const month = r.timestamp.substring(0, 7);
    monthlyTrend[month] = (monthlyTrend[month] || 0) + r.amount;
    totalAmount += r.amount;
  }

  const recent = [...records]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
    .map(r => `[${r.timestamp}] ${r.category} - ${r.source}: ${r.amount}${r.currency}${r.description ? ' (' + r.description + ')' : ''}`)
    .join('\n');

  const catSummary = Object.entries(catStats)
    .map(([cat, s]) => `- ${cat}: ${s.count} 笔, 共 ${s.amount}`)
    .join('\n');

  return `你是一个个人财务记账助手，帮助用户分析其记账数据。

## 当前统计数据
- 总记录数: ${records.length}
- 总金额: ${totalAmount}
- 月度趋势: ${JSON.stringify(monthlyTrend)}

## 分类统计
${catSummary}

## 最近 10 条记录
${recent || '暂无记录'}

请基于以上数据回答用户的问题。可以做：消费趋势分析、分类支出占比、月度对比、异常支出提醒、预算建议等。
回答请用中文，简洁专业。`;
}

// ============================================================
// AI 导入分析系统提示
// ============================================================
const IMPORT_ANALYSIS_PROMPT = `你是一个智能数据导入识别助手。你的任务是将用户输入的任意格式文本解析为结构化记账记录。

## 支持的输入类型
1. 银行流水 / 支付宝 / 微信账单的截图文字
2. CSV / TSV 原始数据
3. JSON 数组
4. 自然语言描述（如 "昨天买菜花了35块"）
5. 混合格式文本

## 要求
1. 识别数据来源类型（银行 / 支付宝 / 微信 / 手动 / 其他）
2. 提取每条记录的: source(来源), amount(金额数字), currency(货币单位), category(分类), description(备注), timestamp(时间)
3. 如果输入中不含分类信息，根据来源和描述智能推断分类
4. 时间格式统一为 ISO 8601 字符串
5. 如果输入是纯自然语言（如 "今天吃饭花了50，打车花了30"），逐条拆分为独立记录

## 输出格式 (严格 JSON)
{
  "source_type": "数据来源描述",
  "total": 数量,
  "description": "分析说明（解释识别出了什么数据）",
  "records": [
    {
      "source": "来源名称",
      "amount": 数字,
      "currency": "CNY",
      "category": "分类名称",
      "description": "备注",
      "timestamp": "ISO 时间"
    }
  ]
}

注意: 只输出 JSON，不要任何解释文字。`;
// ============================================================
// POST /api/ai/chat - AI 对话分析
// ============================================================
export async function aiChat(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<{ message: string }>();
  if (!body.message?.trim()) {
    return c.json({ success: false, error: '请输入消息内容' }, 400);
  }

  const records = (await getJSON<LedgerRecord[]>(c.env, user.user_id, 'records.json')) || [];
  const chats = await getChats(c.env, user.user_id);
  const now = new Date().toISOString();

  const currentSession: ChatSession = chats.length > 0 ? chats[0] : {
    id: crypto.randomUUID(), messages: [], created_at: now, updated_at: now,
  };

  try {
    const client = createAiClient(c.env);
    const systemPrompt = buildAnalysisPrompt(records);

    const historyMessages: AiMessage[] = currentSession.messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const reply = await client.chat([
      { role: 'system', content: systemPrompt },
      ...historyMessages,
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
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : 'AI 服务异常',
    }, 500);
  }
}

// ============================================================
// POST /api/ai/analyze-import - AI 导入分析
// ============================================================
export async function analyzeImport(c: Context<App>) {
  const body = await c.req.json<AnalyzeImportRequest>();
  if (!body.text?.trim()) {
    return c.json({ success: false, error: '请提供要分析的数据文本' }, 400);
  }

  try {
    const client = createAiClient(c.env);

    // 如果有格式提示，附加到消息中
    const formatHint = body.format
      ? `\n\n提示: 输入数据格式为 ${body.format}`
      : '\n\n请自动识别输入的数据格式并解析。';

    const reply = await client.chat([
      { role: 'system', content: IMPORT_ANALYSIS_PROMPT },
      { role: 'user', content: `请分析以下数据:\n\n\`\`\`\n${body.text}\n\`\`\`${formatHint}` },
    ], { responseFormat: 'json', temperature: 0.3 });

    // 解析 JSON 响应
    const result: ImportAnalysisResult = JSON.parse(reply);

    if (!result.records || !Array.isArray(result.records)) {
      throw new Error('AI 返回的数据格式异常');
    }

    return c.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('AI analyze-import error:', err);
    // 尝试从原始回答中恢复
    return c.json({
      success: false,
      error: err instanceof Error
        ? `分析失败: ${err.message}`
        : 'AI 分析服务异常',
    }, 500);
  }
}

// ============================================================
// POST /api/ai/suggest-categories - AI 分类建议
// ============================================================
export async function suggestCategories(c: Context<App>) {
  const body = await c.req.json<{ records: Partial<LedgerRecord>[] }>();
  if (!body.records?.length) {
    return c.json({ success: false, error: '请提供待分类的记录' }, 400);
  }

  const sample = body.records.slice(0, 10).map(r =>
    `- source: "${r.source}", description: "${r.description || ''}"`
  ).join('\n');

  const prompt = `你是一个记账分类助手。根据来源和描述为每条记录推荐最佳分类。

可用分类: 餐饮, 交通, 购物, 居住, 工资, 投资, 医疗, 娱乐, 教育, 其他

请为以下记录推荐分类，输出 JSON 数组:
[
  {"source": "...", "suggested_category": "...", "confidence": 0-1, "reason": "..."}
]

记录:
${sample}`;

  try {
    const client = createAiClient(c.env);
    const reply = await client.chat([
      { role: 'system', content: '你是一个分类助手。只输出 JSON，不要解释。' },
      { role: 'user', content: prompt },
    ], { responseFormat: 'json', temperature: 0.3 });

    const suggestions = JSON.parse(reply);
    return c.json({ success: true, data: suggestions });
  } catch (err) {
    console.error('AI suggest error:', err);
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : '分类建议失败',
    }, 500);
  }
}

// ============================================================
// GET /api/ai/history
// ============================================================
export async function getChatHistory(c: Context<App>) {
  const user = c.get('user');
  const chats = await getChats(c.env, user.user_id);
  return c.json({
    success: true,
    data: chats.length > 0 ? chats[0].messages : [],
  });
}

// ============================================================
// DELETE /api/ai/history
// ============================================================
export async function clearChatHistory(c: Context<App>) {
  const user = c.get('user');
  await saveChats(c.env, user.user_id, []);
  return c.json({ success: true });
}
