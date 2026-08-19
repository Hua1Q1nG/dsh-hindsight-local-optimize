/**
 * dsh-hindsight-local — 本地记忆档案柜开关（浏览器半边）
 *
 * 在侧边栏底部（Settings 上方）渲染一个开关按钮：
 *  - 状态灯：灰=未运行 / 黄=启动中 / 绿=运行中 / 红=启动失败
 *  - 点击切换：开→POST /hindsight-local/start，关→POST /hindsight-local/stop
 *  - 每 3 秒轮询 /hindsight-local/status；状态以宿主返回的 status 为准，
 *    宿主会透传启动失败原因（error），失败时立即变红并给出提示。
 */
window.__ModuleLoader__.load({
	id: "dsh-hindsight-local",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var createElement = react.createElement;
		var Fragment = react.Fragment;
		var useState = react.useState;
		var useEffect = react.useEffect;
		var useCallback = react.useCallback;

		const name = "hindsight-local";
		const inject = ["slots", "locale"];
		const NS = "hindsight-local";
		const PLUGIN = "dsh-hindsight-local";

		const zh = {
			"title": "本地记忆",
			"running": "运行中",
			"stopped": "未运行",
			"starting": "启动中",
			"failed": "启动失败",
			"hintOn": "点击关闭（释放内存）",
			"hintOff": "点击启动本地记忆"
		};
		const en = {
			"title": "Local Memory",
			"running": "Running",
			"stopped": "Stopped",
			"starting": "Starting",
			"failed": "Failed",
			"hintOn": "Click to stop (free memory)",
			"hintOff": "Click to start local memory"
		};

		const COLOR = {
			stopped: "#9aa0a6",
			starting: "#f5b944",
			running: "#2ecc71",
			failed: "#e5484d"
		};

		function Toggle() {
			const [status, setStatus] = useState("stopped"); // running/starting/failed/stopped
			const [error, setError] = useState(null);
			const [busy, setBusy] = useState(false);

			const reload = useCallback(async () => {
				try {
					const res = await fetch("/hindsight-local/status", { cache: "no-store" });
					const json = await res.json();
					setError(json.error ?? null);
					setStatus(json.status ?? (json.running ? "running" : "stopped"));
				} catch {
					// keep last state
				}
			}, []);

			useEffect(() => {
				reload();
				const timer = setInterval(reload, 3000);
				return () => clearInterval(timer);
			}, [reload]);

			const toggle = useCallback(async () => {
				if (busy) return;
				setBusy(true);
				try {
					const target = status === "running" ? "stop" : "start";
					const res = await fetch("/hindsight-local/" + target, { method: "POST", cache: "no-store" });
					const json = await res.json().catch(() => ({}));
					if (target === "stop") {
						setError(null);
						setStatus("stopped");
					} else {
						setError(json.error ?? null);
						setStatus(json.error ? "failed" : "starting");
					}
					setTimeout(reload, 400);
				} finally {
					setBusy(false);
				}
			}, [busy, status, reload]);

			const label =
				status === "running" ? "运行中" :
				status === "starting" ? "启动中…" :
				status === "failed" ? "启动失败" : "未运行";

			return createElement("button", {
				onClick: toggle,
				title: error ? error : (status === "running" ? "点击关闭本地记忆（释放内存）" : "点击启动本地记忆（首次启动需下载模型，约 1-3 分钟）"),
				style: {
					boxSizing: "border-box",
					width: "100%",
					display: "flex",
					alignItems: "center",
					gap: 7,
					padding: "7px 10px",
					borderRadius: 10,
					border: "1px solid rgba(128,128,128,0.25)",
					background: "transparent",
					cursor: busy ? "wait" : "pointer",
					fontSize: 12,
					color: "inherit"
				}
			},
				createElement("span", {
					style: {
						width: 8, height: 8, flex: "none", borderRadius: "50%",
						background: COLOR[status],
						boxShadow: status === "running" ? "0 0 6px rgba(46,204,113,0.8)" : "none"
					}
				}),
				createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" } },
					"本地记忆" + (label ? " · " + label : "")
				),
				status === "failed" ? createElement("span", {
					title: error ?? "启动失败",
					style: { flex: "none", color: "#e5484d", fontSize: 11, fontWeight: 600, cursor: "help" }
				}, "⚠") : null
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), PLUGIN + ": dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "hindsight-local",
				order: 110,
				label: () => "本地记忆",
				locale: NS
			}, Toggle));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return exports;
	}
});
