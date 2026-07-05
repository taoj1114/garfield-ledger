// ============================================================
// 统一 AI 客户端 — 同时支持 OpenAI 兼容 API 和 Gemini
// ============================================================

import type { App } from './types';

/** AI 消息格式 */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 聊天选项 */
export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

/** AI 客户端接口 */
export interface AiClient {
  chat(messages: AiMessage[], options?: AiChatOptions): Promise<string>;
}

// ============================================================
// OpenAI 兼容客户端
// ============================================================
class OpenAiClient implements AiClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(env: App['Bindings']) {
    this.apiKey = env.OPENAI_API_KEY || '';
    this.baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  async chat(messages: AiMessage[], options?: AiChatOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
    };

    if (options?.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data: { choices?: { message?: { content?: string } }[] } = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  }
}

// ============================================================
// Gemini 客户端
// ============================================================
class GeminiClient implements AiClient {
  private apiKey: string;
  private model: string;

  constructor(env: App['Bindings']) {
    this.apiKey = env.GEMINI_API_KEY || '';
    this.model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  }

  async chat(messages: AiMessage[], options?: AiChatOptions): Promise<string> {
    // Gemini: system 消息合并到第一条 user 消息
    const geminiContents: { role: string; parts: { text: string }[] }[] = [];
    let systemPrompt = '';

    for (const m of messages) {
      if (m.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + m.content;
      } else if (m.role === 'user') {
        const content = systemPrompt
          ? `[系统指令]\n${systemPrompt}\n\n[用户消息]\n${m.content}`
          : m.content;
        geminiContents.push({ role: 'user', parts: [{ text: content }] });
        systemPrompt = '';
      } else {
        geminiContents.push({ role: 'model', parts: [{ text: m.content }] });
      }
    }

    // 如果 system 没有跟随 user 消息，追加为 user 消息
    if (systemPrompt) {
      geminiContents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    }

    const body: Record<string, unknown> = {
      contents: geminiContents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    };

    if (options?.responseFormat === 'json') {
      (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data: { candidates?: { content?: { parts?: { text?: string }[] } }[] } = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

// ============================================================
// 工厂方法
// ============================================================
export function createAiClient(env: App['Bindings']): AiClient {
  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();

  switch (provider) {
    case 'openai':
      if (!env.OPENAI_API_KEY) throw new Error('AI_PROVIDER=openai 但未设置 OPENAI_API_KEY');
      return new OpenAiClient(env);
    case 'gemini':
      if (!env.GEMINI_API_KEY) throw new Error('AI_PROVIDER=gemini 但未设置 GEMINI_API_KEY');
      return new GeminiClient(env);
    default:
      throw new Error(`不支持的 AI_PROVIDER: ${provider}（支持: openai, gemini）`);
  }
}
