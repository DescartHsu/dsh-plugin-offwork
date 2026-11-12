// dsh-plugin-offwork —— 宿主半侧。
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULTS = {
	workStart: "09:00",
	workEnd: "17:00",
	monthlySalary: 9000,
	workdaysPerMonth: 22,
	workdays: [1, 2, 3, 4, 5],
};

export const inject = ["webServer", "connection"];
const OVERRIDE_FILE = join(homedir(), ".dsh", "offwork.json");

export function readOverride(strict = false) {
	try {
		const parsed = JSON.parse(readFileSync(OVERRIDE_FILE, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("配置格式有误");
		return parsed;
	} catch (error) {
		if (strict && error.code !== "ENOENT") throw error;
		return null;
	}
}

function toMinutes(value) {
	const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
	if (!match) return NaN;
	const minutes = Number(match[1]) * 60 + Number(match[2]);
	return minutes <= 1440 ? minutes : NaN;
}

function explicitDaily(value) {
	if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalize(...sources) {
	const merged = { ...DEFAULTS };
	let dailySalary = DEFAULTS.monthlySalary / DEFAULTS.workdaysPerMonth;
	for (const source of sources) {
		if (!source || typeof source !== "object") continue;
		Object.assign(merged, source);
		const daily = explicitDaily(source.dailySalary);
		if (daily !== null) {
			dailySalary = daily;
		} else if ("monthlySalary" in source || "workdaysPerMonth" in source) {
			const monthly = Number(merged.monthlySalary);
			const days = Number(merged.workdaysPerMonth);
			if (Number.isFinite(monthly) && monthly > 0 && Number.isFinite(days) && days > 0) dailySalary = monthly / days;
		}
	}
	const start = toMinutes(merged.workStart);
	const startMin = Number.isFinite(start) && start < 1440 ? start : 540;
	const end = toMinutes(merged.workEnd);
	const endMin = Number.isFinite(end) ? end : 1020;
	const days = Array.isArray(merged.workdays)
		? merged.workdays.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7) : [];
	return {
		startMin,
		endMin: endMin > startMin ? endMin : Math.min(startMin + 60, 1440),
		dailySalary,
		workdays: days.length ? [...new Set(days)] : DEFAULTS.workdays,
	};
}

function configPayload(config, override) {
	return { ...normalize(config, override), customDailySalary: explicitDaily(override?.dailySalary) };
}

async function readSettings(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 4096) throw Error("设置内容过长。");
		chunks.push(chunk);
	}
	let data;
	try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
	catch { throw Error("设置格式有误。"); }
	const { workStart, workEnd, dailySalary } = data || {};
	if (typeof workStart !== "string" || typeof workEnd !== "string" ||
		!(toMinutes(workStart) < toMinutes(workEnd))) throw Error("下班时间须晚于上班时间。");
	if (dailySalary !== null && (typeof dailySalary !== "number" || explicitDaily(dailySalary) === null))
		throw Error("日薪须为非负金额。");
	return { workStart, workEnd, dailySalary };
}

function saveSettings(settings) {
	const override = { ...readOverride(true), ...settings };
	if (settings.dailySalary === null) delete override.dailySalary;
	mkdirSync(dirname(OVERRIDE_FILE), { recursive: true });
	const temp = OVERRIDE_FILE + "." + randomUUID() + ".tmp";
	try {
		writeFileSync(temp, JSON.stringify(override, null, 2) + "\n", { mode: 0o600, flag: "wx" });
		renameSync(temp, OVERRIDE_FILE);
	} finally {
		rmSync(temp, { force: true });
	}
	return override;
}

export function apply(ctx, config) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/offwork/config",
		handler: async (req, res) => {
			const reply = (status, body) => {
				res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
			};
			if (req.method === "GET" || req.method === "HEAD") return reply(200, configPayload(config, readOverride()));
			if (req.method !== "PUT") return reply(405, { error: "method not allowed" });
			const refusal = ctx.connection.requestRejection(req);
			if (refusal !== undefined) return reply(refusal, { error: "此连接无法保存设置。" });
			if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))
				return reply(415, { error: "需要 JSON 格式。" });
			let settings;
			try { settings = await readSettings(req); }
			catch (error) { return reply(400, { error: error.message }); }
			try { return reply(200, configPayload(config, saveSettings(settings))); }
			catch { return reply(500, { error: "保存失败，请检查 ~/.dsh/offwork.json 的格式及写入权限。" }); }
		},
	}));
}
