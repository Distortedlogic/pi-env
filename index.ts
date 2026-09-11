import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse } from "dotenv";

const CUSTOM_TYPE = "project-env-keys";

export async function collectEnvironment(cwd: string, agentDir: string, projectTrusted: boolean) {
	const files = [
		{ path: join(agentDir, ".env"), format: "dotenv" as const, scope: "global" as const },
		...(projectTrusted ? [{ path: join(cwd, ".env"), format: "dotenv" as const, scope: "project" as const }] : []),
		{ path: join(agentDir, "settings.json"), format: "settings" as const, scope: "global" as const },
		...(projectTrusted
			? [
					{
						path: join(cwd, CONFIG_DIR_NAME, "settings.json"),
						format: "settings" as const,
						scope: "project" as const,
					},
				]
			: []),
	];
	const values = new Map<string, string>();
	const globalKeys = new Set<string>();
	const projectKeys = new Set<string>();

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
			if (typeof value !== "string") continue;
			values.set(key, value);
			if (file.scope === "global") globalKeys.add(key);
			else projectKeys.add(key);
		}
	}

	return {
		values,
		globalKeys: [...globalKeys].sort(),
		projectKeys: [...projectKeys].sort(),
	};
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
			const environment = await collectEnvironment(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
			for (const [key, value] of environment.values) {
				if (process.env[key] !== undefined) continue;
				process.env[key] = value;
				loaded.set(key, value);
			}

			const hasKeyContext = ctx.sessionManager
				.buildContextEntries()
				.some(
					(entry) =>
						entry.type === "message" && entry.message.role === "custom" && entry.message.customType === CUSTOM_TYPE,
				);
			if (!hasKeyContext && environment.globalKeys.length + environment.projectKeys.length > 0) {
				const content = [
					"Environment variable keys available to commands and tools:",
					"",
					"Global:",
					...(environment.globalKeys.length > 0 ? environment.globalKeys.map((key) => `- ${key}`) : ["- (none)"]),
					"",
					"Project:",
					...(environment.projectKeys.length > 0 ? environment.projectKeys.map((key) => `- ${key}`) : ["- (none)"]),
					"",
					"Values are intentionally omitted.",
				].join("\n");
				pi.sendMessage({ customType: CUSTOM_TYPE, content, display: false }, { triggerTurn: false });
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
