import { useState, useEffect } from 'preact/compat';
import { isLoggedIn, getUsername } from './api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import AccountsPage from './pages/AccountsPage';
import AiChatPage from './pages/AiChatPage';
import AiImportPage from './pages/AiImportPage';
import SettingsPage from './pages/SettingsPage';

type Page = 'dashboard' | 'txns' | 'accounts' | 'ai' | 'import' | 'settings';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');
  const [username, setUsernameState] = useState('');

  useEffect(() => {
    setLoggedIn(isLoggedIn());
    setUsernameState(getUsername());
  }, []);

  const handleLogin = () => {
    setLoggedIn(true);
    setUsernameState(getUsername());
  };

  const handleLogout = () => {
    localStorage.removeItem('ledger_token');
    localStorage.removeItem('ledger_username');
    setLoggedIn(false);
  };

  if (!loggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const tabs: { key: Page; label: string }[] = [
    { key: 'dashboard', label: '📊 概览' },
    { key: 'txns', label: '📒 记账' },
    { key: 'accounts', label: '💳 账户' },
    { key: 'ai', label: '🤖 AI 分析' },
    { key: 'import', label: '🧠 导入' },
    { key: 'settings', label: '⚙️ 设置' },
  ];

  return (
    <div>
      <nav className="navbar">
        <div className="navbar-inner">
          <span className="navbar-brand">📒 记账本</span>
          {tabs.map(t => (
            <a
              key={t.key}
              href="#"
              className={`nav-link${page === t.key ? ' active' : ''}`}
              onClick={(e: MouseEvent) => { e.preventDefault(); setPage(t.key); }}
            >
              {t.label}
            </a>
          ))}
          <div className="navbar-right">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{username}</span>
            <button className="btn btn-sm" onClick={handleLogout}>退出</button>
          </div>
        </div>
      </nav>

      <div className="container">
        {page === 'dashboard' && <DashboardPage />}
        {page === 'txns' && <TransactionsPage />}
        {page === 'accounts' && <AccountsPage />}
        {page === 'ai' && <AiChatPage />}
        {page === 'import' && <AiImportPage />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}
