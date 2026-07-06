// ============================================================
// 存储层 — 本地文件系统（服务器版）
// ============================================================

// @ts-nocheck - 忽略 Node.js 类型与 Worker 类型的冲突

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
function ensureDir(path: string) { const d = dirname(path); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

/** 读取 JSON */
export async function getJSON<T>(_env: any, scope: string, type: string): Promise<T | null> {
  const p = join(DATA_DIR, scope, type);
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) as T : null; } catch { return null; }
}

/** 写入 JSON */
export async function putJSON(_env: any, scope: string, type: string, data: unknown): Promise<boolean> {
  const p = join(DATA_DIR, scope, type);
  try { ensureDir(p); writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); return true; } catch { return false; }
}

/** 列出文件 */
export async function listObjects(_env: any, prefix: string): Promise<string[]> {
  const dir = join(DATA_DIR, prefix);
  try {
    if (!existsSync(dir)) return [];
    const result: string[] = [];
    function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else result.push(f.replace(DATA_DIR + '/', '')); } }
    walk(dir);
    return result;
  } catch { return []; }
}

/** 列出目录 */
export async function listDir(_env: any, prefix: string): Promise<string[]> {
  const dir = join(DATA_DIR, prefix);
  try { return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : []; } catch { return []; }
}

/** 健康检查 */
export async function healthCheck(_env: any): Promise<boolean> {
  try { ensureDir(join(DATA_DIR, '_test_', 'x')); return true; } catch { return false; }
}

/** 运行时配置（本地版不需要） */
export async function saveRuntimeConfig(): Promise<boolean> { return true; }
