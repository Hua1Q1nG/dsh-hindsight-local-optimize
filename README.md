# dsh-hindsight-local-optimize

为 DeepSeek Harness（DSH 桌面端）的 `@vectorize-io/hindsight-coding-agents` 插件补上「本地记忆」完整生命周期与体验的优化插件。

> 本插件不修改官方插件的业务逻辑，而是作为**旁路补丁**：接管守护进程的启动/停止、自动绑定 DSH 生命周期、隐藏终端黑框、支持把档案柜装到其它盘。

## 背景：解决了什么问题

官方 `hindsight-coding-agents` 在 **DSH 桌面端**有两个缺口：

1. **本地守护进程不会自动启动**
   官方 DSH 版插件只把记忆地址指向本机 `127.0.0.1:9077`，但从不主动拉起 `hindsight-embed`（`hindsight-api`）守护进程——自动冷启动只实现在 Claude Code / Cursor / Copilot 等 **CLI 工具**里。结果是：选「本地保存」后，DSH 去连 9077 端口但那里没人值班，记忆功能等于没生效。

2. **会弹出黑框**
   守护进程的宿主 `uv.exe` 在 Windows 11 上会用 `WindowsTerminal` 弹出一个终端黑框，且常驻不消失。

本插件补齐这两点，并提供一键开关、开机自启、退出随停。

## 功能

- ✅ **一键开关**：侧边栏「本地记忆」按钮，实时状态灯（未运行 / 启动中 / 运行中 / 失败）。
- ✅ **开机自启**：DSH 启动时自动在后台拉起守护进程（带重试，约 40 秒内就绪，不阻塞 DSH）。
- ✅ **退出随停**：独立「看门狗」进程监控 DSH 主进程，DSH 退出时立即杀掉守护进程、释放内存。
- ✅ **隐藏黑框**：自动给官方启动器 `daemon-start.js` 打「隐藏窗口」补丁（自愈），并后台隐藏 `uv.exe` 的终端窗口。
- ✅ **装到其它盘**：守护进程（uv 缓存）与模型（HuggingFace 缓存）可安装到任意盘。

## 架构

\`\`\`
dsh-hindsight-local-optimize/
├── lib/
│   ├── index.js          # 宿主半边：路由、启停、凭证读取、官方启动器补丁、看门狗
│   ├── client.js         # 客户端半边：侧边栏开关按钮
│   ├── hide-window.ps1   # 隐藏 uv.exe 终端黑框（Win32 ShowWindow）
│   └── watchdog.mjs      # 看门狗：独立进程，DSH 退出时杀守护进程
├── package.json          # 双面插件声明（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml      # 挂载补丁
└── README.md
\`\`\`

### 工作原理（关键点）

- **启动链路**：插件读宿主凭证服务取 `DEEPSEEK_API_KEY`（Key 不出宿主进程）→ 注入 `HINDSIGHT_API_LLM_*` 环境变量 → 后台 `spawn node daemon-start.js --harness dsh` 拉起守护进程。
- **退出链路**：因为守护进程是「孤儿进程」，且 DSH 退出时承载插件的进程会被 Windows 强杀、退出钩子不可靠，所以插件额外 spawn 一个**独立看门狗进程**，每 2 秒探测 DSH 主进程；一旦发现 DSH 退出，立即 `taskkill` 守护进程并自身退出。
- **黑框处理**：启动前给官方 `daemon-start.js` 内部 `spawn uvx` 补 `windowsHide: true`（自愈：官方更新覆盖后下次自动重打），再用 `hide-window.ps1` 枚举并隐藏标题含 `uv.exe` 的窗口。

## 安装

### 前置条件

- 已通过 DSH 插件市场安装官方 `@vectorize-io/hindsight-coding-agents`（本插件依赖它的 `daemon-start.js`）。
- 本机已安装 [uv](https://docs.astral.sh/uv/)（`uvx` 在 PATH），用于运行 `hindsight-embed`。
- 已在 DSH 凭证里配置 `DEEPSEEK_API_KEY`（本地记忆抽取需要一个大模型，官方支持 DeepSeek）。

### 安装本插件

1. 把本仓库克隆或复制到 DSH 的全局插件目录：

   \`\`\`
   <DSH_HOME>/profiles/node_modules/dsh-hindsight-local/
   \`\`\`

2. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 末尾追加一行挂载：

   \`\`\`yaml
   - insert:
       - id: hindsight-local
         name: 'dsh-hindsight-local'
   \`\`\`

3. 完全退出并重新打开 DSH 桌面端。

## 使用方法

安装并重启 DSH 后：

1. **自动启动**：DSH 启动后约 40 秒，左下角「本地记忆」按钮会自动变成「运行中」（无需手动操作）。
2. **手动开关**：点击左下角「本地记忆」按钮，可随时手动启动 / 停止守护进程。
3. **退出随停**：直接关闭 DSH，守护进程会被看门狗自动杀掉、内存立即释放。

## 配置参数

插件自身的配置在 `<DSH_HOME>/storages/dsh-hindsight-local/config.json`：

\`\`\`json
{
  "installDir": "X:\\hindsight",   // 守护进程与模型的安装目录；X 代表任意盘符，留空则用系统默认位置
  "autoStart": true                // 是否开机自动启动
}
\`\`\`

- `installDir`：非空时，插件会把 `UV_CACHE_DIR` 指向 `<installDir>/uv-cache`、`HF_HOME` 指向 `<installDir>/hf-models`，让档案柜和两个小模型装到指定盘。
- `autoStart`：`true` = DSH 启动时自动拉起守护进程；`false` = 只靠手动开关。

Hindsight 记忆本身的配置仍在 `~/.hindsight/coding-agent.json`（插件启动时会自动写入 `serverMode: "daemon"`）。

## 注意事项

- **资源占用**：本地守护进程常驻约 0.8–1 GB 内存；首次安装约 3 GB 磁盘（主要是 torch 依赖 + 两个小模型）。关闭开关或退出 DSH 后内存即释放。
- **首次冷启动慢**：第一次启动要下载 `hindsight-embed` 包和模型，约 1–3 分钟；之后缓存命中，40 秒内就绪。
- **黑框是隐藏不是消除**：`uv.exe` 的终端窗口被 `ShowWindow(SW_HIDE)` 隐藏，进程仍在后台；彻底不弹需等 `uv` 上游支持。**别手动点黑框的 × 关闭它**，那会杀掉守护进程。
- **官方更新**：官方插件更新覆盖 `daemon-start.js` 后，本插件的窗口补丁会在下次启动时自动重打。
- **密钥安全**：`DEEPSEEK_API_KEY` 始终通过 DSH 宿主凭证服务读取，不落盘、不出宿主进程，请勿在代码或配置里硬编码密钥。

## License

MIT
