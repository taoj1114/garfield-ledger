import { useState, useEffect } from 'preact/compat';
import { getBalances, getTransactions, getExchangeRates, type AccountBalance, type Transaction } from '../api';

export default function DashboardPage() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [b, t, r] = await Promise.all([
        getBalances().catch(() => []),
        getTransactions({ limit: '10' }).catch(() => ({ transactions: [] })),
        getExchangeRates().catch(() => ({})),
      ]);
      setBalances(b);
      setRecentTxns(t.transactions || []);
      setRates(r);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  // 换算到 CNY
  const cnyRate = rates['CNY'] || 1;
  function toCny(amount: number, currency: string): number {
    const rate = rates[currency?.toUpperCase()];
    return rate ? amount * rate / cnyRate : amount;
  }

  const assetBals = balances.filter(b => b.account.type === 'asset' && b.account.is_active);
  const incomeTotal = balances.filter(b => b.account.type === 'income').reduce((s, b) => s + toCny(b.balance, b.currency), 0);
  const expenseTotal = balances.filter(b => b.account.type === 'expense').reduce((s, b) => s + toCny(b.balance, b.currency), 0);

  let totalAssetsCny = 0;
  for (const b of assetBals) totalAssetsCny += toCny(b.balance, b.currency);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📊 财务概览</h1>
        <button className="btn btn-sm" onClick={load}>🔄 刷新</button>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state-icon">📋</div><p>加载中...</p></div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 22 }}>≈ ¥{totalAssetsCny.toFixed(2)}</div>
              <div className="stat-label">总资产（折合 CNY）</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 22, color: 'var(--success)' }}>+{incomeTotal.toFixed(2)}</div>
              <div className="stat-label">总收入（CNY）</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 22, color: 'var(--danger)' }}>-{expenseTotal.toFixed(2)}</div>
              <div className="stat-label">总支出（CNY）</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 22, color: incomeTotal - expenseTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {(incomeTotal - expenseTotal).toFixed(2)}
              </div>
              <div className="stat-label">净结余（CNY）</div>
            </div>
          </div>

          {assetBals.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>💳 账户余额</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {assetBals.map(b => (
                  <div key={b.account.id} style={{
                    background: '#f1f5f9', borderRadius: 8, padding: '8px 16px', textAlign: 'center', minWidth: 120,
                  }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.account.name} ({b.currency})</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: b.balance >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                      {b.balance.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      ≈ ¥{toCny(b.balance, b.account.currency).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 汇率简表 */}
          {Object.keys(rates).length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ fontSize: 15 }}>💱 汇率（1 CNY =）</h3>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>自动获取，每小时刷新</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(rates).filter(([k]) => k !== 'CNY').slice(0, 8).map(([cc, rate]) => (
                  <span key={cc} style={{
                    background: '#f1f5f9', borderRadius: 6, padding: '4px 10px', fontSize: 12,
                  }}>
                    <strong>{cc}</strong> {(1 / rate).toFixed(cc === 'BTC' || cc === 'ETH' ? 8 : 4)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>📋 最近交易</h3>
            {recentTxns.length === 0 ? (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-icon">📭</div>
                <div className="empty-state-text" style={{ fontSize: 14 }}>暂无交易</div>
                <p className="stat-label" style={{ marginTop: 8 }}>前往「记账」页面开始复式记账</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th>时间</th><th>描述</th><th>分录</th></tr></thead>
                  <tbody>
                    {recentTxns.map(t => (
                      <tr key={t.id}>
                        <td data-label="时间">{new Date(t.timestamp).toLocaleDateString('zh-CN')}</td>
                        <td data-label="描述"><strong>{esc(t.description)}</strong></td>
                        <td data-label="分录" style={{ fontSize: 12, lineHeight: 1.8 }}>
                          {t.entries.map((e, i) => (
                            <span key={i} style={{
                              display: 'inline-block', marginRight: 8,
                              color: e.debit > 0 ? 'var(--primary)' : undefined,
                            }}>
                              {esc(e.account_name || '')} <span style={{fontSize:10,color:'var(--text-secondary)'}}>{e.currency || e.account_currency || ''}</span> {e.debit > 0 ? `借${e.debit}` : `贷${e.credit}`}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function esc(s: string): string { return s?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || ''; }
