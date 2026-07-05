import { useState, useEffect } from 'preact/compat';
import { cacheClear } from '../cache';
import { getSettings, updateSettings, testSettings, getBalances } from '../api';

interface SettingsData {
  s3: { endpoint: string; region: string; bucket: string; connected: boolean };
  settings: { backup_folder: string; cache_enabled: boolean; updated_at: string };
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const [backupFolder, setBackupFolder] = useState('backup');
  const [cacheEnabled, setCacheEnabled] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const d = await getSettings();
      setData(d);
      setBackupFolder(d.settings.backup_folder);
      setCacheEnabled(d.settings.cache_enabled);
    } catch (err: unknown) {
      console.error('Settings load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateSettings({
        backup_folder: backupFolder,
        cache_enabled: cacheEnabled,
      });
      setData(prev => prev ? { ...prev, settings: updated } : null);

      // 如果关闭了缓存，立即清空
      if (!cacheEnabled) cacheClear();

      alert('设置已保存');
    } catch (err: unknown) {
      alert('保存失败: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult('');
    try {
      const result = await testSettings();
      if (result.all_ok) {
        setTestResult(`✅ 全部通过！写入: ✅, 读取: ✅, 文件数: ${result.results.file_count || '?'}`);
      } else {
        const fails = Object.entries(result.results)
          .filter(([, v]) => v === false || v === undefined)
          .map(([k]) => k)
          .join(', ');
        setTestResult(`⚠️ 部分失败: ${fails}`);
      }
    } catch (err: unknown) {
      setTestResult('❌ 测试失败: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="card"><div className="empty-state-icon">⚙️</div><p>加载中...</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">⚙️ 系统设置</h1>
      </div>

      {/* S3 连接信息 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>🔗 S3 存储连接</h3>
        {data ? (
          <table style={{ fontSize: 14 }}>
            <tbody>
              <tr><td style={{ width: 120, color: 'var(--text-secondary)' }}>接入点</td><td><code>{data.s3.endpoint}</code></td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>存储桶</td><td><code>{data.s3.bucket}</code></td></tr>
              <tr><td style={{ color: 'var(--text-secondary)' }}>区域</td><td><code>{data.s3.region}</code></td></tr>
            </tbody>
          </table>
        ) : <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>无法加载配置</p>}

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={handleTest} disabled={testing}>
            {testing ? '⏳ 测试中...' : '🔍 测试连接'}
          </button>
          {testResult && (
            <span style={{ fontSize: 13 }}>{testResult}</span>
          )}
        </div>
      </div>

      {/* 备份设置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>📂 备份文件夹</h3>
        <div className="form-group">
          <label className="form-label">备份目录名称（在 S3 存储桶内）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <code style={{ padding: '10px 0', fontSize: 14 }}>{data?.s3.bucket || '?'}/</code>
            <input
              className="form-input"
              style={{ width: 200, fontFamily: 'monospace' }}
              value={backupFolder}
              onInput={(e: Event) => setBackupFolder((e.target as HTMLInputElement).value)}
              placeholder="backup"
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            未来备份功能会将数据快照导出到此目录
          </p>
        </div>
      </div>

      {/* 缓存设置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>⚡ 本地缓存</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <label className="form-label" style={{ margin: 0 }}>启用前端缓存</label>
          <label style={{ position: 'relative', display: 'inline-block', width: 48, height: 26, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cacheEnabled}
              onChange={(e: Event) => setCacheEnabled((e.target as HTMLInputElement).checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute', inset: 0, backgroundColor: cacheEnabled ? 'var(--primary)' : '#ccc',
              borderRadius: 26, transition: '0.3s',
            }}>
              <span style={{
                position: 'absolute', left: cacheEnabled ? 24 : 3, top: 3, width: 20, height: 20,
                borderRadius: '50%', backgroundColor: 'white', transition: '0.3s',
              }} />
            </span>
          </label>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {cacheEnabled ? '已启用（30秒有效期）' : '已关闭'}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          开启后，前端会缓存 API 响应 30 秒，减少网络请求，提高操作流畅度。
          缓存不足时会自动刷新，保证数据即时性。
        </p>
      </div>

      {/* 保存按钮 */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '💾 保存设置'}
        </button>
      </div>
    </div>
  );
}
