// ============================================================
// AI 分析模块 - 接入 Gemini API
// ============================================================

import type { Context } from 'hono';
import type { App, LedgerRecord, ChatMessage, ChatSession, GeminiResponse } from './types';
import { getJSON, putJSON } from './s3';

const CHATS_FILE = 'chats.json';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/** 获取用户聊天记录 */
async function getChats(env: App['Bindings'], userId: string): Promise<ChatSession[]> {
  return (await getJSON<ChatSession[]>(env, userId, CHATS_FILE)) || [];
}

/** 保存聊天记录 */
async function saveChats(env: App['Bindings'], userId: string, chats: ChatSession[]): Promise<boolean> {
  return putJSON(env, userId, CHATS_FILE, chats);
}

/** 构造 AI 分析用的系统提示 */
function buildSystemPrompt(records: LedgerRecord[]): string {
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

/** POST /api/ai/chat - AI 对话 */
export async function aiChat(c: Context<App>) {
  const user = c.get('user');
  const body = await c.req.json<{ message: string }>();

  if (!body.message || !body.message.trim()) {
    return c.json({ success: false, error: '请输入消息内容' }, 400);
  }

  const records = (await getJSON<LedgerRecord[]>(c.env, user.user_id, 'records.json')) || [];
  const chats = await getChats(c.env, user.user_id);

  const currentSession: ChatSession = chats.length > 0 ? chats[0] : {
    id: crypto.randomUUID(),
    messages: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const systemPrompt = buildSystemPrompt(records);
  const historyMessages = currentSession.messages.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  try {
    const response = await fetch(`${GEMINI_API}?key=${c.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          ...historyMessages,
          { role: 'user', parts: [{ text: body.message }] },
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    });

    if (!response.ok) {
      console.error('Gemini API error:', response.status);
      return c.json({ success: false, error: `AI 服务调用失败: ${response.status}` }, 502);
    }

    const data: GeminiResponse = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '抱歉，AI 无法生成回答。';

    const now = new Date().toISOString();
    currentSession.messages.push(
      { role: 'user', content: body.message, timestamp: now },
      { role: 'assistant', content: reply, timestamp: now }
    );
    currentSession.updated_at = now;

    const updatedChats = chats.filter(c => c.id !== currentSession.id);
    updatedChats.unshift(currentSession);
    await saveChats(c.env, user.user_id, updatedChats.slice(0, 10));

    return c.json({ success: true, data: { reply } });
  } catch (err) {
    console.error('AI chat error:', err);
    return c.json({ success: false, error: 'AI 服务异常' }, 500);
  }
}

/** GET /api/ai/history - 获取聊天历史 */
export async function getChatHistory(c: Context<App>) {
  const user = c.get('user');
  const chats = await getChats(c.env, user.user_id);
  return c.json({
    success: true,
    data: chats.length > 0 ? chats[0].messages : [],
  });
}

/** DELETE /api/ai/history - 清空聊天历史 */
export async function clearChatHistory(c: Context<App>) {
  const user = c.get('user');
  await saveChats(c.env, user.user_id, []);
  return c.json({ success: true });
}
