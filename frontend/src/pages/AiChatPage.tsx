import { useState, useEffect, useRef } from 'preact/compat';
import { aiChat, getChatHistory, clearChatHistory, type ChatMessage } from '../api';

export default function AiChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '👋 你好！我是你的记账 AI 助手。我可以帮你分析消费趋势、各类支出占比、月度对比等。请问你想分析什么？', timestamp: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadHistory() {
    try {
      const history = await getChatHistory();
      if (history.length > 0) {
        setMessages(history);
      }
    } catch { /* ignore */ }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await aiChat(text);
      const reply: ChatMessage = { role: 'assistant', content: result.reply, timestamp: new Date().toISOString() };
      setMessages(prev => [...prev, reply]);
    } catch (err: unknown) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ ' + (err instanceof Error ? err.message : '请求失败'),
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    if (!confirm('确定清空所有聊天记录？')) return;
    try {
      await clearChatHistory();
      setMessages([
        { role: 'assistant', content: '👋 聊天记录已清空，有什么想问的吗？', timestamp: new Date().toISOString() },
      ]);
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🤖 AI 分析助手</h1>
        <button className="btn btn-sm" onClick={handleClear}>🗑️ 清空记录</button>
      </div>

      <div className="chat-container">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              {esc(m.content)}
            </div>
          ))}
          {loading && (
            <div className="chat-message assistant">🤔 思考中...</div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="chat-input-area">
          <input
            type="text"
            className="form-input"
            placeholder="输入你的问题，例如：我这个月花了多少钱？"
            value={input}
            onInput={(e: Event) => setInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleSend(); }}
            disabled={loading}
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function esc(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
