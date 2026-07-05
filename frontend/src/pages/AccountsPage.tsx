import { useState, useEffect } from 'preact/compat';
import {
  getAccounts, createAccount, updateAccount, deleteAccount,
  type Account,
} from '../api';

const ACCOUNT_TYPES: { value: Account['type']; label: string }[] = [
  { value: 'asset', label: '💳 资产' },
  { value: 'income', label: '📈 收入' },
  { value: 'expense', label: '📉 费用' },
  { value: 'liability', label: '🏦 负债' },
];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', type: 'expense' as Account['type'], currency: 'CNY' });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setAccounts(await getAccounts());
    } catch (err: unknown) {
      alert('加载失败: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditId(null);
    setForm({ name: '', type: 'expense', currency: 'CNY' });
    setShowForm(true);
  }

  function openEdit(a: Account) {
    setEditId(a.id);
    setForm({ name: a.name, type: a.type, currency: a.currency });
    setShowForm(true);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editId) {
        await updateAccount(editId, form);
      } else {
        await createAccount(form);
      }
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      alert('保存失败: ' + (err instanceof Error ? err.message : ''));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此账户？已有交易不受影响但可能无法正确显示。')) return;
    try {
      await deleteAccount(id);
      await load();
    } catch (err: unknown) {
      alert('删除失败: ' + (err instanceof Error ? err.message : ''));
    }
  }

  const groups = [
    { type: 'asset' as const, label: '💳 资产账户', items: accounts.filter(a => a.type === 'asset') },
    { type: 'income' as const, label: '📈 收入账户', items: accounts.filter(a => a.type === 'income') },
    { type: 'expense' as const, label: '📉 费用账户', items: accounts.filter(a => a.type === 'expense') },
    { type: 'liability' as const, label: '🏦 负债账户', items: accounts.filter(a => a.type === 'liability') },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">💳 账户管理</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ 新建账户</button>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state-icon">📋</div><p>加载中...</p></div>
      ) : (
        groups.map(g => g.items.length > 0 ? (
          <div key={g.type} className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>{g.label}</h3>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>名称</th><th>货币</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {g.items.map(a => (
                    <tr key={a.id}>
                      <td data-label="名称">{esc(a.name)}</td>
                      <td data-label="货币">{a.currency}</td>
                      <td data-label="状态">{a.is_active ? '✅ 启用' : '⛔ 停用'}</td>
                      <td data-label="操作">
                        <button className="btn btn-sm" onClick={() => openEdit(a)}>编辑</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(a.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null)
      )}

      {/* 编辑弹窗 */}
      {showForm && (
        <div className="modal-overlay active" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">{editId ? '编辑账户' : '新建账户'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">账户名称</label>
                <input className="form-input" value={form.name}
                  onInput={(e: Event) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
                  placeholder="例: 现金、信用卡" required />
              </div>
              <div className="form-group">
                <label className="form-label">账户类型</label>
                <select className="form-input" value={form.type}
                  onChange={(e: Event) => setForm({ ...form, type: (e.target as HTMLSelectElement).value as Account['type'] })}>
                  {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">货币</label>
                <select className="form-input" value={form.currency}
                  onChange={(e: Event) => setForm({ ...form, currency: (e.target as HTMLSelectElement).value })}>
                  <option value="CNY">CNY - 人民币</option>
                  <option value="USD">USD - 美元</option>
                  <option value="USDT">USDT - 泰达币</option>
                  <option value="ETH">ETH - 以太坊</option>
                  <option value="BTC">BTC - 比特币</option>
                  <option value="HKD">HKD - 港币</option>
                  <option value="JPY">JPY - 日元</option>
                  <option value="EUR">EUR - 欧元</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>取消</button>
                <button type="submit" className="btn btn-primary">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function esc(s: string): string {
  return s?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
}
