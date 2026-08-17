/**
 * dsh-hindsight-local — 本地记忆档案柜开关（宿主半边）
 *
 * 运行在 web profile 的宿主层：
 *  1. 注册 /hindsight-local/{status,start,stop,config} 路由给浏览器半边。
 *  2. 启动：通过宿主凭证服务读取 DEEPSEEK_API_KEY（Key 不出宿主进程），注入
 *     HINDSIGHT_API_LLM_* 环境变量，后台 spawn 官方 daemon-start.js 冷启动
 *     hindsight-embed 守护进程（detached，不阻塞）。
 *  3. 停止：按端口 9077 找到监听进程并 taskkill（/T /F），进程退出即释放内存/CPU。
 *  4. 状态：探测 http://127.0.0.1:9077/health。
 *  5. 安装路径：config.installDir 非空时，把 UV_CACHE_DIR / HF_HOME 指向该目录
 *     （档案柜与两个小模型即可装在任意盘）。
 *
 * 仅用 Node 内置模块。
 */
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const name = "hindsight-local";
const PLUGIN = "dsh-hindsight-local";
const DAEMON_PORT = 9077;
const DAEMON_PROFILE = "coding-agent";

function defaultHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

// ── 定位官方插件的 daemon-start.js ──────────────────────────────────────
function findDaemonStart() {
  const profilesDir = join(defaultHome(), "profiles");
  const candidates = [];
  try {
    for (const e of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(
        profilesDir, e.name, "node_modules", "@vectorize-io",
        "hindsight-coding-agents", "dist", "daemon-start.js"
      );
      if (existsSync(p)) candidates.push(p);
    }
  } catch {
    // profiles dir missing — fall through
  }
  return candidates[0] ?? null;
}

