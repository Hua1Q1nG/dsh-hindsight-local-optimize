/**
 * dsh-hindsight-local — 本地记忆档案柜开关（浏览器半边）
 *
 * 在侧边栏底部（Settings 上方）渲染一个开关按钮：
 *  - 状态灯：灰=未运行 / 黄=启动中 / 绿=运行中 / 红=启动失败
 *  - 点击切换：开→POST /hindsight-local/start，关→POST /hindsight-local/stop
 *  - 每 3 秒轮询 /hindsight-local/status；启动后持续显示"启动中"直到 daemon 就绪
 *    （冷启动可能要 1-3 分钟），最多等 3 分钟。
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
			const [running, setRunning] = useState(null);   // null = unknown
			const [starting, setStarting] = useState(false); // 启动中（冷启动可能 1-3 分钟）
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);

			const reload = useCallback(async () => {
				try {
					const res = await fetch("/hindsight-local/status", { cache: "no-store" });
					const json = await res.json();
					setRunning(Boolean(json.running));
					setError(json.error ?? null);
				} catch {
					// keep last state
				}
			}, []);

			useEffect(() => {
				reload();
				const timer = setInterval(reload, 3000);
				return () => clearInterval(timer);
			}, [reload]);

			// daemon 起来后自动退出"启动中"
			useEffect(() => {
				if (running === true && starting) setStarting(false);
			}, [running, starting]);

			// 启动最多等 3 分钟，超时回"未运行"
			useEffect(() => {
				if (!starting) return;
				const t = setTimeout(() => setStarting(false), 180000);
				return () => clearTimeout(t);
			}, [starting]);

			const toggle = useCallback(async () => {
				if (busy) return;
				setBusy(true);
				try {
					const target = running ? "stop" : "start";
					const res = await fetch("/hindsight-local/" + target, { method: "POST", cache: "no-store" });
					const json = await res.json().catch(() => ({}));
					if (running) {
						setStarting(false);
						setTimeout(reload, 400);
					} else {
						setError(json.error ?? null);
						setStarting(true);
						reload();
					}
				} finally {
					setBusy(false);
				}
			}, [busy, running, reload]);

			const status = (starting && !running) ? "starting" : (running ? "running" : (error ? "failed" : "stopped"));
			const label = status === "running" ? "运行中" : (status === "starting" ? "启动中…" : (status === "failed" ? "启动失败" : "未运行"));

			return createElement("button", {
				onClick: toggle,
				title: error ? error : (running ? "点击关闭本地记忆（释放内存）" : "点击启动本地记忆（首次启动需下载模型，约 1-3 分钟）"),
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
				)
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
