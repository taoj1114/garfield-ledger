// ============================================================
// 本地存储版入口 — 替代 s3.ts 为本地文件系统
// ============================================================

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
function ensure(path: string) { const d = dirname(path); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

// 替换 s3 模块导出
export const getJSON = (env: any, scope: string, type: string) => {
  const p = join(DATA_DIR, scope, type);
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; } catch { return null; }
};
export const putJSON = (env: any, scope: string, type: string, data: any) => {
  const p = join(DATA_DIR, scope, type);
  try { ensure(p); writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); return true; } catch { return false; }
};
export const listObjects = (env: any, prefix: string): string[] => {
  const dir = join(DATA_DIR, prefix);
  try {
    if (!existsSync(dir)) return [];
    const r: string[] = [];
    function w(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) w(f); else r.push(f.replace(DATA_DIR + '/', '')); } }
    w(dir);
    return r;
  } catch { return []; }
};
export const healthCheck = (env: any) => {
  try { ensure(join(DATA_DIR, '_test_', 'x')); return true; } catch { return false; }
};
export const saveRuntimeConfig = () => Promise.resolve(true);
