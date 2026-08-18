// dsh-hindsight-local 看门狗：独立进程，监控 DSH 主进程是否退出；退出则杀掉守护进程并自身退出。
// 由宿主半边在 startDaemon 时 spawn（detached，不依赖 harness-node 的生命周期）。
// 参数：--ppid <DSH主进程PID> --port <守护进程端口，默认9077>
import { execFileSync } from "node:child_process";

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const ppid = parseInt(arg("ppid") ?? "", 10);
const port = parseInt(arg("port") ?? "9077", 10);

function isAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killDaemonOnPort(p) {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const portRe = new RegExp(":" + p + "(?=\\s|$)", "i");
    for (const line of out.split(/\r?\n/)) {
      if (portRe.test(line) && /LISTENING/i.test(line)) {
        const pid = line.trim().split(/\s+/).pop();
        if (/^\d+$/.test(pid)) {
          try { execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
        }
      }
    }
  } catch {}
}

// 主循环：每 2 秒检查 DSH 主进程
setInterval(() => {
  if (!isAlive(ppid)) {
    killDaemonOnPort(port);
    process.exit(0);
  }
}, 2000);