// ── 补丁官方 daemon-start.js：给内部 spawn uvx 加 windowsHide（自愈）────
function patchDaemonStart(starterPath) {
  try {
    const code = readFileSync(starterPath, "utf8");
    let out = code;
    let changed = false;
    const pairs = [
      ['spawn(cmd, args, { stdio: "pipe", env })', 'spawn(cmd, args, { stdio: "pipe", env, windowsHide: true })'],
      ['spawn(cmd, args, { stdio: "pipe" })', 'spawn(cmd, args, { stdio: "pipe", windowsHide: true })']
    ];
    for (const [from, to] of pairs) {
      if (out.includes(to)) continue; // 已补丁过
      if (out.includes(from)) {
        out = out.split(from).join(to);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(starterPath, out, "utf8");
    }
    return changed;
  } catch {
    return false;
  }
}

// ── 隐藏 uv.exe 守护进程的终端窗口（Windows 11 黑框）──────────────────
function hideDaemonWindows() {
  try {
    const script = join(dirname(fileURLToPath(import.meta.url)), "hide-window.ps1");
    // 注意：不能加 detached: true —— 在 Windows 上它会让 powershell 脱离控制台后无法执行。
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // best-effort
  }
}

// ── 看门狗：独立进程监控 DSH 退出，退出则杀守护进程 ──────────────────────
function spawnWatchdog() {
  try {
    const script = join(dirname(fileURLToPath(import.meta.url)), "watchdog.mjs");
    const wd = spawn("node", [script, "--ppid", String(process.ppid), "--port", String(DAEMON_PORT)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    wd.on("error", () => {});
    wd.unref();
  } catch {
    // best-effort
  }
}

// ── 状态 / 配置 ─────────────────────────────────────────────────────────
function stateDir() { return join(defaultHome(), "storages", PLUGIN); }
function configFile() { return join(stateDir(), "config.json"); }

async function loadConfig() {
  try {
    return JSON.parse(await readFile(configFile(), "utf8"));
  } catch {
    return { installDir: "", autoStart: false };
  }
}

async function saveConfig(patch) {
  const cfg = { ...(await loadConfig()), ...patch };
  await mkdir(stateDir(), { recursive: true });
  const tmp = configFile() + ".tmp";
  await writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  await rename(tmp, configFile());
  return cfg;
}

// ── 读凭证（走宿主凭证服务，Key 不出宿主）──────────────────────────────
async function resolveCredential(ctx, ref) {
  try {
    const credentials = ctx.get("credentials");
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref);
      if (hit !== undefined && hit !== null) {
        return typeof hit === "string" ? hit : hit.value;
      }
    }
  } catch {
    // fall through to ambient env
  }
  return process.env[ref];
}

// ── Hindsight 记忆配置（确保 serverMode: daemon）────────────────────────
function hindsightConfigFile() { return join(homedir(), ".hindsight", "coding-agent.json"); }

async function ensureHindsightDaemonConfig() {
  const p = hindsightConfigFile();
  let cfg = {};
  try { cfg = JSON.parse(await readFile(p, "utf8")); } catch { /* first run */ }
  cfg.serverMode = "daemon";
  delete cfg.disabled;
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// ── 状态探测 ────────────────────────────────────────────────────────────
async function daemonRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/health`, {
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── 启动 ────────────────────────────────────────────────────────────────
async function startDaemon(ctx) {
  const key = await resolveCredential(ctx, "DEEPSEEK_API_KEY");
  if (!key) {
    return { ok: false, error: "未找到 DEEPSEEK_API_KEY（宿主凭证里没有这个 Key）" };
  }

  const starter = findDaemonStart();
  if (!starter) {
    return { ok: false, error: "找不到 hindsight-coding-agents 插件的 daemon-start.js" };
  }

  // 启动前给官方启动器打"隐藏窗口"补丁（自愈：官方更新覆盖后下次自动重打）
  patchDaemonStart(starter);

  const cfg = await loadConfig();
  await ensureHindsightDaemonConfig();

  const env = {
    ...process.env,
    // 修复 Windows 中文系统 GBK 解码错误：强制 Python/uv 走 UTF-8
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    HINDSIGHT_API_LLM_PROVIDER: "deepseek",
    HINDSIGHT_API_LLM_API_KEY: key,
    HINDSIGHT_API_LLM_MODEL: "deepseek-v4-flash",
    // 关闭 v4-flash 推理链：记忆的事实抽取/蒸馏是结构化任务，无需思考；
    // 实测可把单次耗时从 50~180s 降到 ~1s，且抽取质量不变
    HINDSIGHT_API_LLM_REASONING_EFFORT: "none"
  };
  if (cfg.installDir) {
    env.UV_CACHE_DIR = join(cfg.installDir, "uv-cache");
    env.HF_HOME = join(cfg.installDir, "hf-models");
  }

  // 注意：不能用 process.execPath —— 在 DSH 桌面端（Electron）里它指向 DSH.exe，
  // 用它 spawn 会弹出黑框且进程行为异常。这里显式用 PATH 上的 node，并隐藏窗口。
  const child = spawn("node", [starter, "--harness", "dsh"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env
  });
  child.on("error", () => {});
  child.unref();

  // 后台自动隐藏 uv.exe 的终端黑框
  hideDaemonWindows();

  // 启动看门狗：DSH 退出时自动杀掉守护进程
  spawnWatchdog();

  return { ok: true, status: "starting", starter };
}

// ── 停止 ────────────────────────────────────────────────────────────────
function listeningPids(port) {
  try {
    const out = execFileSync("netstat", ["-ano"], {
      encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid)) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

// 同步停止守护进程（供进程退出钩子调用，必须在退出前同步完成）
function stopDaemonSync() {
  const pids = listeningPids(DAEMON_PORT);
  for (const pid of pids) {
    try {
      execFileSync("taskkill", ["/PID", pid, "/T", "/F"], {
        windowsHide: true, stdio: "ignore"
      });
    } catch {
      // already gone
    }
  }
  return pids;
}

async function stopDaemon() {
  return { ok: true, killed: stopDaemonSync() };
}

// ── 诊断日志（写到 hindsight 的 plugin.log，便于排查自动启动）────────
function logAutoStart(attempt, msg) {
  try {
    const dir = join(tmpdir(), "hindsight-coding-agent");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "plugin.log"), `${new Date().toISOString()} WARN  [dsh-hindsight-local] auto-start attempt ${attempt}: ${msg}\n`, "utf8");
  } catch { /* best-effort */ }
}

// ── web 路由 helpers ────────────────────────────────────────────────────
function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── plugin apply ────────────────────────────────────────────────────────
function apply(ctx, config = {}) {
  const defaults = { installDir: config.installDir ?? "", autoStart: config.autoStart ?? true };

  async function handleStatus(_req, res) {
    const running = await daemonRunning();
    const cfg = await loadConfig();
    jsonResponse(res, 200, { ok: true, running, ...cfg });
  }

  async function handleStart(_req, res) {
    try {
      const result = await startDaemon(ctx);
      jsonResponse(res, result.ok ? 200 : 500, result);
    } catch (error) {
      jsonResponse(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleStop(_req, res) {
    try {
      const result = await stopDaemon();
      jsonResponse(res, 200, result);
    } catch (error) {
      jsonResponse(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleConfig(req, res) {
    try {
      if (req.method === "GET") {
        jsonResponse(res, 200, { ok: true, ...(await loadConfig()) });
        return;
      }
      if (req.method === "POST") {
        const raw = await readRequestBody(req);
        const patch = raw.length === 0 ? {} : JSON.parse(raw);
        const next = await saveConfig(patch);
        jsonResponse(res, 200, { ok: true, ...next });
        return;
      }
      jsonResponse(res, 405, { ok: false, error: "method not allowed" });
    } catch (error) {
      jsonResponse(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  ctx.inject(["webServer"], (sctx) => {
    const server = sctx.get("webServer");
    sctx.effect(() => server.register({ kind: "exact", path: "/hindsight-local/status", handler: handleStatus }), PLUGIN + ": status route");
    sctx.effect(() => server.register({ kind: "exact", path: "/hindsight-local/start", handler: handleStart }), PLUGIN + ": start route");
    sctx.effect(() => server.register({ kind: "exact", path: "/hindsight-local/stop", handler: handleStop }), PLUGIN + ": stop route");
    sctx.effect(() => server.register({ kind: "exact", path: "/hindsight-local/config", handler: handleConfig }), PLUGIN + ": config route");
  });

  // ── 生命周期绑定：开机自启 + 退出随停 ────────────────────────────────
  // 退出时同步停止守护进程（立即释放内存）
  const onExit = () => { try { stopDaemonSync(); } catch { /* best-effort */ } };
  process.on("exit", onExit);
  process.on("SIGTERM", onExit);
  process.on("SIGINT", onExit);

  // 开机自动启动（带重试：credentials 服务可能在插件加载后才就绪）
  void loadConfig().then((cfg) => {
    if (cfg.installDir === undefined || cfg.autoStart === undefined) {
      void saveConfig(defaults).catch(() => {});
    }
    if (cfg.autoStart !== false) {
      const tryStart = (attempt) => {
        startDaemon(ctx).then((result) => {
          if (!result.ok) {
            logAutoStart(attempt, result.error ?? "unknown");
            if (attempt < 5) setTimeout(() => tryStart(attempt + 1), 5000);
          } else {
            logAutoStart(attempt, "started ok");
          }
        }).catch((e) => {
          logAutoStart(attempt, e?.message ?? String(e));
          if (attempt < 5) setTimeout(() => tryStart(attempt + 1), 5000);
        });
      };
      tryStart(0);
    }
  });

  ctx.logger?.info?.(PLUGIN + ": host half active (daemon port " + DAEMON_PORT + ")");
}

export { PLUGIN, apply, name, findDaemonStart, patchDaemonStart, listeningPids };
