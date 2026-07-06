// ============================================================
// 汇率换算模块 — 自动获取 + 缓存 + 换算
// ============================================================

import type { App } from './types';
import { getJSON, putJSON } from './s3';

const CACHE_KEY = '_global/config/exchange_rates.json';
const CACHE_TTL = 3600_000; // 1 小时
const FALLBACK_RATES: Record<string, number> = {
  CNY: 1,
  USD: 7.24, EUR: 7.85, HKD: 0.93, JPY: 0.048,
  ETH: 17245, BTC: 470000, USDT: 7.24,
};

let memCache: { rates: Record<string, number>; ts: number } | null = null;

/** 获取所有汇率（以 CNY 为基准） */
export async function getRates(env: App['Bindings']): Promise<Record<string, number>> {
  // 内存缓存
  if (memCache && Date.now() - memCache.ts < CACHE_TTL) return memCache.rates;

  // 尝试从 S3/KV 读持久化汇率
  const stored = await getJSON<{ rates: Record<string, number>; ts: number }>(env, '_global', 'config/exchange_rates.json');
  if (stored && Date.now() - stored.ts < CACHE_TTL) {
    memCache = stored;
    return stored.rates;
  }

  // 过期或没有 → 尝试在线获取
  const rates = { ...FALLBACK_RATES };
  try {
    await fetchRates(rates);
    // 持久化
    const data = { rates, ts: Date.now() };
    memCache = data;
    putJSON(env, '_global', 'config/exchange_rates.json', data).catch(() => {});
  } catch {
    // 网络失败 → 用 fallback
    memCache = { rates, ts: Date.now() };
  }

  return rates;
}

/** 强制刷新汇率 */
export async function refreshRates(env: App['Bindings']): Promise<Record<string, number>> {
  const rates = { ...FALLBACK_RATES };
  await fetchRates(rates);
  const data = { rates, ts: Date.now() };
  memCache = data;
  await putJSON(env, '_global', 'config/exchange_rates.json', data);
  return rates;
}

/** 从多个免费 API 获取实时汇率（结果以 CNY 为基准：1 Currency = X CNY） */
async function fetchRates(rates: Record<string, number>): Promise<void> {
  // 1. CoinGecko — 加密货币对 CNY 价格
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=cny',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data: Record<string, Record<string, number>> = await res.json();
      if (data.bitcoin?.cny) rates.BTC = data.bitcoin.cny;       // 1 BTC = X CNY
      if (data.ethereum?.cny) rates.ETH = data.ethereum.cny;     // 1 ETH = X CNY
      if (data.tether?.cny) rates.USDT = data.tether.cny;        // 1 USDT = X CNY
    }
  } catch { /* 忽略 */ }

  // 2. ExchangeRate-API — 法币 (base=USD, 返回 1 USD = X Others)
  try {
    const res = await fetch(
      'https://api.exchangerate-api.com/v4/latest/USD',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data: { rates: Record<string, number> } = await res.json();
      const cnyPerUsd = data.rates?.CNY; // 1 USD = X CNY
      if (cnyPerUsd) {
        rates.USD = cnyPerUsd;            // 1 USD = X CNY
        rates.CNY = 1;                    // 基准
        // 其他法币: 1 EUR = ? CNY → cnyPerUsd / data.rates.EUR
        for (const cc of ['EUR', 'HKD', 'JPY']) {
          if (data.rates[cc]) rates[cc] = cnyPerUsd / data.rates[cc];
        }
      }
    }
  } catch { /* 忽略 */ }
}

/** 换算金额到 CNY */
export function toBaseCny(amount: number, fromCurrency: string, rates: Record<string, number>): number {
  const rate = rates[fromCurrency?.toUpperCase()];
  if (!rate || rate <= 0) return amount;
  return amount * rate;
}

/** 格式化换算金额 */
export function formatBaseAmount(cnyAmount: number): string {
  if (Math.abs(cnyAmount) >= 10000) return `¥${(cnyAmount / 10000).toFixed(2)}万`;
  if (Math.abs(cnyAmount) >= 1) return `¥${cnyAmount.toFixed(2)}`;
  return `¥${cnyAmount.toFixed(4)}`;
}
