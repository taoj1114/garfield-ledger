// ============================================================
// garfield-ledger - 记账记录管理
// ============================================================

const records = {
  /** 渲染记录列表 */
  async render() {
    const container = document.getElementById('records-container');
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">加载中...</div></div>';

    try {
      const result = await api.getRecords({ limit: 200 });
      const recordsList = result.records || [];

      if (recordsList.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-text">还没有记账记录</div>
            <p class="stat-label" style="margin-top:12px">点击右上角「添加记录」开始记账</p>
          </div>`;
        return;
      }

      let html = `<div class="table-wrapper"><table>
        <thead><tr>
          <th>时间</th><th>来源</th><th>金额</th><th>分类</th><th>备注</th><th>操作</th>
        </tr></thead><tbody>`;

      for (const r of recordsList) {
        const date = new Date(r.timestamp).toLocaleDateString('zh-CN');
        html += `<tr>
          <td>${date}</td>
          <td>${esc(r.source)}</td>
          <td><strong>${r.amount}</strong> ${r.currency}</td>
          <td><span class="tag tag-category">${esc(r.category)}</span></td>
          <td>${esc(r.description || '-')}</td>
          <td>
            <button class="btn btn-sm" onclick="records.edit('${r.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="records.confirmDelete('${r.id}')">删除</button>
          </td>
        </tr>`;
      }

      html += '</tbody></table></div>';
      container.innerHTML = html;

      // 更新统计
      this.updateStats();

      // 更新分类筛选
      this.updateCategoryFilter();

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-text">加载失败: ${err.message}</div></div>`;
    }
  },

  /** 更新统计卡片 */
  async updateStats() {
    try {
      const stats = await api.getStats();
      document.getElementById('stat-total-records').textContent = stats.total_records;
      document.getElementById('stat-total-amount').textContent = stats.total_amount.toLocaleString();

      // 分类统计
      const catContainer = document.getElementById('stat-categories');
      const cats = Object.entries(stats.category_breakdown || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (cats.length > 0) {
        catContainer.innerHTML = cats.map(([cat, amount]) =>
          `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
            <span>${esc(cat)}</span>
            <span><strong>${amount.toLocaleString()}</strong></span>
          </div>`
        ).join('');
      }
    } catch (err) {
      console.error('Stats error:', err);
    }
  },

  /** 更新分类筛选下拉 */
  async updateCategoryFilter() {
    try {
      const categories = await api.getCategories();
      const select = document.getElementById('filter-category');
      select.innerHTML = '<option value="">全部分类</option>' +
        categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    } catch (err) {
      console.error('Categories error:', err);
    }
  },

  /** 打开添加弹窗 */
  showAddModal() {
    this.resetForm();
    document.getElementById('modal-title').textContent = '添加记录';
    document.getElementById('record-modal').classList.add('active');
    document.getElementById('record-id').value = '';
    // 默认当前时间
    document.getElementById('record-timestamp').value = new Date().toISOString().slice(0, 16);
  },

  /** 编辑记录 */
  async edit(id) {
    try {
      const record = await api.getRecord(id);
      document.getElementById('modal-title').textContent = '编辑记录';
      document.getElementById('record-id').value = record.id;
      document.getElementById('record-source').value = record.source;
      document.getElementById('record-amount').value = record.amount;
      document.getElementById('record-currency').value = record.currency;
      document.getElementById('record-category').value = record.category;
      document.getElementById('record-description').value = record.description || '';
      document.getElementById('record-timestamp').value = record.timestamp.slice(0, 16);
      document.getElementById('record-modal').classList.add('active');
    } catch (err) {
      toast.error('获取记录失败: ' + err.message);
    }
  },

  /** 确认删除 */
  async confirmDelete(id) {
    if (!confirm('确定要删除这条记录吗？')) return;
    try {
      await api.deleteRecord(id);
      toast.success('删除成功');
      this.render();
    } catch (err) {
      toast.error('删除失败: ' + err.message);
    }
  },

  /** 重置表单 */
  resetForm() {
    document.getElementById('record-source').value = '';
    document.getElementById('record-amount').value = '';
    document.getElementById('record-currency').value = 'CNY';
    document.getElementById('record-category').value = '其他';
    document.getElementById('record-description').value = '';
    document.getElementById('record-timestamp').value = '';
  },

  /** 提交表单 */
  async submit() {
    const id = document.getElementById('record-id').value;
    const data = {
      source: document.getElementById('record-source').value.trim(),
      amount: parseFloat(document.getElementById('record-amount').value),
      currency: document.getElementById('record-currency').value,
      category: document.getElementById('record-category').value,
      description: document.getElementById('record-description').value.trim(),
      timestamp: document.getElementById('record-timestamp').value
        ? new Date(document.getElementById('record-timestamp').value).toISOString()
        : new Date().toISOString(),
    };

    if (!data.source || isNaN(data.amount) || !data.currency) {
      toast.error('请填写来源和金额');
      return;
    }

    try {
      if (id) {
        await api.updateRecord(id, data);
        toast.success('更新成功');
      } else {
        await api.createRecord(data);
        toast.success('添加成功');
      }
      document.getElementById('record-modal').classList.remove('active');
      this.render();
    } catch (err) {
      toast.error('保存失败: ' + err.message);
    }
  },

  /** 应用筛选 */
  applyFilter() {
    this.render();
  },
};
