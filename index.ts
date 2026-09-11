import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse } from "dotenv";

export async function collectEnvironment(cwd: string, agentDir: string, projectTrusted: boolean) {
	const files = [
		{ path: join(agentDir, ".env"), format: "dotenv" as const },
		...(projectTrusted ? [{ path: join(cwd, ".env"), format: "dotenv" as const }] : []),
		{ path: join(agentDir, "settings.json"), format: "settings" as const },
		...(projectTrusted ? [{ path: join(cwd, CONFIG_DIR_NAME, "settings.json"), format: "settings" as const }] : []),
	];
	const values = new Map<string, string>();

	for (const file of files) {
		let contents: string;
		try {
			contents = await readFile(file.path, "utf8");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
			throw new Error(`Cannot load ${file.path}. Check its format and read access.`, { cause: error });
		}

		let parsed: unknown;
		try {
			parsed = file.format === "settings" ? (JSON.parse(contents) as { env?: unknown } | null)?.env : parse(contents);
		} catch (error) {
			throw new Error(`Cannot load ${file.path}. Check its format and read access.`, { cause: error });
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") values.set(key, value);
		}
	}

	return values;
}

export default function (pi: ExtensionAPI) {
	const loaded = new Map<string, string>();

	const restore = () => {
		for (const [key, value] of loaded) {
			if (process.env[key] === value) delete process.env[key];
		}
		loaded.clear();
	};

	pi.on("session_shutdown", restore);
	pi.on("session_start", async (_event, ctx) => {
		restore();
		try {
			const values = await collectEnvironment(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
			for (const [key, value] of values) {
				if (process.env[key] !== undefined) continue;
				process.env[key] = value;
				loaded.set(key, value);
			}
		} catch (error) {
			restore();
			const message = error instanceof Error ? error.message : "Cannot apply environment variables.";
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
			throw error;
		}
	});
}
