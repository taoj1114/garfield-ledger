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

// ---- 记账记录 ----
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

export interface RecordsResult {
  records: LedgerRecord[];
  total: number;
  offset: number;
  limit: number;
}

export async function getRecords(params?: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return request<RecordsResult>('GET', `/records${query ? '?' + query : ''}`);
}

export async function getRecord(id: string) {
  return request<LedgerRecord>('GET', `/records/${id}`);
}

export async function createRecord(record: Partial<LedgerRecord>) {
  return request<LedgerRecord>('POST', '/records', record);
}

export async function updateRecord(id: string, record: Partial<LedgerRecord>) {
  return request<LedgerRecord>('PUT', `/records/${id}`, record);
}

export async function deleteRecord(id: string) {
  return request<void>('DELETE', `/records/${id}`);
}

export async function importRecords(records: Partial<LedgerRecord>[]) {
  return request<{ imported: number; total: number }>('POST', '/records/import', { records });
}

// ---- 统计 ----
export interface StatsData {
  total_records: number;
  total_amount: number;
  currency_breakdown: Record<string, number>;
  category_breakdown: Record<string, number>;
  monthly_summary: Record<string, number>;
}

export async function getStats() {
  return request<StatsData>('GET', '/stats');
}

export async function getCategories() {
  return request<string[]>('GET', '/categories');
}

// ---- AI ----
export async function aiChat(message: string) {
  return request<{ reply: string }>('POST', '/ai/chat', { message });
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export async function getChatHistory() {
  return request<ChatMessage[]>('GET', '/ai/history');
}

export async function clearChatHistory() {
  return request<void>('DELETE', '/ai/history');
}

// ---- CSV 导入导出 ----
export function exportCsv(records: LedgerRecord[]) {
  const headers = '时间,来源,金额,货币,分类,备注';
  const rows = records.map(r =>
    `${r.timestamp},${r.source},${r.amount},${r.currency},${r.category},"${r.description}"`
  );
  const csv = '\uFEFF' + [headers, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `记账数据_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseCsv(text: string): Partial<LedgerRecord>[] {
  const lines = text.split('\n').filter(l => l.trim());
  const records: Partial<LedgerRecord>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    records.push({
      source: cols[1]?.trim() || '',
      amount: parseFloat(cols[2]?.trim()) || 0,
      currency: cols[3]?.trim() || 'CNY',
      category: cols[4]?.trim() || '其他',
      description: cols[5]?.replace(/^"|"$/g, '').trim() || '',
      timestamp: cols[0]?.trim() || new Date().toISOString(),
    });
  }
  return records.filter(r => r.source && r.amount);
}
