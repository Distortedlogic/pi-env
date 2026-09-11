import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, RpcClient } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(codingAgentEntry), "cli.js");

test("Pi loads trusted project environment without replacing existing process values", {
	timeout: 20_000,
}, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-project-env-e2e-"));
	await mkdir(join(project, CONFIG_DIR_NAME));
	const suffix = randomUUID().replaceAll("-", "").toUpperCase();
	const loadedKey = `PI_PROJECT_ENV_LOADED_${suffix}`;
	const preservedKey = `PI_PROJECT_ENV_PRESERVED_${suffix}`;
	await Promise.all([
		writeFile(join(project, ".env"), `${loadedKey}=from-dotenv\n${preservedKey}=from-project\n`),
		writeFile(
			join(project, CONFIG_DIR_NAME, "settings.json"),
			JSON.stringify({ env: { [loadedKey]: "from-settings" } }),
		),
	]);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1", [preservedKey]: "from-process" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();

	const result = await client.bash(`printf '%s|%s' "$${loadedKey}" "$${preservedKey}"`);

	assert.equal(result.exitCode, 0);
	assert.equal(result.output, "from-settings|from-process");
});
