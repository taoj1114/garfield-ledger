// ============================================================
// garfield-ledger 本地服务器
// 使用: npx tsx src/server.ts
// ============================================================

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

const PORT = parseInt(process.env.PORT || '3000');
console.log('🚀 Garfield Ledger Server');
console.log(`  端口: ${PORT}`);

// 统一错误处理
process.on('unhandledRejection', (err) => console.error('未捕获的 Promise 错误:', err));

async function main() {
  const mod = await import('./index');
  const app = mod.default as Hono;

  // 静态文件（在 API 路由之后，但优先级低，API 优先匹配）
  app.use('/*', serveStatic({ root: './dist' }));

  // API 404 友好提示
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ success: false, error: '接口不存在' }, 404);
    return c.html('Not Found', 404);
  });

  // 错误处理
  app.onError((err, c) => {
    console.error('⚠️', err.message);
    return c.json({ success: false, error: err.message }, 500);
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`✅ 启动成功: http://localhost:${PORT}`);
    console.log(`   API:  http://localhost:${PORT}/api/health`);
    console.log(`   前端: http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
