import { useState, useEffect } from 'preact/compat';
import { cacheClear } from '../cache';
import {
  getSettings, updateSettings, testSettings,
  getS3ConfigApi, updateS3ConfigApi,
  getAiConfigApi, updateAiConfigApi, testAiConnectionApi,
} from '../api';

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
  // S3 配置编辑
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3KeyId, setS3KeyId] = useState('');
  const [s3Secret, setS3Secret] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('auto');
  const [savingS3, setSavingS3] = useState(false);
  const [s3SaveResult, setS3SaveResult] = useState('');
  // AI 配置
  const [aiProvider, setAiProvider] = useState('openai');
  const [aiOpenaiKey, setAiOpenaiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiGeminiKey, setAiGeminiKey] = useState('');
  const [aiGeminiModel, setAiGeminiModel] = useState('');
  const [hasAiKey, setHasAiKey] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState('');
  const [showAiKey, setShowAiKey] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const d = await getSettings();
      setData(d);
      setBackupFolder(d.settings.backup_folder);
      setCacheEnabled(d.settings.cache_enabled);
      // 加载 S3 配置
      loadS3Config();
      loadAiConfig();
    } catch (err: unknown) {
      console.error('Settings load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadS3Config() {
    try {
      const s3 = await getS3ConfigApi();
      setS3Endpoint(s3.endpoint);
      setS3KeyId(s3.access_key_id);
      setS3Bucket(s3.bucket);
      setS3Region(s3.region);
    } catch { /* ignore */ }
  }

  async function handleSaveS3() {
    if (!s3Endpoint || !s3KeyId || !s3Bucket) {
      setS3SaveResult('⚠️ 请填写 Endpoint、Access Key ID 和 Bucket');
      return;
    }
    setSavingS3(true);
    setS3SaveResult('');
    try {
      const result = await updateS3ConfigApi({
        endpoint: s3Endpoint,
        access_key_id: s3KeyId,
        secret_access_key: s3Secret,
        region: s3Region,
        bucket: s3Bucket,
      });
      setS3SaveResult('✅ S3 配置已保存，下次请求生效');
      // 清空密码字段
      setS3Secret('');
      // 刷新测试
      handleTest();
    } catch (err: unknown) {
      setS3SaveResult('❌ ' + (err instanceof Error ? err.message : '保存失败'));
    } finally {
      setSavingS3(false);
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

  // ---- AI 配置 ----
  async function loadAiConfig() {
    try {
      const ai = await getAiConfigApi();
      setAiProvider(ai.ai_provider || 'openai');
      setAiOpenaiKey(ai.openai_api_key || '');
      setAiBaseUrl(ai.openai_base_url || '');
      setAiModel(ai.openai_model || '');
      setAiGeminiKey(ai.gemini_api_key || '');
      setAiGeminiModel(ai.gemini_model || '');
      setHasAiKey(!!(ai.openai_api_key || ai.gemini_api_key));
    } catch { /* env vars only */ }
  }

  async function handleSaveAi() {
    setSavingAi(true);
    setAiTestResult('');
    try {
      const data: Record<string, string> = { ai_provider: aiProvider };
      if (aiProvider === 'openai') {
        if (aiOpenaiKey) data.openai_api_key = aiOpenaiKey;
        if (aiBaseUrl) data.openai_base_url = aiBaseUrl;
        if (aiModel) data.openai_model = aiModel;
      } else {
        if (aiGeminiKey) data.gemini_api_key = aiGeminiKey;
        if (aiGeminiModel) data.gemini_model = aiGeminiModel;
      }
      await updateAiConfigApi(data);
      await loadAiConfig();
      setAiTestResult('✅ AI 配置已保存');
    } catch (err: unknown) {
      setAiTestResult('❌ ' + (err instanceof Error ? err.message : '保存失败'));
    } finally {
      setSavingAi(false);
    }
  }

  async function handleTestAi() {
    setTestingAi(true);
    setAiTestResult('');
    try {
      const result = await testAiConnectionApi();
      setAiTestResult(result.passed ? '✅ ' + result.reply : '⚠️ ' + result.reply);
    } catch (err: unknown) {
      setAiTestResult('❌ ' + (err instanceof Error ? err.message : '测试失败'));
    } finally {
      setTestingAi(false);
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

      {/* S3 配置编辑 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>✏️ 修改 S3 连接配置</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          修改后点击保存，下次请求自动使用新配置。首次部署需在环境变量中配置作为引导。
        </p>
        <div className="form-group">
          <label className="form-label">接入点 (Endpoint)</label>
          <input className="form-input" value={s3Endpoint}
            onInput={(e: Event) => setS3Endpoint((e.target as HTMLInputElement).value)}
            placeholder="https://s3.example.com" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Access Key ID</label>
            <input className="form-input" value={s3KeyId}
              onInput={(e: Event) => setS3KeyId((e.target as HTMLInputElement).value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Secret Access Key</label>
            <input className="form-input" type="password" value={s3Secret}
              onInput={(e: Event) => setS3Secret((e.target as HTMLInputElement).value)}
              placeholder="留空不修改" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">存储桶 (Bucket)</label>
            <input className="form-input" value={s3Bucket}
              onInput={(e: Event) => setS3Bucket((e.target as HTMLInputElement).value)} />
          </div>
          <div className="form-group">
            <label className="form-label">区域 (Region)</label>
            <input className="form-input" value={s3Region}
              onInput={(e: Event) => setS3Region((e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleSaveS3} disabled={savingS3}>
            {savingS3 ? '保存中...' : '💾 保存 S3 配置'}
          </button>
          {s3SaveResult && <span style={{ fontSize: 13 }}>{s3SaveResult}</span>}
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

      {/* AI 配置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>🤖 AI 服务配置</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          配置后可在页面直接修改，覆盖环境变量。API Key 仅前端展示末几位。
        </p>

        <div className="form-group">
          <label className="form-label">AI 提供商</label>
          <select className="form-input" value={aiProvider}
            onChange={(e: Event) => setAiProvider((e.target as HTMLSelectElement).value)}>
            <option value="openai">OpenAI 兼容</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>

        {aiProvider === 'openai' ? (
          <>
            <div className="form-group">
              <label className="form-label">API Key</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="form-input" type={showAiKey ? 'text' : 'password'} value={aiOpenaiKey}
                  onInput={(e: Event) => setAiOpenaiKey((e.target as HTMLInputElement).value)}
                  placeholder={hasAiKey ? '已配置，输入新值覆盖' : '必填'}
                  style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm" onClick={() => setShowAiKey(!showAiKey)}
                  style={{ minWidth: 40, fontSize: 16 }}>
                  {showAiKey ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Base URL</label>
              <input className="form-input" value={aiBaseUrl}
                onInput={(e: Event) => setAiBaseUrl((e.target as HTMLInputElement).value)}
                placeholder="https://api.openai.com/v1" />
            </div>
            <div className="form-group">
              <label className="form-label">模型</label>
              <input className="form-input" value={aiModel}
                onInput={(e: Event) => setAiModel((e.target as HTMLInputElement).value)}
                placeholder="gpt-4o-mini" />
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">API Key</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="form-input" type={showAiKey ? 'text' : 'password'} value={aiGeminiKey}
                  onInput={(e: Event) => setAiGeminiKey((e.target as HTMLInputElement).value)}
                  placeholder={hasAiKey ? '已配置，输入新值覆盖' : '必填'}
                  style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm" onClick={() => setShowAiKey(!showAiKey)}
                  style={{ minWidth: 40, fontSize: 16 }}>
                  {showAiKey ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">模型</label>
              <input className="form-input" value={aiGeminiModel}
                onInput={(e: Event) => setAiGeminiModel((e.target as HTMLInputElement).value)}
                placeholder="gemini-2.0-flash" />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button className="btn btn-sm" onClick={handleTestAi} disabled={testingAi}>
            {testingAi ? '⏳ 测试中...' : '🔍 测试 AI 连接'}
          </button>
          <button className="btn btn-primary" onClick={handleSaveAi} disabled={savingAi}>
            {savingAi ? '保存中...' : '💾 保存 AI 配置'}
          </button>
          {aiTestResult && (
            <span style={{ fontSize: 13, color: aiTestResult.includes('✅') ? 'var(--success)' : 'var(--danger)' }}>
              {aiTestResult}
            </span>
          )}
        </div>
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
