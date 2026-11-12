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
		const { useEffect, useLayoutEffect, useRef, useState } = react;

		// 取不到宿主配置时的兜底：09:00–17:00、月薪 9000 ÷ 22 天 ≈ 409.09、周一至周五。
		const DEFAULTS = {
			startMin: 9 * 60,
			endMin: 17 * 60,
			dailySalary: 9000 / 22,
			workdays: [1, 2, 3, 4, 5],
		};
		const CONFIG_URL = "/api/offwork/config";
		const CONFIG_POLL_MS = 60 * 1000;
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
				customDailySalary: Number.isFinite(src.customDailySalary) ? src.customDailySalary : null,
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
			const working = cfg.workdays.includes(now.getDay() || 7);
			const elapsed = Math.min(Math.max(minutes - cfg.startMin, 0), total);
			const remainingSec = Math.max(Math.round((cfg.endMin - minutes) * 60), 0);
			// 下班点之后：同一张卡改成从下班时刻起算的加班时长（只计时，不计钱）。
			const overtimeSec = working && minutes > cfg.endMin
				? Math.round((minutes - cfg.endMin) * 60)
				: 0;
			return {
				working,
				overtimeSec,
				countdown: hms(remainingSec),
				progress: total > 0 ? elapsed / total : 0,
				earned: working && total > 0 ? (cfg.dailySalary * elapsed) / total : 0,
			};
		}

		const css = {
			stack: {
				containerType: "inline-size",
				containerName: "offwork-cards",
				display: "flex",
				flexDirection: "column",
				gap: 4,
				width: "100%",
				minWidth: 0,
			},
			card: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "4px 8px",
				borderRadius: 9,
				background: "var(--dsw-alias-bg-layer-2, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l1, rgba(15, 23, 42, 0.07))",
				boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
			},
			icon: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 22,
				height: 22,
				borderRadius: 7,
				flex: "0 0 auto",
				fontSize: 13,
				fontWeight: 700,
				fontFamily: CARD_FONT,
			},
			body: {
				flex: "1 1 auto",
				minWidth: 0,
			},
			label: {
				fontSize: 11,
				lineHeight: "13px",
				color: "var(--dsw-alias-label-tertiary, #6b7280)",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
			},
			value: {
				fontSize: 16,
				lineHeight: "18px",
				fontWeight: 700,
				fontFamily: CARD_FONT,
				fontVariantNumeric: "tabular-nums",
				color: "var(--dsw-alias-label-primary, #111827)",
				whiteSpace: "nowrap",
			},
			valueCompact: {
				fontSize: 14,
				lineHeight: "17px",
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

		/** 下班倒计时卡左侧的时钟图标（加班时换红色）。 */
		function ClockIcon({ stroke }) {
			return jsx("svg", {
				viewBox: "0 0 16 16",
				width: 16,
				height: 16,
				fill: "none",
				stroke: stroke ?? "#d97706",
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
				className: "offwork-progress",
				style: {
					display: "flex",
					alignItems: "flex-end",
					gap: 2,
					height: 16,
					flex: "0 0 auto",
				},
				"aria-hidden": true,
				children: Array.from({ length: BAR_COUNT }, (_, i) =>
					jsx("span", {
						style: {
							width: 2,
							borderRadius: 2,
							height: 4 + Math.round((i / (BAR_COUNT - 1)) * 12),
							background: i < filled
								? "#f59e0b"
								: "color-mix(in srgb, #f59e0b 25%, transparent)",
						},
					}, i)
				),
			});
		}

		/** 一张统计卡：图标 + 小标签 + 大数字 + 右侧附注。 */
		function StatCard({ tint, icon, label, labelColor, value, unit, aside, compact }) {
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
						jsx("div", {
							style: labelColor ? { ...css.label, color: labelColor } : css.label,
							children: label,
						}),
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

		/** 取宿主配置；拿不到就一直用兜底值，每 60 秒重取（改 ~/.dsh/offwork.json 不用重启）。 */
		function useConfig() {
			const [cfg, setCfg] = useState(null);
			const revision = useRef(0);
			function acceptSaved(raw) {
				revision.current++;
				setCfg(normalize(raw));
			}
			useEffect(() => {
				let alive = true;
				const load = () => {
					const request = ++revision.current;
					fetch(CONFIG_URL, { cache: "no-store" })
						.then((res) => (res.ok ? res.json() : null))
						.then((raw) => {
							if (alive && raw && request === revision.current) setCfg(normalize(raw));
						})
						.catch(() => {});
				};
				load();
				const timer = setInterval(load, CONFIG_POLL_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, []);
			return [cfg, acceptSaved];
		}

		function clockTime(minutes) {
			return hms((minutes % 1440) * 60).slice(0, 5);
		}

		function SettingsDialog({ cfg, onSaved, onClose }) {
			const dialogRef = useRef(null);
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState("");
			useLayoutEffect(() => {
				const dialog = dialogRef.current;
				dialog.showModal();
				return () => dialog.close();
			}, []);

			async function submit(event) {
				event.preventDefault();
				const form = new FormData(event.currentTarget);
				const workStart = form.get("workStart");
				const workEnd = form.get("workEnd") === "00:00" ? "24:00" : form.get("workEnd");
				if (workEnd <= workStart) {
					setError("下班时间须晚于上班时间。");
					return;
				}
				const amount = form.get("dailySalary");
				setError("");
				setBusy(true);
				try {
					const res = await fetch(CONFIG_URL, {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ workStart, workEnd, dailySalary: amount === "" ? null : Number(amount) }),
					});
					const data = await res.json();
					if (!res.ok) throw Error(data.error || "保存失败。");
					onSaved(data);
					onClose();
				} catch (cause) {
					setError(cause.message || "保存失败，请重试。");
					setBusy(false);
				}
			}

			const field = (label, name, options) => jsxs("label", {
				style: { display: "grid", gap: 4 },
				children: [label, jsx("input", { name, disabled: busy, ...options,
					style: { font: "inherit", padding: "5px 8px", minWidth: 0 } })],
			});
			return jsx("dialog", {
				ref: dialogRef, "aria-label": "工时与日薪设置",
				onCancel: event => { event.preventDefault(); if (!busy) onClose(); },
				style: { margin: "auto", width: "min(290px, 90vw)", boxSizing: "border-box",
					padding: 18, border: "1px solid var(--dsw-alias-border-l1, #ddd)", borderRadius: 12,
					background: css.card.background, color: css.value.color },
				children: jsxs("form", { onSubmit: submit, style: { display: "grid", gap: 10, fontSize: 13 }, children: [
					jsx("strong", { children: "工时与日薪设置" }),
					field("上班时间", "workStart", { type: "time", required: true, defaultValue: clockTime(cfg.startMin) }),
					field("下班时间", "workEnd", { type: "time", required: true, defaultValue: clockTime(cfg.endMin) }),
					field("日薪（元）", "dailySalary", { type: "number", min: 0, step: "any",
						placeholder: cfg.dailySalary.toFixed(2), defaultValue: cfg.customDailySalary ?? "" }),
					jsx("small", { children: "日薪留空时沿用原配置。下班时间 00:00 表示当天结束。" }),
					error && jsx("div", { role: "alert", children: error }),
					jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10 }, children: [
						jsx("button", { type: "button", disabled: busy, onClick: onClose, children: "取消" }),
						jsx("button", { type: "submit", disabled: busy, children: busy ? "保存中…" : "保存" }),
					] }),
				] }),
			});
		}

		/** 两张卡片：下班倒计时 + 今日已赚。 */
		function OffworkCard({ wide }) {
			const [loaded, acceptSaved] = useConfig();
			const cfg = loaded || DEFAULTS;
			const [editing, setEditing] = useState(false);
			const [now, setNow] = useState(() => Date.now());
			useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 1000);
				return () => clearInterval(timer);
			}, []);

			const state = compute(new Date(now), cfg);
			const compact = wide === false;
			const overtime = state.overtimeSec > 0;
			const countdownLabel = !state.working
				? "今天不上班"
				: overtime
					? "已加班"
					: "下班还有";
			const countdownValue = !state.working ? "—" : overtime ? hms(state.overtimeSec) : state.countdown;
			const earnedLabel = "今日已赚";
			const earnedValue = state.earned.toFixed(2);

			return jsxs("div", { style: css.stack, children: [
				jsx("style", { children: `
					@container offwork-cards (max-width: 210px) {
						.offwork-progress { display: none !important; }
					}
					@container offwork-cards (max-width: 165px) {
						.offwork-daily { display: none; }
					}
				` }),
				jsx(StatCard, {
					tint: overtime ? "rgba(239, 68, 68, 0.14)" : "rgba(245, 158, 11, 0.14)",
					icon: jsx(ClockIcon, { stroke: overtime ? "#dc2626" : "#d97706" }),
					label: countdownLabel,
					labelColor: overtime ? "#dc2626" : undefined,
					value: countdownValue,
					aside: jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
						compact ? null : jsx(DayBars, { progress: state.progress }),
						jsx("button", { type: "button", disabled: !loaded, onClick: () => setEditing(true),
							"aria-label": "工时与日薪设置", "aria-haspopup": "dialog",
							title: loaded ? "工时与日薪设置" : "正在等候宿主配置",
							style: { fontSize: 11, whiteSpace: "nowrap", padding: "3px 4px", color: css.aside.color,
								borderRadius: 4, border: 0, background: "transparent", cursor: "pointer" },
							children: "设置" }),
					] }),
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
						: jsxs("div", { className: "offwork-daily", style: css.aside, children: [
							jsx("div", { style: css.asideTop, children: "日薪" }),
							jsx("div", { style: css.asideValue, children: `¥${cfg.dailySalary.toFixed(2)}` }),
						] }),
					compact,
				}),
				editing && jsx(SettingsDialog, { cfg, onSaved: acceptSaved, onClose: () => setEditing(false) }),
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
