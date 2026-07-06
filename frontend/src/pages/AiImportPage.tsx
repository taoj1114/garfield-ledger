import { useState, useRef } from 'preact/compat';
import { analyzeImport, getAccounts, createTransaction } from '../api';

interface AnalysisRecord {
  source: string;
  amount: number;
  currency: string;
  category: string;
  description?: string;
  timestamp: string;
}

interface AnalysisResult {
  source_type: string;
  total: number;
  records: AnalysisRecord[];
  description: string;
}

export default function AiImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>('');

  async function handleAnalyze() {
    if (!rawText.trim()) return;
    setAnalyzing(true);
    setError('');
    setResult(null);
    setImportResult('');

    try {
      const data = await analyzeImport(rawText);
      setResult(data as unknown as AnalysisResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleImport() {
    if (!result?.records.length) return;
    setImporting(true);
    setImportResult('');

    try {
      const accounts = await getAccounts();
      const cashAccount = accounts.find(a => a.name === '现金') || accounts.find(a => a.type === 'asset');
      if (!cashAccount) throw new Error('未找到资产账户，请先在「账户」页面创建');

      // 收入/费用分类名 → 账户名映射
      const incomeMap: Record<string, string> = {
        '工资': '工资收入', '投资': '投资收益',
      };
      const expenseMap: Record<string, string> = {
        '餐饮': '餐饮费用', '交通': '交通费用', '购物': '购物支出',
        '居住': '居住支出', '医疗': '医疗支出', '娱乐': '娱乐支出',
        '教育': '教育支出',
      };

      let imported = 0;
      for (const r of result.records) {
        const isIncome = incomeMap[r.category] !== undefined;
        const targetName = isIncome ? (incomeMap[r.category] || '其他收入') : (expenseMap[r.category] || '其他支出');
        const targetAccount = accounts.find(a => a.name === targetName);
        if (!targetAccount) continue;

        const absAmt = Math.abs(r.amount);
        await createTransaction({
          description: r.source,
          timestamp: r.timestamp || new Date().toISOString(),
          entries: isIncome ? [
            { account_id: cashAccount.id, debit: absAmt, credit: 0 },
            { account_id: targetAccount.id, debit: 0, credit: absAmt },
          ] : [
            { account_id: targetAccount.id, debit: absAmt, credit: 0 },
            { account_id: cashAccount.id, debit: 0, credit: absAmt },
          ],
        });
        imported++;
      }

      setImportResult(`✅ 成功导入 ${imported} 笔交易`);
      setResult(null);
      setRawText('');
    } catch (err: unknown) {
      setImportResult('❌ 导入失败: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setImporting(false);
    }
  }

  function handleClear() {
    setRawText('');
    setResult(null);
    setError('');
    setImportResult('');
  }

  // 示例数据
  const examples = [
    {
      label: '微信账单',
      text: `2024-01-15 美团外卖 35.50 餐饮
2024-01-16 滴滴出行 28.00 交通
2024-01-17 星巴克 42.00 餐饮
2024-01-18 京东购物 299.00 购物`,
    },
    {
      label: '支付宝流水',
      text: `1/15 早餐店 -12.00
1/15 地铁 -5.00
1/16 淘宝 -168.00
1/17 工资 +15000.00`,
    },
    {
      label: '自然语言',
      text: `昨天中午吃饭花了38块，下午打车回家25块，
晚上在京东买了个鼠标99块，
今天早上地铁充了50块。`,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🧠 AI 智能导入</h1>
        <button className="btn btn-sm" onClick={handleClear}>清空</button>
      </div>

      <div className="card">
        <p style={{ marginBottom: 16, color: 'var(--text-secondary)', fontSize: 14 }}>
          粘贴任意格式的账单数据（银行流水、微信/支付宝账单、CSV、自然语言描述等），
          AI 会自动识别并解析为结构化记账记录。
        </p>

        {/* 示例快捷入口 */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '6px 0' }}>试试示例：</span>
          {examples.map(ex => (
            <button
              key={ex.label}
              className="btn btn-sm"
              onClick={() => setRawText(ex.text)}
            >
              {ex.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e: unknown) => {
              const el = (e as Event).target as HTMLInputElement;
              const f = el.files?.[0];
              if (!f) return;
              const ext = f.name.split('.').pop()?.toLowerCase();
              if (ext === 'xlsx' || ext === 'xls') {
                import('xlsx').then(mod => {
                  const XLSX = mod.default || mod;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const wb = XLSX.read(reader.result as ArrayBuffer, { type: 'array' });
                    let text = '';
                    wb.SheetNames.forEach((name: string) => {
                      const ws = wb.Sheets[name];
                      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
                      if (csv.trim()) text += `=== ${name} ===\n${csv}\n`;
                    });
                    setRawText(text);
                    el.value = '';
                  };
                  reader.readAsArrayBuffer(f);
                });
              } else {
                const reader = new FileReader();
                reader.onload = () => {
                  setRawText(reader.result as string);
                  el.value = '';
                };
                reader.readAsText(f, 'UTF-8');
              }
            }} />
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
            📁 上传文件
          </button>
        </div>

        {/* 文本输入 */}
        <textarea
          className="form-input"
          style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
          placeholder={`粘贴数据在这里...\n\n支持的格式：\n• 银行/支付宝/微信账单文本\n• CSV / TSV 原始数据\n• JSON 数组\n• 自然语言描述\n• 任意混合格式`}
          value={rawText}
          onInput={(e: Event) => setRawText((e.target as HTMLTextAreaElement).value)}
        />

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={analyzing || !rawText.trim()}
          >
            {analyzing ? '🤔 AI 分析中...' : '🔍 AI 识别数据'}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>❌ {error}</p>
        </div>
      )}

      {/* 分析结果 */}
      {result && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>
                📋 识别结果 — {result.source_type}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {result.description}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="stat-value" style={{ fontSize: 24 }}>
                {result.records.length}
              </div>
              <div className="stat-label">条记录</div>
            </div>
          </div>

          {/* 记录预览表格 */}
          {result.records.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>来源</th>
                    <th>金额</th>
                    <th>货币</th>
                    <th>分类</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12 }}>{r.timestamp?.slice(0, 10) || '?'}</td>
                      <td>{esc(r.source)}</td>
                      <td><strong>{r.amount}</strong></td>
                      <td>{r.currency}</td>
                      <td><span className="tag tag-category">{esc(r.category)}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {esc(r.description || '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>AI 未解析出有效记录</p>
          )}

          {/* 导入按钮 */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={importing || result.records.length === 0}
            >
              {importing ? '导入中...' : `📥 导入 ${result.records.length} 条记录`}
            </button>
            <button className="btn" onClick={handleClear}>重新输入</button>
          </div>

          {importResult && (
            <p style={{ marginTop: 12, fontSize: 14, fontWeight: 500 }}>{importResult}</p>
          )}
        </div>
      )}
    </div>
  );
}

function esc(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
