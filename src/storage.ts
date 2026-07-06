// ============================================================
// 本地文件存储 — 替代 S3，数据保存在 data/ 目录
// ============================================================

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 读取 JSON 文件 */
export function getJSON<T>(scope: string, type: string): T | null {
  const path = join(DATA_DIR, scope, type);
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 写入 JSON 文件 */
export function putJSON(scope: string, type: string, data: unknown): boolean {
  const path = join(DATA_DIR, scope, type);
  try {
    ensureDir(path);
    writeFileSync(path, JSON.stringify(data), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** 列出目录下的文件 / 前缀匹配 */
export function listObjects(prefix: string): string[] {
  const dir = join(DATA_DIR, prefix);
  try {
    if (!existsSync(dir)) return [];
    return listFilesRecursive(dir);
  } catch {
    return [];
  }
}

function listFilesRecursive(dir: string): string[] {
  const result: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      result.push(...listFilesRecursive(full));
    } else {
      result.push(full.replace(DATA_DIR + '/', ''));
    }
  }
  return result;
}

/** 删除文件 */
export function deleteFile(scope: string, type: string): boolean {
  const path = join(DATA_DIR, scope, type);
  try {
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** 健康检查 */
export function healthCheck(): boolean {
  try {
    ensureDir(join(DATA_DIR, '_test_'));
    const testPath = join(DATA_DIR, '_test_', 'ping.json');
    writeFileSync(testPath, JSON.stringify({ ping: true }), 'utf-8');
    const data = readFileSync(testPath, 'utf-8');
    rmSync(testPath);
    return JSON.parse(data)?.ping === true;
  } catch {
    return false;
  }
}
