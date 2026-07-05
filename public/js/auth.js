// ============================================================
// garfield-ledger - 认证模块
// ============================================================

const auth = {
  /** 检查是否已登录 */
  isLoggedIn() {
    return !!api.getToken();
  },

  /** 显示登录页面 */
  showLogin() {
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('login-page').classList.add('active');
    document.getElementById('login-form').reset();
    document.getElementById('login-error').textContent = '';
  },

  /** 显示主应用 */
  showApp() {
    document.getElementById('app-shell').style.display = 'block';
    document.getElementById('login-page').classList.remove('active');
    document.getElementById('username-display').textContent = api.getUsername() || '用户';
  },

  /** 初始化登录表单 */
  init() {
    const loginForm = document.getElementById('login-form');
    const toggleBtn = document.getElementById('auth-toggle');
    let isRegister = false;

    toggleBtn.addEventListener('click', () => {
      isRegister = !isRegister;
      document.getElementById('login-title').textContent = isRegister ? '注册账号' : '登录';
      document.getElementById('login-subtitle').textContent = isRegister
        ? '创建一个新的记账账号' : '登录到你的记账账号';
      document.getElementById('login-submit').textContent = isRegister ? '注册' : '登录';
      toggleBtn.textContent = isRegister ? '已有账号？去登录' : '没有账号？去注册';
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');

      if (!username || !password) {
        errorEl.textContent = '请填写用户名和密码';
        return;
      }

      const submitBtn = document.getElementById('login-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = isRegister ? '注册中...' : '登录中...';
      errorEl.textContent = '';

      try {
        if (isRegister) {
          await api.register(username, password);
          // 注册成功后自动登录
          await api.login(username, password);
        } else {
          await api.login(username, password);
        }
        this.showApp();
        app.router.navigate('dashboard');
        toast.success('登录成功');
      } catch (err) {
        errorEl.textContent = err.message;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '注册' : '登录';
      }
    });

    // 退出登录
    document.getElementById('logout-btn').addEventListener('click', () => {
      api.logout();
      this.showLogin();
      toast.info('已退出登录');
    });
  },
};
