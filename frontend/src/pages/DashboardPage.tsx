import { useState, useEffect, useRef } from 'preact/compat';
import {
  getRecords, createRecord, updateRecord, deleteRecord,
  getStats, getCategories, importRecords, exportCsv, parseCsv,
  type LedgerRecord, type StatsData,
} from '../api';

export default function DashboardPage() {
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [filterCat, setFilterCat] = useState('');
  const [loading, setLoading] = useState(true);

  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [r, s, c] = await Promise.all([
        getRecords({ limit: '500' }),
        getStats(),
        getCategories(),
      ]);
      setRecords(r.records);
      setStats(s);
      setCategories(c);
    } catch (err: unknown) {
      alert('加载失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  }

  // ---- 新增/编辑 ----
  function openAdd() {
    setEditId(null);
    formRef.current?.reset();
    // 默认时间
    const now = new Date().toISOString().slice(0, 16);
    const tsInput = formRef.current?.querySelector('[name="timestamp"]') as HTMLInputElement;
    if (tsInput) tsInput.value = now;
    setModalOpen(true);
  }

  async function openEdit(id: string) {
    try {
      const r = records.find(x => x.id === id);
      if (!r) return;
      setEditId(id);
      const form = formRef.current!;
      (form.querySelector('[name="source"]') as HTMLInputElement).value = r.source;
      (form.querySelector('[name="amount"]') as HTMLInputElement).value = String(r.amount);
      (form.querySelector('[name="currency"]') as HTMLSelectElement).value = r.currency;
      (form.querySelector('[name="category"]') as HTMLSelectElement).value = r.category;
      (form.querySelector('[name="description"]') as HTMLInputElement).value = r.description;
      (form.querySelector('[name="timestamp"]') as HTMLInputElement).value = r.timestamp.slice(0, 16);
      setModalOpen(true);
    } catch (err: unknown) {
      alert('获取记录失败: ' + (err instanceof Error ? err.message : ''));
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    const data = {
      source: fd.get('source') as string,
      amount: parseFloat(fd.get('amount') as string),
      currency: fd.get('currency') as string,
      category: fd.get('category') as string,
      description: (fd.get('description') as string) || '',
      timestamp: new Date((fd.get('timestamp') as string) || Date.now()).toISOString(),
    };
    if (!data.source || isNaN(data.amount)) return alert('请填写来源和金额');

    try {
      if (editId) {
        await updateRecord(editId, data);
      } else {
        await createRecord(data);
      }
      setModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      alert('保存失败: ' + (err instanceof Error ? err.message : ''));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除这条记录？')) return;
    try {
      await deleteRecord(id);
      await loadData();
    } catch (err: unknown) {
      alert('删除失败: ' + (err instanceof Error ? err.message : ''));
    }
  }

  // ---- 导入/导出 ----
  function handleExport() {
    const filtered = records.filter(r => !filterCat || r.category === filterCat);
    exportCsv(filtered);
  }

  async function handleImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) return alert('未找到有效记录');
      const result = await importRecords(parsed);
      await loadData();
      alert(`成功导入 ${result.imported} 条记录`);
    } catch (err: unknown) {
      alert('导入失败: ' + (err instanceof Error ? err.message : ''));
    }
    (e.target as HTMLInputElement).value = '';
  }

  // ---- 筛选 ----
  const filtered = records.filter(r => !filterCat || r.category === filterCat);

  // ---- 分类统计 (前端展示) ----
  const catAmounts: Record<string, number> = {};
  for (const r of records) {
    const c = r.category || '其他';
    catAmounts[c] = (catAmounts[c] || 0) + r.amount;
  }
  const topCats = Object.entries(catAmounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div>
      {/* 页头 */}
      <div className="page-header">
        <h1 className="page-title">📊 财务概览</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>📥 导入</button>
          <input ref={fileRef} type="file" accept=".csv" className="import-hidden" onChange={handleImport} />
          <button className="btn btn-sm" onClick={handleExport}>📤 导出</button>
          <button className="btn btn-primary" onClick={openAdd}>+ 添加记录</button>
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total_records}</div>
            <div className="stat-label">总记录数</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.total_amount.toLocaleString()}</div>
            <div className="stat-label">总金额</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ fontSize: 16, fontWeight: 600 }}>
              {topCats.length > 0 ? topCats.map(([cat, amt]) => (
                <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span>{cat}</span>
                  <span><strong>{amt.toLocaleString()}</strong></span>
                </div>
              )) : <span style={{ fontSize: 13, fontWeight: 400 }}>暂无数据</span>}
            </div>
            <div className="stat-label">分类 TOP 5</div>
          </div>
        </div>
      )}

      {/* 筛选工具栏 */}
      <div className="toolbar">
        <select
          className="form-input"
          style={{ width: 'auto' }}
          value={filterCat}
          onChange={(e: Event) => setFilterCat((e.target as HTMLSelectElement).value)}
        >
          <option value="">全部分类</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          共 {filtered.length} 条
        </span>
      </div>

      {/* 记录列表 */}
      <div className="card">
        {loading ? (
          <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-text">加载中...</div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-text">还没有记账记录</div>
            <p className="stat-label" style={{ marginTop: 12 }}>点击右上角「添加记录」开始记账</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>时间</th><th>来源</th><th>金额</th><th>分类</th><th>备注</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.timestamp).toLocaleDateString('zh-CN')}</td>
                    <td>{esc(r.source)}</td>
                    <td><strong>{r.amount}</strong> {r.currency}</td>
                    <td><span className="tag tag-category">{esc(r.category)}</span></td>
                    <td>{esc(r.description) || '-'}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => openEdit(r.id)}>编辑</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 编辑模态框 */}
      {modalOpen && (
        <div className="modal-overlay active" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">{editId ? '编辑记录' : '添加记录'}</h2>
            <form ref={formRef} onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">来源 *</label>
                  <input name="source" type="text" className="form-input" placeholder="例: 工资、买菜" required />
                </div>
                <div className="form-group">
                  <label className="form-label">金额 *</label>
                  <input name="amount" type="number" className="form-input" step="0.01" placeholder="0.00" required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">货币</label>
                  <select name="currency" className="form-input">
                    <option value="CNY">CNY - 人民币</option>
                    <option value="USD">USD - 美元</option>
                    <option value="ETH">ETH - 以太坊</option>
                    <option value="BTC">BTC - 比特币</option>
                    <option value="USDT">USDT - 泰达币</option>
                    <option value="HKD">HKD - 港币</option>
                    <option value="JPY">JPY - 日元</option>
                    <option value="EUR">EUR - 欧元</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">分类</label>
                  <select name="category" className="form-input">
                    <option value="餐饮">🍜 餐饮</option>
                    <option value="交通">🚗 交通</option>
                    <option value="购物">🛒 购物</option>
                    <option value="居住">🏠 居住</option>
                    <option value="工资">💼 工资</option>
                    <option value="投资">📈 投资</option>
                    <option value="医疗">🏥 医疗</option>
                    <option value="娱乐">🎮 娱乐</option>
                    <option value="教育">📚 教育</option>
                    <option value="其他">📦 其他</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">备注</label>
                <input name="description" type="text" className="form-input" placeholder="可选备注" />
              </div>
              <div className="form-group">
                <label className="form-label">时间</label>
                <input name="timestamp" type="datetime-local" className="form-input" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setModalOpen(false)}>取消</button>
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
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
