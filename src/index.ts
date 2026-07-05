// ============================================================
// garfield-ledger - 主入口
// Cloudflare Workers + Hono + S3 存储
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { App } from './types';
import { authMiddleware } from './middleware';
import { registerUser, loginUser } from './auth';
import {
  listRecords, createRecord, getRecord, updateRecord, deleteRecord,
  getStats, getCategories, importRecords,
} from './records';
import { aiChat, analyzeImport, suggestCategories, getChatHistory, clearChatHistory } from './ai';
import { healthCheck } from './s3';

const app = new Hono<App>();

// ============================================================
// 全局中间件
// ============================================================
app.use('*', logger());
app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', async (c) => {
  const s3ok = await healthCheck(c.env);
  return c.json({
    success: true,
    data: {
      status: 'ok',
      s3_connected: s3ok,
      timestamp: new Date().toISOString(),
    },
  });
});

// ============================================================
// 认证路由 (无需登录)
// ============================================================
app.post('/api/auth/register', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) {
    return c.json({ success: false, error: '请提供用户名和密码' }, 400);
  }
  if (password.length < 6) {
    return c.json({ success: false, error: '密码至少 6 位' }, 400);
  }
  const result = await registerUser(c.env, username, password);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 409);
  }
  return c.json({ success: true, data: { userId: result.userId } }, 201);
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) {
    return c.json({ success: false, error: '请提供用户名和密码' }, 400);
  }
  const result = await loginUser(c.env, username, password);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 401);
  }
  return c.json({
    success: true,
    data: { token: result.token, userId: result.userId },
  });
});

// ============================================================
// 需要认证的路由
// ============================================================
app.use('/api/records/*', authMiddleware);
app.use('/api/stats', authMiddleware);
app.use('/api/categories', authMiddleware);
app.use('/api/ai/*', authMiddleware);

app.get('/api/records', listRecords);
app.post('/api/records', createRecord);
app.post('/api/records/import', importRecords);
app.get('/api/records/:id', getRecord);
app.put('/api/records/:id', updateRecord);
app.delete('/api/records/:id', deleteRecord);

app.get('/api/stats', getStats);
app.get('/api/categories', getCategories);

app.post('/api/ai/chat', aiChat);
app.post('/api/ai/analyze-import', analyzeImport);
app.post('/api/ai/suggest-categories', suggestCategories);
app.get('/api/ai/history', getChatHistory);
app.delete('/api/ai/history', clearChatHistory);

// ============================================================
// 导出
// ============================================================
export default app;
