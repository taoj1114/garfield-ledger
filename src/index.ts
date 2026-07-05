// ============================================================
// garfield-ledger - 主入口
// Cloudflare Workers + Hono + S3 存储 + 复式记账
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { App } from './types';
import { authMiddleware } from './middleware';
import { registerUser, loginUser } from './auth';
import {
  listAccounts, createAccount, updateAccount, deleteAccount,
} from './accounts';
import {
  listTransactions, createTransaction, getTransaction,
  updateTransaction, deleteTransaction,
} from './transactions';
import {
  getBalances, getBalanceSheet, getIncomeStatement, getAccountTransactions,
} from './reports';
import { aiChat, analyzeImport, getChatHistory, clearChatHistory } from './ai';
import {
  getSystemSettings, updateSystemSettings,
  getS3Config, updateS3Config,
  getAiConfig, updateAiConfig, testAiConnection,
  testS3Connection, getBucketStats,
} from './settings';
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
    data: { status: 'ok', s3_connected: s3ok, timestamp: new Date().toISOString() },
  });
});

// ============================================================
// 认证路由
// ============================================================
app.post('/api/auth/register', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) return c.json({ success: false, error: '请提供用户名和密码' }, 400);
  if (password.length < 6) return c.json({ success: false, error: '密码至少 6 位' }, 400);
  const result = await registerUser(c.env, username, password);
  if (!result.success) return c.json({ success: false, error: result.error }, 409);
  return c.json({ success: true, data: { userId: result.userId } }, 201);
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) return c.json({ success: false, error: '请提供用户名和密码' }, 400);
  const result = await loginUser(c.env, username, password);
  if (!result.success) return c.json({ success: false, error: result.error }, 401);
  return c.json({ success: true, data: { token: result.token, userId: result.userId } });
});

// ============================================================
// 认证中间件
// ============================================================
app.use('/api/accounts/*', authMiddleware);
app.use('/api/transactions/*', authMiddleware);
app.use('/api/reports/*', authMiddleware);
app.use('/api/settings/*', authMiddleware);
app.use('/api/ai/*', authMiddleware);

// ============================================================
// 账户管理 API
// ============================================================
app.get('/api/accounts', listAccounts);
app.post('/api/accounts', createAccount);
app.put('/api/accounts/:id', updateAccount);
app.delete('/api/accounts/:id', deleteAccount);

// ============================================================
// 复式交易 API
// ============================================================
app.get('/api/transactions', listTransactions);
app.post('/api/transactions', createTransaction);
app.get('/api/transactions/:id', getTransaction);
app.put('/api/transactions/:id', updateTransaction);
app.delete('/api/transactions/:id', deleteTransaction);

// ============================================================
// 报表 API
// ============================================================
app.get('/api/reports/balances', getBalances);
app.get('/api/reports/balance-sheet', getBalanceSheet);
app.get('/api/reports/income-statement', getIncomeStatement);
app.get('/api/reports/account-txns/:accountId', getAccountTransactions);

// ============================================================
// AI 分析
// ============================================================
app.post('/api/ai/chat', aiChat);
app.post('/api/ai/analyze-import', analyzeImport);
app.get('/api/ai/history', getChatHistory);
app.delete('/api/ai/history', clearChatHistory);

// ============================================================
// 系统设置
// ============================================================
app.get('/api/settings', getSystemSettings);
app.put('/api/settings', updateSystemSettings);
app.get('/api/settings/s3', getS3Config);
app.put('/api/settings/s3', updateS3Config);
app.get('/api/settings/ai', getAiConfig);
app.put('/api/settings/ai', updateAiConfig);
app.post('/api/settings/ai/test', testAiConnection);
app.post('/api/settings/test', testS3Connection);
app.get('/api/settings/stats', getBucketStats);

export default app;
