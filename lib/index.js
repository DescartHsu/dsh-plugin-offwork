// dsh-plugin-offwork —— 宿主半侧。
// 只做一件事：把设置规整成卡片好用的分钟数，用 GET /api/offwork/config 交给浏览器半侧。
// 设置来源三层，后者覆盖前者：内置默认 → cordis patch config → ~/.dsh/offwork.json（每请求现读，
// 所以改完那个文件 60 秒内生效，不用重启）。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULTS = {
	workStart: "09:00",
	workEnd: "17:00",
	monthlySalary: 9000,
	workdaysPerMonth: 22,
	workdays: [1, 2, 3, 4, 5],
};

export const inject = ["webServer"];

const OVERRIDE_FILE = join(homedir(), ".dsh", "offwork.json");

/** 可选的用户设置文件；不存在/写坏了就当没有。 */
export function readOverride() {
	try {
		const parsed = JSON.parse(readFileSync(OVERRIDE_FILE, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

/** "HH:MM" → 当天第几分钟；不认识的时间落到 fallback。 */
function toMinutes(value, fallback) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ""));
	if (!m) return fallback;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (hour > 24 || minute > 59) return fallback;
	return hour * 60 + minute;
}

/** 月薪÷月工作日换算日薪；没有月薪字段时退回 dailySalary 字段。 */
function resolveDailySalary(src, fallbackDaily) {
	const monthly = Number(src.monthlySalary);
	const perMonth = Number(src.workdaysPerMonth);
	if (Number.isFinite(monthly) && monthly > 0 && Number.isFinite(perMonth) && perMonth > 0) {
		return monthly / perMonth;
	}
	const daily = Number(src.dailySalary);
	return Number.isFinite(daily) && daily >= 0 ? daily : fallbackDaily;
}

/** 设置层（可多份，后者覆盖前者）→ 卡片配置（分钟数 + 日薪 + 去重后的工作日）。 */
export function normalize(...sources) {
	const merged = Object.assign({}, ...sources.filter((s) => s && typeof s === "object"));
	const start = toMinutes(merged.workStart, toMinutes(DEFAULTS.workStart, 9 * 60));
	let end = toMinutes(merged.workEnd, toMinutes(DEFAULTS.workEnd, 17 * 60));
	if (end <= start) end = start + 60;
	const days = Array.isArray(merged.workdays) && merged.workdays.length > 0
		? merged.workdays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
		: DEFAULTS.workdays;
	return {
		startMin: start,
		endMin: end,
		dailySalary: resolveDailySalary(merged, DEFAULTS.monthlySalary / DEFAULTS.workdaysPerMonth),
		workdays: [...new Set(days)],
	};
}

export function apply(ctx, config) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/offwork/config",
		handler: (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "method not allowed" }));
				return;
			}
			// 设置文件每请求现读：用户改 ~/.dsh/offwork.json 不需要重启。
			const payload = JSON.stringify(normalize(config, readOverride()));
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			});
			res.end(payload);
		},
	}));
}
