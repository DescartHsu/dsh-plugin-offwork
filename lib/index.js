// dsh-plugin-offwork —— 宿主半侧。
// 只做一件事：把 cordis patch 里那份 config 规整成卡片好用的分钟数，
// 用 GET /api/offwork/config 交给浏览器半侧。没有别的路由、没有外部依赖。
const DEFAULTS = {
	workStart: "09:00",
	workEnd: "17:40",
	dailySalary: 600,
	workdays: [1, 2, 3, 4, 5],
};

export const inject = ["webServer"];

/** "HH:MM" → 当天第几分钟；不认识的时间落到 fallback。 */
function toMinutes(value, fallback) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ""));
	if (!m) return fallback;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (hour > 24 || minute > 59) return fallback;
	return hour * 60 + minute;
}

/** patch config → 卡片配置（分钟数 + 日薪 + 去重后的工作日）。 */
export function normalize(raw) {
	const src = raw && typeof raw === "object" ? raw : {};
	const start = toMinutes(src.workStart, toMinutes(DEFAULTS.workStart, 9 * 60));
	let end = toMinutes(src.workEnd, toMinutes(DEFAULTS.workEnd, 17 * 60 + 40));
	if (end <= start) end = start + 60;
	const salary = Number(src.dailySalary);
	const days = Array.isArray(src.workdays) && src.workdays.length > 0
		? src.workdays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
		: DEFAULTS.workdays;
	return {
		startMin: start,
		endMin: end,
		dailySalary: Number.isFinite(salary) && salary >= 0 ? salary : DEFAULTS.dailySalary,
		workdays: [...new Set(days)],
	};
}

export function apply(ctx, config) {
	const payload = JSON.stringify(normalize(config));
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/offwork/config",
		handler: (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "method not allowed" }));
				return;
			}
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			});
			res.end(payload);
		},
	}));
}
