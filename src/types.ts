// ============================================================
// garfield-ledger - 共享类型定义
// ============================================================

/** 账户类型 */
export type AccountType = 'asset' | 'income' | 'expense' | 'liability';

/** 账户 */
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

/** 会计分录 */
export interface Entry {
  account_id: string;
  debit: number;
  credit: number;
  description?: string;
}

/** 交易（复式记账） */
export interface Transaction {
  id: string;
  description: string;
  timestamp: string;
  entries: Entry[];
  created_at: string;
  updated_at: string;
}

/** 带账户名的分录（前端用） */
export interface EntryWithAccount extends Entry {
  account_name?: string;
  account_type?: AccountType;
}

/** 交易 + 展开的分录 */
export interface TransactionWithEntries extends Transaction {
  entries: EntryWithAccount[];
}

/** 账户余额 */
export interface AccountBalance {
  account: Account;
  balance: number;
}

/** 资产负债表 */
export interface BalanceSheet {
  assets: AccountBalance[];
  total_assets: number;
  liabilities: AccountBalance[];
  total_liabilities: number;
  equity: number;
}

/** 旧记账记录（兼容迁移用） */
export interface LegacyRecord {
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

/** 统计数据（旧版兼容） */
export interface StatsData {
  total_records: number;
  total_amount: number;
  currency_breakdown: Record<string, number>;
  category_breakdown: Record<string, number>;
  monthly_summary: Record<string, number>;
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

/** JWT 载荷 */
export interface JwtPayload {
  user_id: string;
  username: string;
  exp: number;
}

/** 导入分析结果 */
export interface ImportAnalysisResult {
  source_type: string;
  total: number;
  records: Partial<LegacyRecord>[];
  description: string;
}

/** 导入分析请求 */
export interface AnalyzeImportRequest {
  text: string;
  format?: string;
}

/** 环境变量绑定 */
export interface EnvBindings {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_REGION: string;
  S3_BUCKET: string;
  JWT_SECRET: string;
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
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
