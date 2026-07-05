// ============================================================
// garfield-ledger - AI 分析助手
// ============================================================

const ai = {
  /** 渲染聊天界面 */
  async render() {
    const container = document.getElementById('ai-container');
    container.innerHTML = `
      <div class="chat-container">
        <div class="chat-messages" id="chat-messages">
          <div class="chat-message assistant">
            👋 你好！我是你的记账 AI 助手。我可以帮你分析消费趋势、各类支出占比、月度对比等。
            也可以回答关于你记账数据的任何问题，请问你想分析什么？
          </div>
        </div>
        <div class="chat-input-area">
          <input type="text" class="form-input" id="chat-input"
            placeholder="输入你的问题，例如：我这个月花了多少钱？" />
          <button class="btn btn-primary" id="chat-send">发送</button>
          <button class="btn btn-sm" id="chat-clear" title="清空聊天">🗑️</button>
        </div>
      </div>`;

    // 加载聊天历史
    await this.loadHistory();

    // 绑定事件
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    const sendMessage = () => this.send();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
    sendBtn.addEventListener('click', sendMessage);

    document.getElementById('chat-clear').addEventListener('click', async () => {
      if (!confirm('确定清空所有聊天记录？')) return;
      try {
        await api.clearChatHistory();
        document.getElementById('chat-messages').innerHTML = `
          <div class="chat-message assistant">👋 聊天记录已清空，有什么想问的吗？</div>`;
        toast.info('聊天记录已清空');
      } catch (err) {
        toast.error('清空失败: ' + err.message);
      }
    });
  },

  /** 加载聊天历史 */
  async loadHistory() {
    try {
      const messages = await api.getChatHistory();
      const container = document.getElementById('chat-messages');
      if (!container) return;

      if (messages.length === 0) return; // 保留默认欢迎消息

      container.innerHTML = messages.map(m =>
        `<div class="chat-message ${m.role}">${esc(m.content)}</div>`
      ).join('');

      this.scrollToBottom();
    } catch (err) {
      console.error('Load chat history error:', err);
    }
  },

  /** 发送消息 */
  async send() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const container = document.getElementById('chat-messages');

    // 添加用户消息
    container.innerHTML += `<div class="chat-message user">${esc(message)}</div>`;
    input.value = '';
    this.scrollToBottom();

    // 显示加载状态
    const loadingId = 'loading-msg';
    container.innerHTML += `<div class="chat-message assistant" id="${loadingId}">🤔 思考中...</div>`;
    this.scrollToBottom();

    try {
      const result = await api.aiChat(message);
      document.getElementById(loadingId)?.remove();
      container.innerHTML += `<div class="chat-message assistant">${esc(result.reply)}</div>`;
      this.scrollToBottom();
    } catch (err) {
      document.getElementById(loadingId)?.remove();
      container.innerHTML += `<div class="chat-message assistant" style="color:var(--danger)">❌ ${esc(err.message)}</div>`;
      this.scrollToBottom();
    }
  },

  /** 滚动到底部 */
  scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
      setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
    }
  },
};
