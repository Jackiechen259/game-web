# Web 游戏导航站完整实现计划

> 本文档用于交给 Codex 直接实施。  
> 目标是构建一个支持从 GitHub 游戏库同步游戏、带后台管理、草稿、发布、预览、部署状态和回滚能力的 Web 游戏门户。

---

## 1. 项目目标

实现一个可持续扩展的 Web 游戏平台，满足以下要求：

1. 公开门户用于展示、搜索、分类和运行 Web 游戏。
2. 每个游戏独立开发、独立构建、独立发布。
3. 游戏代码不直接写入门户业务组件。
4. 游戏从独立 GitHub 游戏库获取。
5. 门户构建时同步已经编译好的静态游戏文件。
6. 浏览器运行时不直接访问 GitHub API。
7. 新增游戏时原则上不需要修改门户源码。
8. 游戏通过 `iframe` 运行，与门户样式和运行环境隔离。
9. 提供受保护的 `/admin` 后台管理系统。
10. 后台可以新增、编辑、归档、预览和发布游戏配置。
11. 后台不直接编辑生成后的 `dist` 分支。
12. 后台所有 GitHub 写操作由服务端完成。
13. GitHub App 私钥、Token 和其他秘密不得进入浏览器。
14. 发布默认通过 Pull Request、GitHub Actions 和重新部署完成。
15. 保留完整版本历史、审计日志、冲突检测和回滚能力。
16. 公开门户最终仍可作为静态网站部署。

---

## 2. 核心设计原则

### 2.1 门户与游戏分离

公开门户只负责：

- 首页
- 游戏列表
- 分类
- 搜索
- 游戏详情
- 游戏加载器
- 全屏、重启、静音等公共控制
- 游戏通信 SDK
- 本地游戏清单读取

具体游戏保持独立，能够脱离门户单独运行。

### 2.2 构建时同步，而不是运行时拉取

门户在构建之前从 GitHub 游戏库同步：

- `catalog.json`
- 游戏封面
- 已构建的 HTML、JavaScript、CSS、图片、音频等静态资源

浏览器只访问门户部署产物中的本地路径，例如：

```text
/game-catalog.json
/games/snake/index.html
```

禁止在浏览器中直接请求 GitHub API。

### 2.3 后台只修改源配置

后台修改：

```text
catalog/games/*.json
catalog/settings.json
```

CI 负责：

1. 验证源配置
2. 构建游戏
3. 汇总清单
4. 生成 `dist`
5. 触发门户重新构建

后台不得直接修改：

```text
dist/catalog.json
dist/games/*
```

### 2.4 GitHub 是发布内容的事实来源

GitHub 游戏库保存：

- 游戏配置
- 游戏源码
- 游戏构建配置
- 发布历史
- Pull Request
- 构建结果
- `dist` 发布分支

数据库只保存后台运行状态，例如：

- 管理员账号
- 会话
- 审计日志
- 发布任务
- 部署任务
- 预览 Token

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────┐
│              Public Game Portal              │
│ 首页 / 游戏列表 / 分类 / 搜索 / 游戏运行页   │
└──────────────────────┬───────────────────────┘
                       │ 读取本地静态清单
                       ▼
