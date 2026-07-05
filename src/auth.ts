// ============================================================
// 认证模块 - 密码哈希 & JWT 管理
// ============================================================

import { SignJWT, jwtVerify } from 'jose';
import type { App, JwtPayload, UserData } from './types';
import { getJSON, putJSON } from './s3';

const ALG = 'HS256';

/** 使用 Web Crypto API 进行 PBKDF2 密码哈希 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const key = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  // 格式: salt(hex):hash(hex)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

/** 验证密码 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const key = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const computedHex = Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === hashHex;
}

/** 生成 JWT Token (7天有效期) */
export async function createToken(payload: Omit<JwtPayload, 'exp'>, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(secretKey);
}

/** 验证 JWT Token */
export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

/** 注册用户 */
export async function registerUser(
  env: App['Bindings'], username: string, password: string
): Promise<{ success: boolean; error?: string; userId?: string }> {
  // 检查用户是否已存在
  const existing = await getJSON<{ id: string; username: string }>(env, username, 'profile.json');
  if (existing) {
    return { success: false, error: '用户名已存在' };
  }

  const userId = crypto.randomUUID();
  const password_hash = await hashPassword(password);

  const userData: UserData = {
    id: userId,
    username,
    password_hash,
    created_at: new Date().toISOString(),
  };

  // 以 username 为 key 存储 profile (方便登录查询)
  const saved = await putJSON(env, username, 'profile.json', userData);
  if (!saved) {
    return { success: false, error: '存储用户信息失败' };
  }

  return { success: true, userId };
}

/** 登录验证 */
export async function loginUser(
  env: App['Bindings'], username: string, password: string
): Promise<{ success: boolean; error?: string; token?: string; userId?: string }> {
  const userData = await getJSON<UserData>(env, username, 'profile.json');
  if (!userData) {
    return { success: false, error: '用户名或密码错误' };
  }

  const valid = await verifyPassword(password, userData.password_hash);
  if (!valid) {
    return { success: false, error: '用户名或密码错误' };
  }

  const token = await createToken(
    { user_id: userData.id, username: userData.username },
    env.JWT_SECRET
  );

  return { success: true, token, userId: userData.id };
}
