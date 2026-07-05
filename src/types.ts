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

/** 导入分析 - 识别结果 */
export interface ImportAnalysisResult {
  /** 数据来源描述 (如: 微信账单 / 支付宝账单 / 银行流水 / 手动记账) */
  source_type: string;
  /** 总条数 */
  total: number;
  /** 解析后的记录列表 */
  records: Partial<LedgerRecord>[];
  /** 分析说明 */
  description: string;
}

/** 导入分析请求 */
export interface AnalyzeImportRequest {
  /** 待分析的原始文本 */
  text: string;
  /** 可选指定格式 (csv / json / text) */
  format?: string;
}

/** 分类建议结果 */
export interface CategorySuggestion {
  record_id: string;
  source: string;
  suggested_category: string;
  confidence: number;
  reason: string;
}

/** 环境变量绑定 */
export interface EnvBindings {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_REGION: string;
  S3_BUCKET: string;
  JWT_SECRET: string;
  // AI 通用配置
  AI_PROVIDER?: string;
  // OpenAI 兼容参数
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  // Gemini 参数
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ASSETS: Fetcher;
}

/** Hono App 类型 */
export type App = {
  Bindings: EnvBindings;
  Variables: {
    user: JwtPayload;
  };
};
