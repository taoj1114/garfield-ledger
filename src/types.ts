// ============================================================
// garfield-ledger - 共享类型定义
// ============================================================

/** 记账记录 */
export interface LedgerRecord {
  id: string;
  source: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  timestamp: string;
  created_at: string;
  updated_at: string;
}

/** 用户信息 */
export interface UserData {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

/** AI 聊天消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** AI 聊天会话 */
export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

/** 统计数据 */
export interface StatsData {
  total_records: number;
  total_amount: number;
  currency_breakdown: Record<string, number>;
  category_breakdown: Record<string, number>;
  monthly_summary: Record<string, number>;
}

/** JWT 载荷 */
export interface JwtPayload {
  user_id: string;
  username: string;
  exp: number;
}

/** Gemini API 响应 */
export interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

/** 环境变量绑定 */
export interface EnvBindings {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_REGION: string;
  S3_BUCKET: string;
  JWT_SECRET: string;
  GEMINI_API_KEY: string;
  ASSETS: Fetcher;
}

/** Hono App 类型 - 包含 Env 和 Variables */
export type App = {
  Bindings: EnvBindings;
  Variables: {
    user: JwtPayload;
  };
};
