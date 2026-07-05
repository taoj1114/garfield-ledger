# 📒 记账本 (garfield-ledger)

> 个人记账工具 — 数据存储在 S3 兼容存储，前端部署在 Cloudflare Workers，内置 AI 分析助手。

## ✨ 功能

- **记账管理** — 添加、编辑、删除每笔收支记录（来源、金额、货币、分类、时间、备注）
- **多币种支持** — 人民币、美元、加密货币等任意货币单位
- **数据概览** — 统计总记录数、总金额、分类 TOP 5
- **CSV 导入/导出** — 批量导入导出数据，方便迁移
- **AI 分析助手** — 接入 Gemini API，基于你的记账数据回答财务问题（消费趋势、分类占比、月度对比等）
- **账户密码登录** — 独立账户系统，JWT 认证
- **S3 持久化** — 所有数据存储在 S3 兼容对象存储（如 Garage、AWS S3、MinIO 等）

## 🏗 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Cloudflare Workers |
| **框架** | Hono (TypeScript) |
| **前端** | Vite + React (via preact/compat) |
| **存储** | S3 兼容对象存储 (Garage S3 / AWS S3 / MinIO) |
| **认证** | JWT (jose) + PBKDF2 密码哈希 |
| **AI** | Google Gemini API |
| **部署** | Wrangler CLI |

## 📁 项目结构

```
garfield-ledger/
├── frontend/              # Vite + React (via preact/compat)
│   ├── src/
│   │   ├── main.tsx       # 入口
│   │   ├── App.tsx        # 主应用 (路由 + 导航)
│   │   ├── api.ts         # API 客户端 + 类型
│   │   ├── style.css      # 全局样式
│   │   └── pages/
│   │       ├── LoginPage.tsx     # 登录/注册
│   │       ├── DashboardPage.tsx # 概览 + 记账管理
│   │       └── AiChatPage.tsx    # AI 分析聊天
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── dist/                  # Vite 构建输出 (自动生成)
├── src/                   # API Worker 源码
│   ├── index.ts           # 主入口 (Hono 路由)
│   ├── auth.ts            # 认证模块 (PBKDF2 + JWT)
│   ├── records.ts         # 记账记录 CRUD
│   ├── ai.ts              # AI 分析模块 (Gemini)
│   ├── s3.ts              # S3 存储客户端 (aws4fetch)
│   ├── middleware.ts      # JWT 认证中间件
│   └── types.ts           # 共享类型定义
├── wrangler.toml         # Cloudflare Workers 配置
├── package.json
├── tsconfig.json
└── .env.example          # 环境变量示例
```

## 🚀 部署指南

### 前置条件

1. [Node.js](https://nodejs.org/) 18+
2. [Cloudflare 账号](https://dash.cloudflare.com/)
3. S3 兼容存储（已有 Garage S3、AWS S3、MinIO 等）
4. Google Gemini API Key（[获取地址](https://aistudio.google.com/apikey)）

### 1. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .dev.vars

# 编辑 .dev.vars，填入实际值：
# S3_ENDPOINT - S3 兼容存储地址
# S3_ACCESS_KEY_ID - 访问密钥
# S3_SECRET_ACCESS_KEY - 密钥
# JWT_SECRET - JWT 签名密钥（随机长字符串）
# GEMINI_API_KEY - Gemini API Key
```

生产环境需要在 Cloudflare Dashboard → Workers & Pages → **garfield-ledger** → Settings → Variables 中设置上述环境变量。

### 2. 本地开发

```bash
# 安装根目录依赖 (Worker)
npm install

# 安装前端依赖
cd frontend && npm install && cd ..

# 启动开发服务器 (前端 + Worker)
npm run dev

# 访问 http://localhost:8787
```

### 3. 构建 & 部署

```bash
# 构建前端
npm run build:frontend

# 部署到 Cloudflare Workers
npm run deploy

# 部署后访问 https://garfield-ledger.<你的子域名>.workers.dev
```

### 4. 自定义域名 (可选)

在 Cloudflare Dashboard 中配置：
- Workers & Pages → garfield-ledger → Triggers → Custom Domain
- 添加你的域名，如 `ledger.yourdomain.com`

## 🔧 配置说明

### S3 存储结构

数据通过 S3 兼容存储持久化，每个用户的数据隔离存储：

```
garfield-ledger/
├── data/{username}/profile.json     # 用户信息（密码哈希等）
├── data/{userId}/records.json       # 记账记录数组
└── data/{userId}/chats.json         # AI 聊天历史
```

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `S3_ENDPOINT` | S3 兼容存储地址 | `https://s3.example.com` |
| `S3_ACCESS_KEY_ID` | S3 访问密钥 ID | `GK...` |
| `S3_SECRET_ACCESS_KEY` | S3 密钥 | `...` |
| `S3_REGION` | S3 区域 | `auto` 或 `us-east-1` |
| `S3_BUCKET` | S3 存储桶名 | `garfield-ledger` |
| `JWT_SECRET` | JWT 签名密钥 | 随机字符串（至少 32 位） |
| `GEMINI_API_KEY` | Gemini API 密钥 | `AIza...` |

## 📊 API 接口

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/auth/register` | 否 | 注册账号 |
| POST | `/api/auth/login` | 否 | 登录获取 Token |
| GET | `/api/health` | 否 | 健康检查 |
| GET | `/api/records` | 是 | 获取记录列表 |
| POST | `/api/records` | 是 | 添加记录 |
| GET | `/api/records/:id` | 是 | 获取单条记录 |
| PUT | `/api/records/:id` | 是 | 更新记录 |
| DELETE | `/api/records/:id` | 是 | 删除记录 |
| POST | `/api/records/import` | 是 | 批量导入 |
| GET | `/api/stats` | 是 | 获取统计数据 |
| GET | `/api/categories` | 是 | 获取分类列表 |
| POST | `/api/ai/chat` | 是 | AI 对话 |
| GET | `/api/ai/history` | 是 | 获取 AI 聊天历史 |
| DELETE | `/api/ai/history` | 是 | 清空聊天历史 |

## 🔐 安全说明

- 密码使用 PBKDF2-SHA256 加盐哈希（10 万次迭代）
- JWT Token 有效期 7 天
- 所有 API（除登录注册外）需 Bearer Token 认证
- 用户数据按 userId 隔离存储在 S3

## 📝 License

MIT
