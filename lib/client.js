// dsh-plugin-offwork —— 浏览器半侧。
// 手写 bundle，无构建步骤：整个包由 window.__ModuleLoader__.load 注册，
// factory 里只 require 平台模块（react / react/jsx-runtime），
// 宿主配置经 GET /api/offwork/config 取回，卡片每秒重算一次。
window.__ModuleLoader__.load({
	id: "dsh-plugin-offwork",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");
		const { useEffect, useState } = react;

		// 取不到宿主配置时的兜底：09:00–17:40、日薪 600、周一至周五。
		const DEFAULTS = {
			startMin: 9 * 60,
			endMin: 17 * 60 + 40,
			dailySalary: 600,
			workdays: [1, 2, 3, 4, 5],
		};
		const CONFIG_URL = "/api/offwork/config";
		const BAR_COUNT = 12;
		const CARD_FONT = "var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)";

		/** 宿主 JSON → 卡片配置；字段缺失/离谱时逐项落回默认值。 */
		function normalize(raw) {
			const src = raw && typeof raw === "object" ? raw : {};
			const start = Number.isFinite(+src.startMin) ? Math.min(Math.max(Math.floor(+src.startMin), 0), 1440) : DEFAULTS.startMin;
			let end = Number.isFinite(+src.endMin) ? Math.min(Math.max(Math.floor(+src.endMin), 0), 1440) : DEFAULTS.endMin;
			if (end <= start) end = Math.min(start + 60, 1440);
			const salary = Number(src.dailySalary);
			const days = Array.isArray(src.workdays)
				? src.workdays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
				: [];
			return {
				startMin: start,
				endMin: end,
				dailySalary: Number.isFinite(salary) && salary >= 0 ? salary : DEFAULTS.dailySalary,
				workdays: days.length > 0 ? [...new Set(days)] : DEFAULTS.workdays,
			};
		}

		/** 秒 → HH:MM:SS。 */
		function hms(totalSeconds) {
			const h = Math.floor(totalSeconds / 3600);
			const m = Math.floor((totalSeconds % 3600) / 60);
			const s = totalSeconds % 60;
			const pad = (n) => String(n).padStart(2, "0");
			return `${pad(h)}:${pad(m)}:${pad(s)}`;
		}

		/** 时刻 + 配置 → 两张卡要显示的一切（纯计算，便于自测）。 */
		function compute(now, cfg) {
			const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
			const total = cfg.endMin - cfg.startMin;
			const working = cfg.workdays.includes(now.getDay());
			const elapsed = Math.min(Math.max(minutes - cfg.startMin, 0), total);
			const remainingSec = Math.max(Math.round((cfg.endMin - minutes) * 60), 0);
			return {
				working,
				off: working && remainingSec <= 0,
				countdown: hms(remainingSec),
				progress: total > 0 ? elapsed / total : 0,
				earned: working && total > 0 ? (cfg.dailySalary * elapsed) / total : 0,
			};
		}

		const css = {
			stack: {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				width: "100%",
				minWidth: 0,
			},
			card: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "9px 12px",
				borderRadius: 14,
				background: "var(--dsw-alias-bg-layer-2, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l1, rgba(15, 23, 42, 0.07))",
				boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
			},
			icon: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 30,
				height: 30,
				borderRadius: 10,
				flex: "0 0 auto",
				fontSize: 15,
				fontWeight: 700,
				fontFamily: CARD_FONT,
			},
			body: {
				flex: "1 1 auto",
				minWidth: 0,
			},
			label: {
				fontSize: 11,
				lineHeight: "14px",
				color: "var(--dsw-alias-label-tertiary, #6b7280)",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
			},
			value: {
				fontSize: 22,
				lineHeight: "27px",
				fontWeight: 700,
				fontFamily: CARD_FONT,
				fontVariantNumeric: "tabular-nums",
				color: "var(--dsw-alias-label-primary, #111827)",
				whiteSpace: "nowrap",
			},
			valueCompact: {
				fontSize: 17,
				lineHeight: "22px",
			},
			unit: {
				marginLeft: 3,
				fontSize: 12,
				fontWeight: 600,
				color: "var(--dsw-alias-label-tertiary, #6b7280)",
			},
			aside: {
				flex: "0 0 auto",
				textAlign: "right",
				color: "var(--dsw-alias-label-secondary, #4b5563)",
			},
			asideTop: {
				fontSize: 10,
				lineHeight: "13px",
			},
			asideValue: {
				fontSize: 13,
				lineHeight: "17px",
				fontWeight: 700,
				fontFamily: CARD_FONT,
				fontVariantNumeric: "tabular-nums",
			},
		};

		/** 下班倒计时卡左侧的时钟图标。 */
		function ClockIcon() {
			return jsx("svg", {
				viewBox: "0 0 16 16",
				width: 16,
				height: 16,
				fill: "none",
				stroke: "#d97706",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				children: jsxs("g", {
					children: [
						jsx("circle", { cx: 8, cy: 8, r: 5.8 }),
						jsx("path", { d: "M8 4.7V8l2.3 1.5" }),
					],
				}),
			});
		}

		/** 进度迷你柱图：第 i 根柱子代表工作日进度的 i/BAR_COUNT。 */
		function DayBars({ progress }) {
			const filled = Math.round(Math.min(Math.max(progress, 0), 1) * BAR_COUNT);
			return jsxs("div", {
				style: {
					display: "flex",
					alignItems: "flex-end",
					gap: 3,
					height: 22,
					flex: "0 0 auto",
				},
				"aria-hidden": true,
				children: Array.from({ length: BAR_COUNT }, (_, i) =>
					jsx("span", {
						style: {
							width: 3,
							borderRadius: 2,
							height: 6 + Math.round((i / (BAR_COUNT - 1)) * 16),
							background: i < filled
								? "#f59e0b"
								: "color-mix(in srgb, #f59e0b 25%, transparent)",
						},
					}, i)
				),
			});
		}

		/** 一张统计卡：图标 + 小标签 + 大数字 + 右侧附注。 */
		function StatCard({ tint, icon, label, value, unit, aside, compact }) {
			return jsxs("div", {
				style: css.card,
				"data-dsh-plugin": "offwork",
				children: [
					jsx("span", {
						style: { ...css.icon, background: tint },
						"aria-hidden": true,
						children: icon,
					}),
					jsxs("div", { style: css.body, children: [
						jsx("div", { style: css.label, children: label }),
						jsxs("div", {
							style: compact ? { ...css.value, ...css.valueCompact } : css.value,
							children: [
								value,
								unit ? jsx("span", { style: css.unit, children: unit }) : null,
							],
						}),
					] }),
					aside,
				],
			});
		}

		/** 取宿主配置；拿不到就一直用兜底值。 */
		function useConfig() {
			const [cfg, setCfg] = useState(() => ({ ...DEFAULTS }));
			useEffect(() => {
				let alive = true;
				fetch(CONFIG_URL, { cache: "no-store" })
					.then((res) => (res.ok ? res.json() : null))
					.then((raw) => {
						if (alive && raw) setCfg(normalize(raw));
					})
					.catch(() => {});
				return () => {
					alive = false;
				};
			}, []);
			return cfg;
		}

		/** 两张卡片：下班倒计时 + 今日已赚。 */
		function OffworkCard({ wide }) {
			const cfg = useConfig();
			const [now, setNow] = useState(() => Date.now());
			useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 1000);
				return () => clearInterval(timer);
			}, []);

			const state = compute(new Date(now), cfg);
			const compact = wide === false;
			const countdownLabel = !state.working ? "今天不上班" : state.off ? "已下班" : "下班还有";
			const countdownValue = state.working ? state.countdown : "—";
			const earnedLabel = "今日已赚";
			const earnedValue = state.earned.toFixed(2);

			return jsxs("div", { style: css.stack, children: [
				jsx(StatCard, {
					tint: "rgba(245, 158, 11, 0.14)",
					icon: jsx(ClockIcon, {}),
					label: countdownLabel,
					value: countdownValue,
					aside: compact ? null : jsx(DayBars, { progress: state.progress }),
					compact,
				}),
				jsx(StatCard, {
					tint: "rgba(16, 185, 129, 0.14)",
					icon: "¥",
					label: earnedLabel,
					value: earnedValue,
					unit: "¥",
					aside: compact
						? null
						: jsxs("div", { style: css.aside, children: [
							jsx("div", { style: css.asideTop, children: "日薪" }),
							jsx("div", { style: css.asideValue, children: `¥${cfg.dailySalary}` }),
						] }),
					compact,
				}),
			] });
		}

		/** 挂进侧边栏 footer：设置按钮上方，和计费卡同一排位（order 0 排在它后面）。 */
		function apply(ctx) {
			const slots = ctx.slots;
			ctx.effect(() => slots.inject("sidebar.footer.action", () => slots.register({
				name: "sidebar.footer.action",
				id: "offwork-countdown",
				order: 0,
			}, OffworkCard)));
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		// 仅供自测脚本使用，运行时不读它。
		exports.__offwork = { DEFAULTS, normalize, hms, compute, OffworkCard };
		return module.exports;
	},
});
