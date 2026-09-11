import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse } from "dotenv";

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
		const agentDir = getAgentDir();
		const trusted = ctx.isProjectTrusted();
		const files = [
			{ path: join(agentDir, ".env"), settings: false },
			...(trusted ? [{ path: join(ctx.cwd, ".env"), settings: false }] : []),
			{ path: join(agentDir, "settings.json"), settings: true },
			...(trusted ? [{ path: join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"), settings: true }] : []),
		];

		let currentPath = "";
		try {
			const values = new Map<string, string>();
			for (const file of files) {
				currentPath = file.path;
				let contents: string;
				try {
					contents = await readFile(file.path, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
					throw error;
				}

				const parsed: unknown = file.settings
					? (JSON.parse(contents) as { env?: unknown } | null)?.env
					: parse(contents);
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
				for (const [key, value] of Object.entries(parsed)) {
					if (typeof value === "string") values.set(key, value);
				}
			}

			currentPath = "";
			for (const [key, value] of values) {
				if (process.env[key] !== undefined) continue;
				process.env[key] = value;
				loaded.set(key, value);
			}
		} catch (error) {
			restore();
			const message = currentPath
				? `Cannot load ${currentPath}. Check its format and read access.`
				: "Cannot apply environment variables.";
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
			throw error;
		}
	});
}
