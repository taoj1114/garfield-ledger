import { useState, useEffect } from 'preact/compat';
import {
  getAccounts, getTransactions, createTransaction, updateTransaction, deleteTransaction,
  getBalances,
  type Account, type Transaction, type Entry, type AccountBalance,
} from '../api';

export default function TransactionsPage() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // 表单状态
  const [desc, setDesc] = useState('');
  const [ts, setTs] = useState('');
  const [entries, setEntries] = useState<({ account_id: string; side: 'debit' | 'credit'; amountStr: string; currency: string; desc: string })[]>([
    { account_id: '', side: 'debit', amountStr: '', currency: '', desc: '' },
    { account_id: '', side: 'credit', amountStr: '', currency: '', desc: '' },
  ]);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [r, a, b] = await Promise.all([
        getTransactions({ limit: '200' }),
        getAccounts(),
        getBalances(),
      ]);
      setTxns(r.transactions);
      setTotal(r.total);
      setAccounts(a);
      setBalances(b);
    } catch (err: unknown) {
      alert('加载失败: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  // ---- 表单 ----
  const assetAccounts = accounts.filter(a => a.type === 'asset' && a.is_active);
  const incomeAccounts = accounts.filter(a => a.type === 'income' && a.is_active);
  const expenseAccounts = accounts.filter(a => a.type === 'expense' && a.is_active);

  function openAddForm() {
    setEditId(null);
    setDesc('');
    setTs(new Date().toISOString().slice(0, 10));
    setEntries([
      { account_id: '', side: 'debit', amountStr: '', currency: '', desc: '' },
      { account_id: '', side: 'credit', amountStr: '', currency: '', desc: '' },
    ]);
    setError('');
    setShowForm(true);
  }

  function openEdit(txn: Transaction) {
    setEditId(txn.id);
    setDesc(txn.description);
    setTs(txn.timestamp.slice(0, 10));
    setEntries(txn.entries.map(e => ({
      account_id: e.account_id,
      side: e.debit > 0 ? 'debit' as const : 'credit' as const,
      amountStr: String(e.debit > 0 ? e.debit : e.credit),
      currency: e.currency || '',
      desc: e.description || '',
    })));
    setError('');
    setShowForm(true);
  }

  function updateEntry(i: number, field: string, value: string | number) {
    const newEntries = [...entries];
    (newEntries[i] as Record<string, unknown>)[field] = value;
    setEntries(newEntries);
  }

  function addRow() {
    setEntries([...entries, { account_id: '', side: 'debit', amountStr: '', currency: '', desc: '' }]);
  }

  function removeRow(i: number) {
    if (entries.length <= 2) return;
    setEntries(entries.filter((_, idx) => idx !== i));
  }

  function totalDebit() {
    return entries.filter(e => e.side === 'debit').reduce((s, e) => s + (parseFloat(e.amountStr) || 0), 0);
  }

  function totalCredit() {
    return entries.filter(e => e.side === 'credit').reduce((s, e) => s + (parseFloat(e.amountStr) || 0), 0);
  }

  const diff = Math.abs(totalDebit() - totalCredit());

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');

    if (!desc.trim()) { setError('请填写交易描述'); return; }
    if (entries.some(e => !e.account_id)) { setError('请为每条分录选择账户'); return; }
    if (entries.some(e => (parseFloat(e.amountStr) || 0) <= 0)) { setError('金额必须大于 0'); return; }
    if (diff > 0.001) { setError(`借贷不平衡: 借方 ${totalDebit()} ≠ 贷方 ${totalCredit()}`); return; }

    try {
      const txnData = {
        description: desc.trim(),
        timestamp: ts || new Date().toISOString(),
        entries: entries.map(e => ({
          account_id: e.account_id,
          debit: e.side === 'debit' ? (parseFloat(e.amountStr) || 0) : 0,
          credit: e.side === 'credit' ? (parseFloat(e.amountStr) || 0) : 0,
          currency: e.currency || undefined,
          description: e.desc || undefined,
        })),
      };
      if (editId) {
        await updateTransaction(editId, txnData);
      } else {
        await createTransaction(txnData);
      }
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此交易？将影响相关账户余额。')) return;
    try {
      await deleteTransaction(id);
      await load();
    } catch (err: unknown) {
      alert('删除失败: ' + (err instanceof Error ? err.message : ''));
    }
  }

  // ---- 账户 name lookup ----
  function accountName(id: string) {
    return accounts.find(a => a.id === id)?.name || '未知';
  }

  function balanceFor(accountId: string) {
    const b = balances.find(x => x.account.id === accountId);
    return b ? b.balance : 0;
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📒 复式记账</h1>
        <button className="btn btn-primary" onClick={openAddForm}>+ 新建交易</button>
      </div>

      {/* 交易列表 */}
      <div className="card">
        {loading ? (
          <div className="empty-state"><div className="empty-state-icon">📋</div><p>加载中...</p></div>
        ) : txns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-text">还没有交易记录</div>
            <p className="stat-label" style={{ marginTop: 12 }}>点击右上角「新建交易」开始复式记账</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>时间</th><th>描述</th><th>分录</th><th>金额</th><th>操作</th></tr>
              </thead>
              <tbody>
                {txns.map(t => (
                  <tr key={t.id}>
                    <td data-label="时间" style={{ fontSize: 12 }}>{new Date(t.timestamp).toLocaleDateString('zh-CN')}</td>
                    <td data-label="描述"><strong>{esc(t.description)}</strong></td>
                    <td data-label="分录" style={{ fontSize: 12 }}>
                      {t.entries.map((e, i) => (
                        <div key={i} style={{ color: e.debit > 0 ? 'var(--primary)' : 'var(--danger)' }}>
                          {esc(e.account_name || '?')} <span style={{fontSize:10,color:'var(--text-secondary)'}}>{e.currency || e.account_currency || ''}</span> {e.debit > 0 ? `借 ${e.debit}` : `贷 ${e.credit}`}
                        </div>
                      ))}
                    </td>
                    <td data-label="金额" style={{ fontSize: 12 }}>
                      {renderBalanceDiff(t.entries)}
                    </td>
                    <td data-label="操作">
                      <button className="btn btn-sm" onClick={() => openEdit(t)}>编辑</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 余额小计 */}
      {balances.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>💳 当前余额</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {balances.filter(b => b.account.type === 'asset' && b.account.is_active).map(b => (
              <div key={b.account.id} style={{
                background: '#f1f5f9', borderRadius: 8, padding: '8px 16px', textAlign: 'center', minWidth: 100,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{esc(b.account.name)} ({b.currency})</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: b.balance >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                  {b.balance.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 新建交易弹窗 */}
      {showForm && (
        <div className="modal-overlay active" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2 className="modal-title">{editId ? '编辑交易' : '新建交易'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">描述</label>
                  <input className="form-input" value={desc}
                    onInput={(e: Event) => setDesc((e.target as HTMLInputElement).value)}
                    placeholder="例: 买咖啡、发工资" required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">时间</label>
                  <input type="date" className="form-input" value={ts.slice(0,10)}
                    onInput={(e: Event) => setTs((e.target as HTMLInputElement).value)} />
                </div>
              </div>

              {/* 分录表 */}
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>分录 (至少一借一贷)</div>
              <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 8 }}>
                <table style={{ fontSize: 13 }}>
    <thead>
      <tr>
        <th style={{ width: 180 }}>账户</th>
        <th style={{ width: 60 }}>方向</th>
        <th style={{ width: 100 }}>金额</th>
        <th style={{ width: 70 }}>货币</th>
        <th>备注</th>
        <th style={{ width: 40 }}></th>
      </tr>
    </thead>
    <tbody>
      {entries.map((e, i) => {
        const selAccount = accounts.find(a => a.id === e.account_id);
        const currency = selAccount?.currency || '';
        return (
          <tr key={i}>
            <td>
              <select className="form-input" style={{ padding: '4px 8px', fontSize: 12 }}
                value={e.account_id}
                onChange={(ev: Event) => updateEntry(i, 'account_id', (ev.target as HTMLSelectElement).value)}>
                <option value="">-- 选择 --</option>
                <optgroup label="💳 资产">
                  {assetAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({balanceFor(a.id).toFixed(1)})</option>
                  ))}
                </optgroup>
                <optgroup label="💰 收入">
                  {incomeAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
                <optgroup label="📉 费用">
                  {expenseAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
              </select>
            </td>
            <td>
              <select className="form-input" style={{ padding: '4px 8px', fontSize: 12 }}
                value={e.side}
                onChange={(ev: Event) => updateEntry(i, 'side', (ev.target as HTMLSelectElement).value)}>
                <option value="debit">借</option>
                <option value="credit">贷</option>
              </select>
            </td>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="text" inputMode="decimal" className="form-input" style={{ padding: '4px 8px', fontSize: 12, flex: 1 }}
                  value={e.amountStr}
                  onInput={(ev: Event) => {
                    const val = (ev.target as HTMLInputElement).value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) updateEntry(i, 'amountStr', val);
                  }} />
              </div>
            </td>
            <td>
              <select className="form-input" style={{ padding: '4px 8px', fontSize: 12, width: '100%', minWidth: 60 }}
                value={e.currency}
                onChange={(ev: Event) => updateEntry(i, 'currency', (ev.target as HTMLSelectElement).value)}>
                <option value="">默认</option>
                <option value="CNY">CNY</option>
                <option value="USD">USD</option>
                <option value="USDT">USDT</option>
                <option value="ETH">ETH</option>
                <option value="BTC">BTC</option>
                <option value="HKD">HKD</option>
                <option value="JPY">JPY</option>
                <option value="EUR">EUR</option>
              </select>
            </td>
            <td>
              <input className="form-input" style={{ padding: '4px 8px', fontSize: 12 }}
                value={e.desc}
                onInput={(ev: Event) => updateEntry(i, 'desc', (ev.target as HTMLInputElement).value)} />
            </td>
            <td>
              {entries.length > 2 && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRow(i)}>✕</button>
              )}
            </td>
          </tr>
        );
      })}
                  </tbody>
                </table>
              </div>

              {/* 借贷平衡提示 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                <div>
                  借方: <strong style={{ color: 'var(--primary)' }}>{totalDebit().toFixed(2)}</strong>
                  {' | '}
                  贷方: <strong style={{ color: 'var(--danger)' }}>{totalCredit().toFixed(2)}</strong>
                  {' | '}
                  差额: <strong style={{ color: diff > 0.001 ? 'var(--danger)' : 'var(--success)' }}>
                    {diff > 0.001 ? diff.toFixed(2) : '✅ 平衡'}
                  </strong>
                </div>
                <button type="button" className="btn btn-sm" onClick={addRow}>+ 添加分录</button>
              </div>

              {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={diff > 0.001}>
                  保存交易
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** 展示交易对余额的净影响 */
function renderBalanceDiff(entries: (Entry & { account_name?: string; account_currency?: string })[]) {
  const netParts = entries
    .filter(e => e.account_name)
    .map(e => {
      const net = e.debit - e.credit;
      const dir = net > 0 ? '+' : '';
      return `${e.account_name}: ${dir}${net.toFixed(1)}`;
    });
  return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{netParts.join(', ')}</span>;
}

function esc(s: string): string {
  return s?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
}
