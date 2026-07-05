import { useState, useEffect } from 'preact/compat';
import { getBalances, getTransactions, type AccountBalance, type Transaction } from '../api';

export default function DashboardPage() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [b, t] = await Promise.all([
        getBalances().catch(() => []),
        getTransactions({ limit: '10' }).catch(() => ({ transactions: [] })),
      ]);
      setBalances(b);
      setRecentTxns(t.transactions || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  const assetBals = balances.filter(b => b.account.type === 'asset' && b.account.is_active);
  const incomeTotal = balances.filter(b => b.account.type === 'income').reduce((s, b) => s + b.balance, 0);
  const expenseTotal = balances.filter(b => b.account.type === 'expense').reduce((s, b) => s + b.balance, 0);
  const totalAssets = assetBals.reduce((s, b) => s + b.balance, 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📊 财务概览</h1>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state-icon">📋</div><p>加载中...</p></div>
      ) : (
        <>
          {/* 核心指标 */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 24 }}>{totalAssets.toFixed(2)}</div>
              <div className="stat-label">总资产</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 24, color: 'var(--success)' }}>+{incomeTotal.toFixed(2)}</div>
              <div className="stat-label">总收入</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 24, color: 'var(--danger)' }}>-{expenseTotal.toFixed(2)}</div>
              <div className="stat-label">总支出</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: 24, color: incomeTotal - expenseTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {(incomeTotal - expenseTotal).toFixed(2)}
              </div>
              <div className="stat-label">净结余</div>
            </div>
          </div>

          {/* 各账户余额 */}
          {assetBals.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>💳 账户余额</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {assetBals.map(b => (
                  <div key={b.account.id} style={{
                    background: '#f1f5f9', borderRadius: 8, padding: '8px 16px', textAlign: 'center', minWidth: 100,
                  }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.account.name}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: b.balance >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                      {b.balance.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最近交易 */}
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
                        <td>{new Date(t.timestamp).toLocaleDateString('zh-CN')}</td>
                        <td><strong>{esc(t.description)}</strong></td>
                        <td style={{ fontSize: 12, lineHeight: 1.8 }}>
                          {t.entries.map((e, i) => (
                            <span key={i} style={{
                              display: 'inline-block', marginRight: 8,
                              color: e.debit > 0 ? 'var(--primary)' : undefined,
                            }}>
                              {esc(e.account_name || '')} {e.debit > 0 ? `借${e.debit}` : `贷${e.credit}`}
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

function esc(s: string): string {
  return s?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
}
