// ============================================================
// API 客户端
// ============================================================

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('ledger_token');
}

function setToken(token: string) {
  localStorage.setItem('ledger_token', token);
}

function clearToken() {
  localStorage.removeItem('ledger_token');
}

export function getUsername(): string {
  return localStorage.getItem('ledger_username') || '';
}

export function setUsername(name: string) {
  localStorage.setItem('ledger_username', name);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout() {
  clearToken();
  localStorage.removeItem('ledger_username');
}

async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options: RequestInit = { method, headers };
  if (body !== undefined) options.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json() as { success: boolean; data?: T; error?: string };

  if (!data.success) throw new Error(data.error || '请求失败');
  return data.data as T;
}

// ---- 认证 ----
export async function login(username: string, password: string) {
  const data = await request<{ token: string; userId: string }>('POST', '/auth/login', { username, password });
  setToken(data.token);
  setUsername(username);
  return data;
}

export async function register(username: string, password: string) {
  return request<{ userId: string }>('POST', '/auth/register', { username, password });
}

// ---- 账户管理 ----
export interface Account {
  id: string;
  name: string;
  type: 'asset' | 'income' | 'expense' | 'liability';
  currency: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export async function getAccounts() {
  return request<Account[]>('GET', '/accounts');
}

export async function createAccount(data: { name: string; type: Account['type']; currency?: string }) {
  return request<Account>('POST', '/accounts', data);
}

export async function updateAccount(id: string, data: Partial<Account>) {
  return request<Account>('PUT', `/accounts/${id}`, data);
}

export async function deleteAccount(id: string) {
  return request<void>('DELETE', `/accounts/${id}`);
}

// ---- 复式交易 ----
export interface Entry {
  account_id: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface Transaction {
  id: string;
  description: string;
  timestamp: string;
  entries: (Entry & { account_name?: string; account_type?: string })[];
  created_at: string;
  updated_at: string;
}

export interface TransactionsResult {
  transactions: Transaction[];
  total: number;
  offset: number;
  limit: number;
}

export async function getTransactions(params?: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return request<TransactionsResult>('GET', `/transactions${qs ? '?' + qs : ''}`);
}

export async function getTransaction(id: string) {
  return request<Transaction>('GET', `/transactions/${id}`);
}

export async function createTransaction(data: { description: string; timestamp?: string; entries: Entry[] }) {
  return request<Transaction>('POST', '/transactions', data);
}

export async function updateTransaction(id: string, data: Partial<Transaction>) {
  return request<Transaction>('PUT', `/transactions/${id}`, data);
}

export async function deleteTransaction(id: string) {
  return request<void>('DELETE', `/transactions/${id}`);
}

// ---- 报表 ----
export interface AccountBalance {
  account: Account;
  balance: number;
}

export async function getBalances() {
  return request<AccountBalance[]>('GET', '/reports/balances');
}

export async function getBalanceSheet() {
  return request<{ assets: AccountBalance[]; total_assets: number; liabilities: AccountBalance[]; total_liabilities: number; equity: number }>('GET', '/reports/balance-sheet');
}

export async function getIncomeStatement() {
  return request<{ incomes: AccountBalance[]; expenses: AccountBalance[]; total_income: number; total_expense: number; net_income: number }>('GET', '/reports/income-statement');
}

// ---- AI ----
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export async function aiChat(message: string) {
  return request<{ reply: string }>('POST', '/ai/chat', { message });
}

export async function getChatHistory() {
  return request<ChatMessage[]>('GET', '/ai/history');
}

export async function clearChatHistory() {
  return request<void>('DELETE', '/ai/history');
}

export async function analyzeImport(text: string) {
  return request<{ source_type: string; total: number; records: { source: string; amount: number; currency: string; category: string; description?: string; timestamp: string }[]; description: string }>(
    'POST', '/ai/analyze-import', { text }
  );
}

// ---- 系统设置 ----
export async function getSettings() {
  return request<{
    s3: { endpoint: string; region: string; bucket: string; connected: boolean };
    settings: { backup_folder: string; cache_enabled: boolean; updated_at: string };
  }>('GET', '/settings');
}

export async function updateSettings(data: { backup_folder?: string; cache_enabled?: boolean }) {
  return request<{ backup_folder: string; cache_enabled: boolean; updated_at: string }>('PUT', '/settings', data);
}

export async function testSettings() {
  return request<{ all_ok: boolean; results: Record<string, unknown> }>('POST', '/settings/test');
}

export async function getSettingsStats() {
  return request<{ total_files: number; json_files: number; user_count: number; file_types: Record<string, number>; backup_folder: string }>('GET', '/settings/stats');
}

// ---- S3 运行时配置 ----
export async function getS3ConfigApi() {
  return request<{
    endpoint: string;
    access_key_id: string;
    secret_access_key: string;
    region: string;
    bucket: string;
    source: string;
  }>('GET', '/settings/s3');
}

export async function updateS3ConfigApi(data: {
  endpoint: string;
  access_key_id: string;
  secret_access_key: string;
  region?: string;
  bucket: string;
}) {
  return request<{
    endpoint: string;
    access_key_id: string;
    secret_access_key: string;
    region: string;
    bucket: string;
    source: string;
  }>('PUT', '/settings/s3', data);
}
