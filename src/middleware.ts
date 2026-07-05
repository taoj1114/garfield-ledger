// ============================================================
// 中间件 - JWT 认证
// ============================================================

import type { Context, Next } from 'hono';
import { verifyToken } from './auth';
import type { App } from './types';

/** 从 Authorization header 提取并验证 JWT */
export async function authMiddleware(c: Context<App>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: '未提供认证令牌' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ success: false, error: '令牌无效或已过期' }, 401);
  }

  c.set('user', payload);
  await next();
}

/** 可选认证 (不强制) */
export async function optionalAuthMiddleware(c: Context<App>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload) {
      c.set('user', payload);
    }
  }
  await next();
}