┌──────────────────────────────────────────────┐
│             Published Game Assets            │
│ game-catalog.json + games/*                   │
└──────────────────────────────────────────────┘


┌──────────────────────────────────────────────┐
│                Admin Frontend                │
│ /admin                                       │
│ 游戏管理 / 草稿 / 预览 / 发布 / 回滚         │
└──────────────────────┬───────────────────────┘
                       │ HTTPS + authenticated API
                       ▼
┌──────────────────────────────────────────────┐
│                Admin API                     │
│ 身份验证 / 权限 / Schema / GitHub / 审计     │
└──────────────────────┬───────────────────────┘
                       │ GitHub App
                       ▼
┌──────────────────────────────────────────────┐
│          GitHub Web Games Library Repo       │
│ main: 源配置和源码                           │
│ admin/drafts: 草稿                           │
│ dist: 已构建发布结果                         │
└──────────────────────┬───────────────────────┘
                       │ repository_dispatch
                       ▼
┌──────────────────────────────────────────────┐
│             Portal Build & Deployment        │
│ 同步游戏 → 验证 → 测试 → 构建 → 部署         │
└──────────────────────────────────────────────┘
```

---

## 4. 仓库划分

至少使用两个仓库。

### 4.1 门户仓库

示例：

```text
game-portal
```

负责：

- 公开门户
- 管理后台前端
- 管理 API
- GitHub 游戏同步脚本
- 游戏清单读取
- iframe 游戏容器
- 管理员认证
- 发布和部署状态展示
- 审计日志

### 4.2 游戏库仓库

示例：

```text
web-games-library
```

负责：

- 游戏源码
- 游戏元数据
- 站点内容配置
- 游戏构建
- 清单生成
- `dist` 发布分支
- 触发门户重新部署

门户不得执行远程游戏仓库中的任意安装脚本或源码。

门户只消费游戏库的构建结果。

---

## 5. 推荐技术栈

根据现有项目进行适配，不要无理由重写。

### 5.1 门户是 React + Vite 时

推荐：

```text
apps/
├── portal/       React + Vite 公开门户
├── admin/        React + Vite 管理后台
└── admin-api/    Node.js API 或 Serverless Functions
```

也可以将公开门户和后台前端放在同一个 React 应用中：

```text
/                 公开门户
/admin            管理后台
/api/admin/*      独立服务端 API
```

### 5.2 现有项目是全栈框架时

如果当前项目使用 Next.js、Nuxt、SvelteKit 等：

```text
同一项目
├── 公开门户
├── /admin
└── /api/admin/*
```

### 5.3 推荐基础技术

```text
前端：React + TypeScript
构建：Vite
包管理：pnpm workspace
后台 API：Node.js / Serverless
Schema：Zod、JSON Schema 或同类方案
数据库：PostgreSQL、SQLite 或托管数据库
GitHub 集成：GitHub App
游戏运行：iframe
游戏通信：window.postMessage
```

---

## 6. 建议目录结构

如果采用 monorepo：

```text
game-platform/
├── apps/
│   ├── portal/
│   │   ├── src/
│   │   └── public/
│   │
│   ├── admin/
│   │   └── src/
│   │       ├── components/
│   │       ├── pages/
│   │       ├── forms/
│   │       ├── hooks/
│   │       └── api/
│   │
│   └── admin-api/
│       └── src/
│           ├── routes/
│           ├── auth/
│           ├── github/
│           ├── publishing/
│           ├── validation/
│           ├── audit/
│           └── database/
│
├── packages/
│   ├── game-schema/
│   ├── game-sdk/
│   ├── admin-types/
│   └── shared-ui/
│
├── scripts/
│   ├── sync-games.mjs
│   └── validate-game-catalog.mjs
│
├── tests/
├── docs/
└── pnpm-workspace.yaml
```

如果当前仓库不是 monorepo，不要强制重构全部代码，可以使用：

```text
src/
├── public-portal/
├── admin/
├── server/
└── shared/
```

---

## 7. 游戏库源码结构

推荐：

```text
web-games-library/
├── catalog/
│   ├── settings.json
│   └── games/
│       ├── snake.json
│       ├── tetris.json
│       └── platformer.json
│
├── games/
│   ├── snake/
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── tetris/
│   └── platformer/
│
├── packages/
│   └── game-sdk/
│
├── scripts/
│   ├── build-all-games.mjs
│   └── generate-catalog.mjs
│
├── package.json
└── pnpm-workspace.yaml
```

---

## 8. 游戏库发布结构

`dist` 分支或发布目录必须是可直接托管的静态结果：

```text
dist/
├── catalog.json
├── settings.json
└── games/
    ├── snake/
    │   ├── index.html
    │   ├── cover.webp
    │   └── assets/
    │       ├── index.js
    │       ├── index.css
    │       └── ...
    │
    ├── tetris/
    └── platformer/
```

直接访问以下路径时游戏必须可以运行：

```text
games/snake/index.html
```

Vite 游戏项目必须使用相对资源路径：

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "./"
});
```

发布结果中不得包含：

- `.env`
- GitHub 凭据
- 开发依赖
- 未使用源码
- 本地绝对路径
- 调试密钥
- 用户私人文件

---

## 9. 游戏配置格式

每个游戏使用独立配置文件：

```text
catalog/games/<game-id>.json
```

示例：

```json
{
  "schemaVersion": 1,
  "id": "snake",
  "title": "贪吃蛇",
  "description": "经典贪吃蛇小游戏",
  "version": "1.0.0",
  "status": "published",
  "featured": true,
  "entry": "games/snake/index.html",
  "cover": "games/snake/cover.webp",
  "categories": ["休闲"],
  "tags": ["单人", "键盘"],
  "controls": [
    "使用方向键控制移动",
    "按 P 暂停游戏"
  ],
  "aspectRatio": "16/9",
  "displayOrder": 100,
  "minimumPortalSdkVersion": "1.0.0",
  "seo": {
    "title": "在线贪吃蛇游戏",
    "description": "在浏览器中游玩经典贪吃蛇。"
  },
  "iframe": {
    "allow": [
      "fullscreen",
      "autoplay",
      "gamepad"
    ],
    "sandbox": [
      "allow-scripts",
      "allow-same-origin",
      "allow-pointer-lock"
    ]
  },
  "createdAt": "2026-07-01",
  "updatedAt": "2026-07-15",
  "changelog": [
    {
      "version": "1.0.0",
      "date": "2026-07-15",
      "changes": [
        "首次发布"
      ]
    }
  ]
}
```

---

## 10. 汇总清单格式

游戏库 CI 根据所有独立配置生成：

```text
dist/catalog.json
```

示例：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-15T00:00:00Z",
  "games": [
    {
      "id": "snake",
      "title": "贪吃蛇",
      "description": "经典贪吃蛇小游戏",
      "version": "1.0.0",
      "entry": "games/snake/index.html",
      "cover": "games/snake/cover.webp",
      "categories": ["休闲"],
      "tags": ["单人", "键盘"],
      "status": "published",
      "featured": true,
      "controls": [
        "使用方向键控制移动"
      ],
      "aspectRatio": "16/9",
      "createdAt": "2026-07-01",
      "updatedAt": "2026-07-15"
    }
  ]
}
```

TypeScript 类型：

```ts
export type GameStatus =
  | "development"
  | "beta"
  | "published"
  | "archived";

export interface GameMetadata {
  id: string;
  title: string;
  description: string;
  version: string;
  entry: string;
  cover: string;
  categories: string[];
  tags: string[];
  status: GameStatus;
  featured?: boolean;
  controls?: string[];
  aspectRatio?: `${number}/${number}`;
  displayOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameCatalog {
  schemaVersion: number;
  generatedAt: string;
  games: GameMetadata[];
}
```

公开门户默认只显示：

```text
published
beta
```

`development` 和 `archived` 不显示在公开游戏列表中。

---

## 11. 站点级配置

保存到：

```text
catalog/settings.json
```

示例：

```json
{
  "schemaVersion": 1,
  "siteName": "Bohan's Web Games",
  "siteDescription": "Small browser games made by Bohan",
  "defaultLanguage": "zh-CN",
  "gamesPerPage": 24,
  "showBetaGames": true,
  "showArchivedGamePages": true,
  "enableSearch": true,
  "enableCategories": true,
  "enableRecentlyPlayed": true,
  "enableFullscreen": true,
  "enableGamepad": true,
  "maintenanceMode": false,
  "featuredGameIds": [
    "snake",
    "tetris"
  ],
  "navigation": [
    {
      "label": "首页",
      "path": "/"
    },
    {
      "label": "全部游戏",
      "path": "/games"
    }
  ]
}
```

后台允许修改非秘密配置。

后台不得修改：

- GitHub App 私钥
- GitHub Token
- OAuth Client Secret
- Session Secret
- 数据库连接字符串
- 生产仓库地址
- GitHub Actions YAML
- 任意构建命令
- 允许访问的本地系统目录

---

## 12. 共享 Schema

创建：

```text
packages/game-schema/
├── src/
│   ├── game.ts
│   ├── catalog.ts
│   ├── settings.ts
│   ├── validation.ts
│   └── errors.ts
└── package.json
```

共享给：

- 管理后台表单
- Admin API
- 游戏库构建脚本
- 门户同步脚本
- 测试

不要为后台、CI 和门户分别维护三套不同验证逻辑。

---

## 13. 门户同步脚本

创建：

```text
scripts/sync-games.mjs
```

### 13.1 环境变量

```env
GAMES_REPO=owner/web-games-library
GAMES_REF=dist
GAMES_CATALOG_PATH=catalog.json
GAMES_SYNC_ENABLED=true
GAMES_LOCAL_PATH=
GAMES_MAX_ARCHIVE_SIZE_MB=500
GAMES_ALLOW_STALE_CACHE=false
GITHUB_TOKEN=
```

说明：

- `GAMES_REPO`：GitHub 仓库，格式为 `owner/repository`
- `GAMES_REF`：分支、标签或 commit
- `GAMES_CATALOG_PATH`：清单路径
- `GAMES_LOCAL_PATH`：本地调试时使用
- `GITHUB_TOKEN`：私有仓库或限流时使用
- `GAMES_MAX_ARCHIVE_SIZE_MB`：最大压缩包大小
- `GAMES_ALLOW_STALE_CACHE`：远程失败时是否允许旧缓存

任何秘密变量都不得使用 `VITE_` 前缀。

### 13.2 同步流程

同步脚本必须：

1. 读取并验证环境变量。
2. 创建 staging 临时目录。
3. 优先支持 `GAMES_LOCAL_PATH`。
4. 远程模式从 GitHub 下载指定 ref 的仓库归档。
5. 检查 HTTP 状态和超时。
6. 限制最大下载大小。
7. 安全解压。
8. 自动识别 GitHub 归档的根目录。
9. 查找并解析 `catalog.json`。
10. 执行完整 Schema 和文件验证。
11. 将 `games/` 复制到临时目标。
12. 将清单复制为 `public/game-catalog.json`。
13. 全部成功后原子替换正式目录。
14. 生成同步记录。
15. 失败时不破坏上一次成功结果。

### 13.3 安全解压

拒绝：

```text
../
绝对路径
Windows 盘符路径
解压后超出 staging 的路径
符号链接跳出 staging
```

### 13.4 清单验证

至少检查：

- `schemaVersion` 受支持
- `games` 是数组
- 游戏 ID 唯一
- 游戏 ID 符合：

```regex
^[a-z0-9][a-z0-9-]*$
```

- 标题和描述不为空
- `entry` 和 `cover` 是相对路径
- 路径不得包含 `..`
- 入口必须以 `.html` 结尾
- 入口和封面文件必须存在
- 游戏目录必须位于 `games/<game-id>/`
- 两个游戏不得引用同一目录
- 日期格式有效
- 版本格式有效
- `aspectRatio` 格式有效
- 状态属于允许枚举
- iframe 权限属于白名单
- 推荐游戏 ID 必须存在

验证失败时：

1. 输出明确错误。
2. 命令以非零状态退出。
3. 不覆盖当前可用游戏目录。

### 13.5 输出目录

```text
public/
├── game-catalog.json
├── games-sync-info.json
└── games/
```

同步记录示例：

```json
{
  "repository": "owner/web-games-library",
  "ref": "dist",
  "commit": "full commit sha",
  "catalogVersion": 1,
  "gameCount": 12,
  "syncedAt": "2026-07-15T00:00:00Z"
}
```

不得写入任何 Token 或私钥。

### 13.6 日志

示例：

```text
Synchronising games from owner/web-games-library@dist
Downloaded repository archive
Validated 12 games
Copied 12 games to public/games
Game synchronisation completed
```

禁止输出：

- Token
- Authorization Header
- 带凭据的 URL
- 私钥
- Session Cookie

---

## 14. 门户构建命令

根据当前包管理器适配。

推荐：

```json
{
  "scripts": {
    "sync:games": "node scripts/sync-games.mjs",
    "validate:games": "node scripts/validate-game-catalog.mjs",
    "dev:portal": "vite",
    "build:portal": "vite build",
    "dev": "pnpm sync:games && pnpm dev:portal",
    "dev:no-sync": "vite",
    "build": "pnpm sync:games && pnpm validate:games && pnpm build:portal",
    "build:no-sync": "vite build"
  }
}
```

优先使用显式命令，不要滥用隐式 `prebuild`。

---

## 15. 公开门户功能

公开门户至少包含：

```text
/                         首页
/games                    全部游戏
/games/:gameId            游戏详情和运行页面
/categories/:category     分类页面
/about                    关于页面
```

### 15.1 清单读取

运行时只读取本地文件：

```ts
export async function loadGameCatalog(): Promise<GameCatalog> {
  const response = await fetch("/game-catalog.json", {
    cache: import.meta.env.DEV ? "no-store" : "default"
  });

  if (!response.ok) {
    throw new Error(`Unable to load game catalog: ${response.status}`);
  }

  return response.json();
}
```

必须实现：

- 加载状态
- 错误状态
- 空状态
- 清单异常的安全降级
- 搜索
- 分类
- 推荐游戏
- 最近更新
- 分页
- 不存在的游戏页面

不要在 React 组件中硬编码游戏列表。

### 15.2 游戏 URL

游戏 URL 来自清单中的 `entry`：

```ts
const gameUrl = `/${game.entry}`;
```

不要仅根据 ID 自行假设入口路径。

必须处理：

- 重复斜杠
- URL 编码
- 不合法路径
- 不存在的 entry

---

## 16. iframe 游戏容器

实现可复用：

```text
GameFrame
```

至少支持：

- 游戏加载状态
- iframe 加载失败
- 全屏
- 重启
- 静音
- 游戏标题
- 操作说明
- 返回游戏列表
- 响应式宽高比
- 移动端基础可用性
- 键盘和手柄权限

示例：

```tsx
<iframe
  key={reloadKey}
  title={game.title}
  src={`/${game.entry}`}
  allow="fullscreen; autoplay; gamepad"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  referrerPolicy="no-referrer"
/>
```

注意：

1. 不允许用户输入任意外部 iframe URL。
2. iframe 权限只能从白名单选择。
3. 不能通过后台完全关闭 sandbox。
4. 第三方不可信游戏未来应放到独立子域。
5. 重启可以改变 iframe `key` 或重新设置 `src`。
6. 全屏使用 Fullscreen API。
7. 静音通过游戏通信协议实现。
8. 不支持静音的游戏应优雅降级。

---

## 17. 游戏通信 SDK

创建：

```text
packages/game-sdk/
```

消息格式：

```ts
export interface GameMessage<T = unknown> {
  source: "game-portal-sdk";
  version: 1;
  gameId: string;
  type: string;
  payload?: T;
}
```

游戏发送：

```text
GAME_READY
GAME_STARTED
SCORE_UPDATED
GAME_OVER
REQUEST_FULLSCREEN
SAVE_DATA
ERROR
```

门户发送：

```text
PORTAL_PAUSE
PORTAL_RESUME
PORTAL_MUTE
PORTAL_UNMUTE
PORTAL_RESTART
```

接收消息时必须：

1. 检查 `event.origin`
2. 检查 `source`
3. 检查 `gameId`
4. 检查消息类型
5. 验证 payload
6. 忽略未知消息
7. 不执行消息中的代码
8. 不访问消息提供的任意 URL
9. 组件卸载时移除监听器

当前阶段只实现基础通信，不实现在线排行榜和账号系统。

---

## 18. 后台管理功能

后台路由：

```text
/admin/login
/admin
/admin/games
/admin/games/new
/admin/games/:gameId
/admin/games/:gameId/preview
/admin/publishing
/admin/deployments
/admin/settings
/admin/audit
/admin/releases
```

### 18.1 后台首页

显示真实数据：

- 游戏总数
- 已发布数量
- Beta 数量
- 开发中数量
- 归档数量
- 草稿数量
- 最近发布
- 最近部署
- 失败构建
- 最近修改游戏

数据不可用时显示明确错误，不使用虚假数字。

### 18.2 游戏列表

显示：

- 封面
- 标题
- ID
- 版本
- 状态
- 推荐状态
- 分类
- 更新时间
- 配置状态
- 构建状态
- 操作菜单

支持：

- 搜索
- 分类筛选
- 状态筛选
- 按名称排序
- 按更新时间排序
- 分页
- 编辑
- 预览

### 18.3 新增游戏

表单包含：

```text
基本信息
├── id
├── title
├── description
├── version
├── status
└── featured

展示信息
├── cover
├── categories
├── tags
├── controls
└── aspectRatio

运行配置
├── entry
├── gameDirectory
├── minimumPortalSdkVersion
└── iframePermissions

SEO
├── title
└── description

时间和版本
├── createdAt
├── updatedAt
└── changelog
```

游戏 ID 创建后默认不可修改。

修改 ID 必须作为迁移操作，不得普通编辑。

### 18.4 编辑游戏

支持：

- 名称
- 描述
- 版本号
- 状态
- 推荐状态
- 封面
- 分类
- 标签
- 操作说明
- 入口
- 显示顺序
- iframe 权限
- SEO
- 更新日志

默认保存为草稿，不立即发布。

表单需要：

- 字段级错误
- 未保存修改提示
- 离开页面确认
- 防重复提交
- 成功与失败提示
- 键盘可访问性
- 并发冲突提示

### 18.5 归档和删除

默认只实现归档和恢复。

状态变化：

```text
development → archived
beta → archived
published → archived
archived → previous state or development
```

归档后：

- 不显示在公开列表
- 可以保留旧详情页
- 保留 Git 历史
- 可恢复

永久删除第一版可以不实现。

如实现永久删除，必须：

1. 仅 Admin 可操作
2. 二次确认
3. 输入游戏 ID
4. 显示将删除的文件
5. 写入审计日志

---

## 19. 管理员认证

默认推荐：

```text
GitHub OAuth 登录 + 服务端管理员白名单
```

环境变量：

```env
AUTH_PROVIDER=github
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
SESSION_SECRET=
ADMIN_GITHUB_USERS=bohanchen,user-two
ADMIN_SESSION_MAX_AGE_SECONDS=28800
```

禁止：

- 前端硬编码管理员密码
- 只隐藏 `/admin`
- 将 Token 放入 localStorage
- 将 Session Secret 放入前端
- 将 GitHub App 私钥发给浏览器
- 使用 `VITE_*` 暴露秘密

会话必须：

- `HttpOnly`
- `Secure`
- 合理的 `SameSite`
- 有有效期
- 登录后轮换 Session ID
- 注销后服务端撤销
- 高风险操作可要求近期重新认证

---

## 20. 权限模型

实现三种角色。

### Viewer

可以：

- 查看后台
- 查看游戏配置
- 查看发布状态
- 查看部署状态
- 查看审计日志

不能修改。

### Editor

可以：

- 新增游戏
- 编辑游戏
- 上传封面
- 保存草稿
- 运行验证
- 创建预览

不能：

- 发布
- 回滚生产
- 管理管理员
- 永久删除

### Admin

拥有：

- 发布
- 回滚
- 修改站点设置
- 管理权限
- 高风险操作

所有写接口必须在服务端检查角色。

前端隐藏按钮不能代替服务端权限检查。

示例：

```ts
requireRole(session, "admin");
```

---

## 21. GitHub App 集成

生产环境优先使用 GitHub App，而不是长期 PAT。

### 21.1 环境变量

```env
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY=

GITHUB_GAME_LIBRARY_REPO=owner/web-games-library
GITHUB_PORTAL_REPO=owner/game-portal

GITHUB_SOURCE_BRANCH=main
GITHUB_DRAFT_BRANCH=admin/drafts
GITHUB_DIST_BRANCH=dist
GITHUB_PUBLISH_BRANCH_PREFIX=admin/publish-

ADMIN_PUBLISH_MODE=pull-request
PORTAL_DISPATCH_EVENT=games-library-updated
```

### 21.2 建议权限

游戏库仓库：

```text
Metadata: Read
Contents: Read and write
Pull requests: Read and write
Actions: Read
Checks: Read
```

门户仓库：

```text
Metadata: Read
Contents: Read
Actions: Read and write
```

根据实际 API 调用继续缩减。

### 21.3 GitHub 服务层

创建：

```text
src/server/github/
├── auth.ts
├── client.ts
├── contents.ts
├── branches.ts
├── commits.ts
├── pullRequests.ts
├── actions.ts
└── dispatch.ts
```

API 路由不得散落直接调用 GitHub API。

服务接口示例：

```ts
interface GameRepositoryService {
  listGames(ref: string): Promise<GameMetadata[]>;
  getGame(id: string, ref: string): Promise<GameFile>;

  createGame(
    input: CreateGameInput
  ): Promise<CommitResult>;

  updateGame(
    id: string,
    input: UpdateGameInput,
    expectedSha: string
  ): Promise<CommitResult>;

  archiveGame(
    id: string,
    expectedSha: string
  ): Promise<CommitResult>;

  createPublishPullRequest(): Promise<PullRequestResult>;
  getWorkflowRuns(): Promise<WorkflowRun[]>;
  triggerPortalDeployment(commitSha: string): Promise<void>;
}
```

禁止：

- 将私钥提交到仓库
- 将 installation token 返回浏览器
- 在日志输出 Authorization Header
- 在错误响应返回内部认证信息
- 使用拥有全部组织仓库权限的 Token

---

## 22. 草稿和发布模型

游戏业务状态：

```text
development
beta
published
archived
```

配置发布状态：

```text
clean
draft
validating
ready
publishing
published
failed
```

状态流程：

```text
Draft
  ↓ validate
Validated
  ↓ publish
Publishing
  ↓ success
Published

Publishing
  ↓ failure
Failed
```

### 22.1 草稿分支

默认使用：

```text
admin/drafts
```

保存草稿时：

1. 获取目标文件当前 SHA。
2. 比较前端提交的 `expectedSha`。
3. 检测并发修改。
4. 更新 `catalog/games/<id>.json`。
5. 创建 commit。
6. 返回新 SHA。
7. 写入审计日志。

### 22.2 发布方式

生产默认：

```env
ADMIN_PUBLISH_MODE=pull-request
```

发布流程：

1. 验证所有草稿。
2. 从主分支创建发布分支。
3. 应用草稿变更。
4. 创建 Pull Request。
5. 执行 GitHub Actions。
6. 检查通过后由管理员合并或按配置自动合并。
7. 主分支更新后构建游戏。
8. CI 生成 `dist`。
9. 游戏库触发门户部署。
10. 后台展示最终结果。

可选：

```text
pull-request
direct
```

`direct` 只用于个人开发或测试环境。

---

## 23. 并发修改控制

所有编辑请求提交：

```text
expectedSha
```

服务端比较 GitHub 当前文件 SHA。

冲突时返回：

```http
409 Conflict
```

响应：

```json
{
  "code": "CONFIG_CONFLICT",
  "message": "This game was modified by another administrator.",
  "currentSha": "new sha",
  "expectedSha": "old sha"
}
```

前端提供：

- 重新加载最新版本
- 查看差异
- 复制当前未保存修改
- 手动合并

禁止静默覆盖其他管理员的修改。

---

## 24. 管理 API

使用版本化路径：

```text
/api/admin/v1/*
```

### 24.1 会话

```text
GET    /api/admin/v1/session
POST   /api/admin/v1/logout
```

### 24.2 游戏读取

```text
GET    /api/admin/v1/games
GET    /api/admin/v1/games/:gameId
```

查询参数：

```text
?q=
&status=
&category=
&sort=
&page=
&pageSize=
```

### 24.3 游戏写入

```text
POST   /api/admin/v1/games
PATCH  /api/admin/v1/games/:gameId
POST   /api/admin/v1/games/:gameId/archive
POST   /api/admin/v1/games/:gameId/restore
DELETE /api/admin/v1/games/:gameId
```

第一版可以不开放永久删除。

### 24.4 验证

```text
POST /api/admin/v1/games/:gameId/validate
POST /api/admin/v1/catalog/validate
```

响应：

```json
{
  "valid": false,
  "errors": [
    {
      "path": "entry",
      "code": "ENTRY_NOT_FOUND",
      "message": "The configured entry file does not exist."
    }
  ],
  "warnings": [
    {
      "path": "cover",
      "code": "LARGE_COVER",
      "message": "The cover image is larger than recommended."
    }
  ]
}
```

错误阻止发布，警告不一定阻止。

### 24.5 封面

```text
POST   /api/admin/v1/games/:gameId/cover
DELETE /api/admin/v1/games/:gameId/cover
```

要求：

- 仅 PNG、JPEG、WebP
- 检查真实文件格式
- 限制最大 5 MB
- 推荐 1280 × 720
- 重新生成安全文件名
- 防止路径穿越
- 禁止覆盖其他游戏目录
- 默认禁止 SVG
- 上传后生成预览

### 24.6 预览

```text
POST /api/admin/v1/games/:gameId/preview
GET  /api/admin/v1/previews/:previewId
```

### 24.7 发布

```text
GET  /api/admin/v1/publishing/status
POST /api/admin/v1/publishing/prepare
POST /api/admin/v1/publishing/publish
POST /api/admin/v1/publishing/cancel
```

### 24.8 部署

```text
GET  /api/admin/v1/deployments
GET  /api/admin/v1/deployments/:deploymentId
POST /api/admin/v1/deployments/retry
```

### 24.9 发布历史与回滚

```text
GET  /api/admin/v1/releases
POST /api/admin/v1/releases/:releaseId/rollback
```

回滚必须创建新的反向提交或回滚 PR，不得删除 Git 历史。

### 24.10 审计日志

```text
GET /api/admin/v1/audit
```

---

## 25. 预览系统

### 25.1 元数据预览

后台直接预览：

- 游戏卡片
- 首页推荐效果
- 游戏详情页
- 分类列表
- 移动端布局
- SEO 标题和描述

### 25.2 游戏运行预览

使用隔离路径：

```text
/preview/:previewToken/games/:gameId/
```

预览 Token 必须：

- 随机生成
- 有过期时间
- 与指定 commit 绑定
- 只读
- 可撤销
- 不包含管理员会话
- 不允许路径穿越

第一版可以只预览已经存在静态构建结果的游戏。

不要在后台执行任意 `npm install` 或管理员提供的任意命令。

---

## 26. 游戏库 CI/CD

游戏库主分支更新后：

```text
源配置变更
    ↓
安装依赖
    ↓
验证 Schema
    ↓
构建受影响游戏
    ↓
检查 index.html 和资源
    ↓
生成 catalog.json
    ↓
发布 dist 分支
    ↓
触发门户重新部署
```

游戏库 CI 必须：

1. 安装依赖。
2. 验证所有独立游戏配置。
3. 构建每个受影响游戏。
4. 检查每个游戏是否生成 `index.html`。
5. 检查封面是否存在。
6. 复制静态资源。
7. 生成统一 `catalog.json`。
8. 生成 `settings.json`。
9. 发布到 `dist`。
10. 触发门户工作流。

---

## 27. 门户重新部署

使用：

```text
repository_dispatch
```

事件名称：

```text
games-library-updated
```

载荷：

```json
{
  "event_type": "games-library-updated",
  "client_payload": {
    "source_repository": "owner/web-games-library",
    "source_commit": "full source commit sha",
    "dist_commit": "full dist commit sha",
    "catalog_schema_version": 1
  }
}
```

门户工作流支持：

```text
push
pull_request
workflow_dispatch
repository_dispatch
```

可选增加每日定时同步作为兜底。

门户工作流：

```text
checkout
    ↓
install dependencies
    ↓
sync games
    ↓
validate catalog
    ↓
lint
    ↓
test
    ↓
build
    ↓
deploy
```

后台必须展示：

- 源 commit
- Pull Request
- 游戏库构建状态
- `dist` commit
- 门户构建状态
- 部署状态
- 开始时间
- 完成时间
- 失败步骤
- GitHub 日志链接
- 重试按钮

GitHub API 请求成功不等于部署成功，必须跟踪工作流最终结果。

---

## 28. 缓存策略

门户同步游戏时：

1. 获取目标 ref 的 commit SHA。
2. 使用缓存键：

```text
games-<repository>-<commit-sha>
```

3. commit 未变化时复用已验证缓存。
4. 不得仅使用分支名作为缓存键。
5. 缓存存在时仍检查清单。
6. 缓存损坏时重新下载。

允许旧缓存必须显式开启：

```env
GAMES_ALLOW_STALE_CACHE=true
```

生产默认：

```env
GAMES_ALLOW_STALE_CACHE=false
```

如果使用旧缓存，日志和后台必须明确显示。

---

## 29. 数据库设计

GitHub 是游戏配置和发布文件的事实来源。

数据库保存：

```text
admin_users
admin_sessions
publish_jobs
deployment_jobs
audit_logs
preview_tokens
```

建议表：

```text
admin_users
├── id
├── provider
├── provider_user_id
├── login
├── role
├── enabled
├── created_at
└── updated_at

publish_jobs
├── id
├── actor_id
├── source_branch
├── source_commit
├── pull_request_number
├── dist_commit
├── portal_run_id
├── status
├── error_message
├── created_at
└── updated_at

deployment_jobs
├── id
├── publish_job_id
├── repository
├── workflow_run_id
├── status
├── started_at
├── completed_at
└── error_message

audit_logs
├── id
├── actor_id
├── action
├── resource_type
├── resource_id
├── before_json
├── after_json
├── result
├── created_at
└── metadata_json

preview_tokens
├── id
├── token_hash
├── game_id
├── commit_sha
├── expires_at
├── revoked_at
└── created_at
```

不要把游戏构建文件存进数据库。

---

## 30. 审计日志

记录：

- 登录成功和失败
- 创建游戏
- 修改游戏
- 归档游戏
- 恢复游戏
- 上传和删除封面
- 修改站点配置
- 保存草稿
- 创建发布
- 合并发布
- 取消发布
- 触发部署
- 重试部署
- 回滚
- 权限修改
- 高风险操作失败

结构：

```ts
interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string;
  actorLogin: string;
  actorRole: "viewer" | "editor" | "admin";
  action: string;
  resourceType: "game" | "settings" | "release" | "deployment";
  resourceId: string;
  before?: unknown;
  after?: unknown;
  commitSha?: string;
  pullRequestNumber?: number;
  ipHash?: string;
  userAgent?: string;
  result: "success" | "failure";
  errorCode?: string;
}
```

禁止记录：

- Token
- Cookie
- 私钥
- Session Secret
- 完整 Authorization Header
- 数据库密码

---

## 31. 后台 UI 状态

每个后台页面必须覆盖：

- 初始加载
- 空状态
- 网络错误
- 未登录
- 权限不足
- GitHub 不可用
- 配置冲突
- 验证失败
- 构建中
- 构建失败
- 发布成功
- 部署失败
- 回滚成功或失败

不要只使用 `alert()`。

建议复用或创建：

```text
AdminButton
AdminInput
AdminSelect
AdminTextarea
AdminCheckbox
AdminDialog
AdminToast
AdminTable
AdminEmptyState
AdminErrorState
AdminStatusBadge
AdminConfirmDialog
AdminDiffViewer
AdminFileUpload
AdminDeploymentTimeline
```

保持现有设计系统，不要因后台功能重写整个公开门户。

---

## 32. 安全要求

### 32.1 API

- 所有写请求验证身份
- 所有写请求验证角色
- 检查 Origin
- 实现 CSRF 防护
- 限流
- 限制请求体大小
- Schema 验证
- 稳定错误码
- 不返回内部堆栈
- 日志清理秘密信息
- 防重复提交
- 高风险操作幂等

### 32.2 文件

- 检查真实文件类型
- 限制文件大小
- 规范化文件名
- 防止路径穿越
- 禁止任意磁盘路径
- 禁止上传可执行脚本
- 默认禁止 SVG
- 禁止通过 URL 让服务器下载任意内容
- 如未来支持远程图片导入，必须实现 SSRF 防护

### 32.3 游戏

- 游戏入口必须在指定游戏目录
- 禁止任意外部 iframe URL
- sandbox 权限来自白名单
- 不允许完全关闭 sandbox
- 不执行上传包中的安装脚本
- 构建在 CI 隔离环境中完成
- 第三方游戏未来使用独立域名
- 不允许后台编辑 GitHub Actions
- 不允许后台输入任意构建命令

### 32.4 GitHub

- 使用短期 installation token
- GitHub App 只安装到需要的仓库
- 使用最小权限
- 私钥仅存在服务端
- 不记录认证头
- 不将秘密返回前端
- 不提交真实凭据
- 不使用长期经典 PAT 作为默认生产方案

---

## 33. 环境变量汇总

```env
# Public
PUBLIC_SITE_URL=
PUBLIC_ADMIN_URL=

# Authentication
AUTH_PROVIDER=github
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
SESSION_SECRET=
ADMIN_GITHUB_USERS=
ADMIN_SESSION_MAX_AGE_SECONDS=28800

# GitHub App
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY=

# Repositories
GITHUB_GAME_LIBRARY_REPO=owner/web-games-library
GITHUB_PORTAL_REPO=owner/game-portal
GITHUB_SOURCE_BRANCH=main
GITHUB_DRAFT_BRANCH=admin/drafts
GITHUB_DIST_BRANCH=dist
GITHUB_PUBLISH_BRANCH_PREFIX=admin/publish-

# Publishing
ADMIN_PUBLISH_MODE=pull-request
PORTAL_DISPATCH_EVENT=games-library-updated

# Portal game sync
GAMES_REPO=owner/web-games-library
GAMES_REF=dist
GAMES_CATALOG_PATH=catalog.json
GAMES_SYNC_ENABLED=true
GAMES_LOCAL_PATH=
GAMES_MAX_ARCHIVE_SIZE_MB=500
GAMES_ALLOW_STALE_CACHE=false
GITHUB_TOKEN=

# Database
DATABASE_URL=

# Security
ADMIN_ALLOWED_ORIGINS=
ADMIN_RATE_LIMIT_PER_MINUTE=60
ADMIN_MAX_UPLOAD_MB=5
PREVIEW_TOKEN_TTL_SECONDS=3600
```

提供：

```text
.env.example
```

只包含变量名和安全示例。

---

## 34. 测试要求

### 34.1 Schema 测试

- 正常配置通过
- 缺少字段失败
- 重复 ID 失败
- 非法 ID 失败
- 不支持的 schemaVersion 失败
- 入口不存在失败
- 封面不存在失败
- 包含 `../` 的路径失败
- 绝对路径失败
- 非法状态失败
- 错误日期失败
- 错误版本失败
- iframe 权限超出白名单失败
- 推荐游戏不存在失败

### 34.2 同步测试

- 从本地 fixture 同步
- 从模拟 GitHub 归档同步
- 同步后目录正确
- 同步失败不会删除旧目录
- staging 完成后才替换正式目录
- 路径穿越被拒绝
- 超大归档被拒绝
- 同步记录正确
- 不复制无关源码
- 缓存损坏自动重下

### 34.3 权限测试

- 未登录无法访问后台 API
- Viewer 不能编辑
- Editor 不能发布
- Admin 可以发布
- 前端隐藏按钮不影响服务端安全
- 禁用管理员不能继续使用旧会话
- CSRF 被拒绝
- 非法 Origin 被拒绝

### 34.4 游戏管理测试

- 创建合法游戏
- 拒绝重复 ID
- 编辑游戏
- 归档和恢复
- 上传合法封面
- 拒绝伪造 MIME
- 拒绝超大文件
- 拒绝路径穿越
- 保存草稿生成正确 commit
- expectedSha 冲突返回 409
- 冲突不会覆盖远程文件

### 34.5 发布测试

- 验证失败不能发布
- 创建正确发布分支
- 创建 Pull Request
- Actions 失败时显示失败
- Actions 成功后记录 dist commit
- 门户部署成功后任务完成
- 重复点击不会创建重复任务
- 回滚生成新提交或 PR
- GitHub API 成功但 workflow 失败时不能标记为成功

### 34.6 门户前端测试

- 游戏列表显示
- 分类过滤
- 标题和标签搜索
- 推荐游戏
- 最近更新
- 点击进入正确路由
- 不存在游戏显示错误页
- iframe 使用清单入口
- 重启有效
- 清单加载失败显示错误状态
- 移动端基本可用

### 34.7 后台 UI 测试

- 登录
- 游戏列表
- 新增游戏
- 编辑和保存
- 表单错误
- 未保存修改提示
- 预览
- 发布确认
- 发布进度
- 部署状态
- 冲突提示
- 权限不足提示
- 移动端后台基础可用性

### 34.8 安全测试

- GitHub 私钥不进入前端 bundle
- Token 不出现在日志
- Cookie 安全属性正确
- 路径穿越被拒绝
- 任意 iframe URL 被拒绝
- 非管理员不能修改站点设置
- 上传脚本文件被拒绝
- 错误响应不包含内部堆栈和秘密

---

## 35. 构建检查

实现完成后运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

如果项目已有：

```text
integration test
end-to-end test
format check
database migration check
```

也必须运行。

修复所有由本次修改引起的错误。

---

## 36. 实施顺序

### 阶段 1：检查现有项目

- 检查框架
- 检查路由
- 检查部署
- 检查认证
- 检查样式系统
- 检查现有游戏数据
- 不无理由替换依赖
- 保留当前公开页面设计

### 阶段 2：共享 Schema

- 定义游戏配置
- 定义 catalog
- 定义 settings
- 定义 API 类型
- 定义错误码
- 添加 fixture 和单元测试

### 阶段 3：游戏同步

- 本地路径同步
- 远程 GitHub 归档下载
- 安全解压
- 文件验证
- staging
- 原子替换
- 缓存
- 同步记录

优先完成本地模式，再实现远程模式。

### 阶段 4：公开门户接入

- 移除硬编码游戏列表
- 读取本地 catalog
- 搜索和分类
- 游戏详情
- iframe 容器
- 加载、错误、空状态
- 游戏通信基础设施

### 阶段 5：只读后台

- GitHub OAuth
- 管理员白名单
- 权限中间件
- 从 GitHub 读取配置
- 游戏列表
- 游戏详情
- 发布和部署状态

### 阶段 6：编辑和草稿

- 新增游戏
- 编辑游戏
- 封面上传
- expectedSha
- 保存到草稿分支
- 审计日志
- 冲突 UI

### 阶段 7：验证和预览

- 单游戏验证
- 全 catalog 验证
- 元数据预览
- iframe 预览
- 错误和警告展示

### 阶段 8：发布系统

- 发布分支
- Pull Request
- Actions 状态
- 生成 dist
- repository_dispatch
- 门户重新部署
- 后台部署时间线

### 阶段 9：回滚与安全强化

- 发布历史
- 回滚
- CSRF
- 限流
- 审计页面
- 高风险操作二次确认
- 错误恢复
- 安全测试

---

## 37. MVP 验收标准

第一版必须满足：

1. 管理员可以安全登录 `/admin`。
2. 未登录用户不能读取后台敏感数据。
3. 后台能读取 GitHub 游戏库中的全部游戏配置。
4. 后台能新增游戏配置。
5. 后台能修改标题、描述、封面、分类、状态、入口和版本。
6. 修改保存到草稿分支。
7. 保存时执行共享 Schema 验证。
8. 并发修改不会静默覆盖。
9. 后台能预览游戏卡片和详情。
10. 后台能预览已有静态游戏。
11. Admin 能发起发布。
12. 发布默认创建 Pull Request。
13. GitHub Actions 能生成 `dist`。
14. 游戏库能触发门户重新部署。
15. 后台能显示构建和部署成功或失败。
16. 门户构建时能同步 GitHub 游戏库。
17. 门户浏览器运行时不请求 GitHub API。
18. 新增已发布游戏后无需修改门户源码。
19. 游戏能通过 iframe 正常运行。
20. 游戏 CSS 和 JavaScript 不影响门户。
21. 非法清单不能进入生产构建。
22. 路径穿越和绝对路径被拒绝。
23. GitHub 凭据不进入浏览器、构建产物和日志。
24. 所有高风险操作写入审计日志。
25. 本地开发支持 `GAMES_LOCAL_PATH`。
26. 类型检查、测试和生产构建全部通过。
27. README 和文档说明添加游戏、发布、回滚和部署流程。

---

## 38. 当前阶段不实现

暂不实现：

- 普通玩家账号
- 评论
- 在线排行榜
- 云存档
- 支付
- 广告管理
- 用户上传第三方游戏
- 在线代码编辑器
- 后台执行任意 npm 命令
- 后台编辑 GitHub Actions
- 任意外部 iframe
- 多租户后台
- 完整 CMS
- 服务器运行不可信游戏源码

---

## 39. 实现限制

- 不在浏览器调用 GitHub API。
- 不在浏览器暴露 GitHub Token。
- 不使用 Git submodule 作为主要同步方案。
- 不让门户 CI 构建远程游戏源码。
- 不让后台直接编辑 `dist`。
- 不在 React 组件中硬编码游戏清单。
- 不把整个游戏仓库打包进门户 JavaScript。
- 不静默忽略同步和验证错误。
- 不提交缓存和远程游戏构建产物。
- 不因后台功能重新设计公开门户。
- 不允许管理员设置任意外部游戏 URL。
- 不允许后台执行任意代码。
- 不允许通过隐藏页面代替认证。
- 不将秘密写入 `VITE_*` 变量。
- 不直接永久删除游戏作为默认行为。

---

## 40. 文档要求

创建：

```text
docs/game-library-contract.md
docs/admin-guide.md
docs/publishing-flow.md
docs/security-model.md
```

README 至少说明：

- 项目架构
- 如何本地运行
- 如何配置环境变量
- 如何添加新游戏
- 如何使用 `GAMES_LOCAL_PATH`
- 如何创建 GitHub App
- GitHub App 需要哪些权限
- 如何初始化管理员
- 如何保存草稿
- 如何发布
- 如何查看部署状态
- 如何回滚
- 如何处理配置冲突
- 如何部署门户
- 如何部署 Admin API
- 如何恢复失败同步

本地同步示例：

```bash
GAMES_LOCAL_PATH=../web-games-library/dist \
pnpm sync:games

pnpm dev:no-sync
```

远程同步示例：

```bash
GAMES_REPO=owner/web-games-library \
GAMES_REF=dist \
pnpm sync:games

pnpm dev
```

---

## 41. Codex 执行要求

请直接检查当前仓库并实施，不要只输出建议或伪代码。

执行时遵循：

1. 先理解现有项目，再修改。
2. 尽量复用现有组件和依赖。
3. 保持 TypeScript 类型完整。
4. 将复杂同步逻辑拆成可测试函数。
5. GitHub 调用集中在服务层。
6. 后台和 CI 使用同一份 Schema。
7. 所有写接口检查登录和角色。
8. 所有 GitHub 写入使用 expected SHA。
9. 所有秘密只存在服务端。
10. 不在前端 bundle、日志或错误中泄露秘密。
11. 不直接修改生成的 `dist`。
12. 不执行任意远程代码。
13. 不为后台重写整个门户。
14. 先完成安全的纵向闭环：
    - 登录
    - 读取
    - 编辑
    - 保存草稿
    - 验证
    - 预览
    - 发布
    - 查看部署结果
15. 完成后运行所有测试和构建命令。
16. 修复由本次修改导致的错误。
17. 不得以“后续再实现”为理由跳过 MVP 验收项目。

---

## 42. Codex 最终输出格式

完成后给出：

1. 最终架构说明
2. 修改文件列表
3. 新增目录和模块
4. 数据库迁移
5. GitHub App 配置和权限
6. 环境变量说明
7. 本地运行命令
8. 管理员初始化步骤
9. 添加新游戏步骤
10. 草稿保存流程
11. 发布流程
12. 门户重新部署流程
13. 回滚流程
14. 安全措施
15. 测试命令和测试结果
16. 仍未实现的可选功能
17. 已知限制
