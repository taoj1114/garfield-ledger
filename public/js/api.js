// ============================================================
// garfield-ledger - API 客户端
// ============================================================

const API_BASE = '/api';

const api = {
  /** 获取存储的 token */
  getToken() {
    return localStorage.getItem('ledger_token');
  },

  /** 保存 token */
  setToken(token) {
    localStorage.setItem('ledger_token', token);
  },

  /** 清除 token */
  clearToken() {
    localStorage.removeItem('ledger_token');
  },

  /** 获取当前用户名 */
  getUsername() {
    return localStorage.getItem('ledger_username');
  },

  /** 设置用户名 */
  setUsername(name) {
    localStorage.setItem('ledger_username', name);
  },

  /** 通用请求方法 */
  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = { method, headers };
    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || '请求失败');
    }

    return data.data;
  },

  // ---- 认证 ----
  async login(username, password) {
    const data = await this.request('POST', '/auth/login', { username, password });
    this.setToken(data.token);
    this.setUsername(username);
    return data;
  },

  async register(username, password) {
    return await this.request('POST', '/auth/register', { username, password });
  },

  logout() {
    this.clearToken();
    this.setUsername('');
  },

  // ---- 记录 ----
  async getRecords(params = {}) {
    const query = new URLSearchParams();
    if (params.category) query.set('category', params.category);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const qs = query.toString();
    return await this.request('GET', `/records${qs ? '?' + qs : ''}`);
  },

  async getRecord(id) {
    return await this.request('GET', `/records/${id}`);
  },

  async createRecord(record) {
    return await this.request('POST', '/records', record);
  },

  async updateRecord(id, record) {
    return await this.request('PUT', `/records/${id}`, record);
  },

  async deleteRecord(id) {
    return await this.request('DELETE', `/records/${id}`);
  },

  async importRecords(records) {
    return await this.request('POST', '/records/import', { records });
  },

  // ---- 统计 ----
  async getStats() {
    return await this.request('GET', '/stats');
  },

  async getCategories() {
    return await this.request('GET', '/categories');
  },

  // ---- AI ----
  async aiChat(message) {
    return await this.request('POST', '/ai/chat', { message });
  },

  async getChatHistory() {
    return await this.request('GET', '/ai/history');
  },

  async clearChatHistory() {
    return await this.request('DELETE', '/ai/history');
  },

  // ---- 健康检查 ----
  async healthCheck() {
    return await this.request('GET', '/health');
  },
};
