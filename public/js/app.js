// ============================================================
// garfield-ledger - 主应用 (路由 & 初始化)
// ============================================================

const app = {
  router: {
    /** 导航到指定页面 */
    navigate(page) {
      // 隐藏所有页面
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      // 显示目标页面
      const target = document.getElementById(`page-${page}`);
      if (target) target.classList.add('active');

      // 更新导航高亮
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      const navLink = document.querySelector(`.nav-link[data-page="${page}"]`);
      if (navLink) navLink.classList.add('active');

      // 渲染对应页面内容
      switch (page) {
        case 'dashboard':
          records.render();
          break;
        case 'ai':
          ai.render();
          break;
      }
    },
  },

  /** 初始化应用 */
  async init() {
    // 检查登录状态
    if (api.getToken()) {
      auth.showApp();
      this.router.navigate('dashboard');
    } else {
      auth.showLogin();
    }

    // 初始化认证
    auth.init();

    // 初始化导航栏
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        this.router.navigate(page);
      });
    });

    // 初始化模态框
    this.initModals();

    // 初始化导入导出
    this.initImportExport();
  },

  /** 初始化模态框 */
  initModals() {
    // 添加记录按钮
    document.getElementById('add-record-btn')?.addEventListener('click', () => {
      records.showAddModal();
    });

    // 关闭模态框
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    });

    // 取消按钮
    document.getElementById('modal-cancel')?.addEventListener('click', () => {
      document.getElementById('record-modal').classList.remove('active');
    });

    // 提交按钮
    document.getElementById('modal-submit')?.addEventListener('click', () => {
      records.submit();
    });
  },

  /** 初始化导入导出 */
  initImportExport() {
    // 导出 CSV
    document.getElementById('export-btn')?.addEventListener('click', async () => {
      try {
        const result = await api.getRecords({ limit: 10000 });
        const list = result.records || [];
        if (list.length === 0) {
          toast.info('没有可导出的记录');
          return;
        }

        const headers = '时间,来源,金额,货币,分类,备注';
        const rows = list.map(r =>
          `${r.timestamp},${r.source},${r.amount},${r.currency},${r.category},"${r.description}"`
        );
        const csv = '\uFEFF' + [headers, ...rows].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `记账数据_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`已导出 ${list.length} 条记录`);
      } catch (err) {
        toast.error('导出失败: ' + err.message);
      }
    });

    // 导入 CSV
    document.getElementById('import-btn')?.addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          toast.error('CSV 文件格式错误');
          return;
        }

        // 解析 CSV (简单解析)
        const records = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',');
          if (cols.length < 5) continue;
          const record = {
            source: cols[1]?.trim() || '',
            amount: parseFloat(cols[2]?.trim()) || 0,
            currency: cols[3]?.trim() || 'CNY',
            category: cols[4]?.trim() || '其他',
            description: cols[5]?.replace(/^"|"$/g, '').trim() || '',
            timestamp: cols[0]?.trim() || new Date().toISOString(),
          };
          if (record.source && record.amount) {
            records.push(record);
          }
        }

        if (records.length === 0) {
          toast.error('未找到有效记录');
          return;
        }

        const result = await api.importRecords(records);
        toast.success(`成功导入 ${result.imported} 条记录`);
        records.render();
      } catch (err) {
        toast.error('导入失败: ' + err.message);
      }

      e.target.value = '';
    });
  },
};

/**
 * Toast 通知
 */
const toast = {
  show(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  info(msg) { this.show(msg, 'info'); },
};

/**
 * HTML 转义
 */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => app.init());
