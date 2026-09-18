import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse } from "dotenv";

const CUSTOM_TYPE = "pi-env/keys";

export async function collectEnvironment(cwd: string, agentDir: string, projectTrusted: boolean) {
	const files = [
		{ path: join(agentDir, ".env"), scope: "global" as const },
		...(projectTrusted ? [{ path: join(cwd, ".env"), scope: "project" as const }] : []),
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

		let parsed: Record<string, string>;
		try {
			parsed = parse(contents);
		} catch (error) {
			throw new Error(`Cannot load ${file.path}. Check its format and read access.`, { cause: error });
		}
		for (const [key, value] of Object.entries(parsed)) {
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

export function applyEnvironment(
	values: ReadonlyMap<string, string>,
	target: NodeJS.ProcessEnv = process.env,
): () => void {
	const loaded = new Map<string, string>();
	for (const [key, value] of values) {
		if (target[key] !== undefined) continue;
		target[key] = value;
		loaded.set(key, value);
	}
	return () => {
		for (const [key, value] of loaded) {
			if (target[key] === value) delete target[key];
		}
		loaded.clear();
	};
}

export default function (pi: ExtensionAPI) {
	let restore = () => {};

	pi.on("session_shutdown", () => restore());
	pi.on("session_start", async (_event, ctx) => {
		restore();
		try {
			const environment = await collectEnvironment(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
			restore = applyEnvironment(environment.values);

			const hasKeyContext = ctx.sessionManager
				.buildContextEntries()
				.some((entry) => entry.type === "custom_message" && entry.customType === CUSTOM_TYPE);
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
