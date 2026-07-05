// ============================================================
// 前端缓存模块 — stale-while-revalidate
// ============================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 30_000; // 30 秒缓存有效期

const store = new Map<string, CacheEntry<unknown>>();

/** 获取缓存 */
export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return entry.data;
}

/** 设置缓存 */
export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, timestamp: Date.now() });
}

/** 检测缓存是否过期 */
export function cacheIsFresh(key: string): boolean {
  const entry = store.get(key);
  if (!entry) return false;
  return (Date.now() - entry.timestamp) < CACHE_TTL;
}

/** 清除缓存 */
export function cacheClear(pattern?: string): void {
  if (!pattern) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.includes(pattern)) store.delete(key);
  }
}

/** stale-while-revalidate: 先返回缓存，再异步刷新 */
export function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  onUpdate?: (data: T) => void,
): T | null {
  const cached = cacheGet<T>(key);

  // 缓存未过期 → 直接返回
  if (cacheIsFresh(key)) return cached;

  // 缓存过期或不存在 → 后台刷新
  fetcher()
    .then(fresh => {
      cacheSet(key, fresh);
      onUpdate?.(fresh);
    })
    .catch(() => {
      // 静默失败，下次请求再试
    });

  return cached; // 返回旧缓存（如果有）
}

/** 缓存装饰器: 先返回缓存的，后台刷新，回调通知 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  const cached = cacheGet<T>(key);
  const fresh = cacheIsFresh(key);

  if (fresh && cached !== null) {
    return { data: cached, fromCache: true };
  }

  // 过期或没有缓存 → 获取新数据
  try {
    const data = await fetcher();
    cacheSet(key, data);
    return { data, fromCache: false };
  } catch (err) {
    // 如果有旧缓存，兜底返回
    if (cached !== null) return { data: cached, fromCache: true };
    throw err;
  }
}
