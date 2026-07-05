import { useState, useEffect } from 'preact/compat';
import { isLoggedIn, getUsername } from './api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AiChatPage from './pages/AiChatPage';

type Page = 'dashboard' | 'ai';

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
    { key: 'ai', label: '🤖 AI 分析' },
  ];

  return (
    <div>
      {/* 导航栏 */}
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

      {/* 页面 */}
      <div className="container">
        {page === 'dashboard' && <DashboardPage />}
        {page === 'ai' && <AiChatPage />}
      </div>
    </div>
  );
}
