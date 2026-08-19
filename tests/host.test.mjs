import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN, name, classifyFailureText, patchDaemonStart } from "../lib/index.js";

test("identity constants", () => {
  assert.equal(PLUGIN, "dsh-hindsight-local");
  assert.equal(name, "hindsight-local");
});

test("classifyFailureText: clean log → null", () => {
  assert.equal(classifyFailureText("INFO: daemon ready at http://127.0.0.1:9077"), null);
  assert.equal(classifyFailureText(""), null);
  assert.equal(classifyFailureText(undefined), null);
});

test("classifyFailureText: model init timeout → 模型加载失败", () => {
  const t = "RuntimeError: Model/connection initialization did not complete within 300s. huggingface.co unreachable";
  assert.equal(classifyFailureText(t), "模型加载失败：无法访问 HuggingFace（离线模式未生效或网络不可达），模型初始化超时");
});

test("classifyFailureText: WinError 10061 → 端口被占用", () => {
  assert.equal(classifyFailureText("WinError 10061 由于目标计算机积极拒绝"), "端口 9077 被占用或服务未就绪");
});

test("classifyFailureText: WinError 10060 → 网络超时", () => {
  assert.equal(classifyFailureText("WinError 10060 连接尝试失败"), "网络连接超时（无法访问 HuggingFace）");
});

test("classifyFailureText: generic startup failure", () => {
  assert.equal(classifyFailureText("ERROR: Application startup failed. Exiting."), "守护进程启动失败（详见 ~/.hindsight/profiles/coding-agent.log）");
});

test("patchDaemonStart: adds windowsHide and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "hindsight-test-"));
  try {
    const f = join(dir, "daemon-start.js");
    writeFileSync(f, 'spawn(cmd, args, { stdio: "pipe", env })', "utf8");
    assert.equal(patchDaemonStart(f), true);
    assert.ok(readFileSync(f, "utf8").includes("windowsHide: true"));
    assert.equal(patchDaemonStart(f), false);
    const g = join(dir, "other.js");
    writeFileSync(g, "no matching pattern here", "utf8");
    assert.equal(patchDaemonStart(g), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
