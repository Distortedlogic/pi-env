import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, RpcClient } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(codingAgentEntry), "cli.js");

test("Pi loads trusted project environment without replacing existing process values", {
	timeout: 20_000,
}, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-env-e2e-"));
	const agentDir = join(project, "agent");
	const reloadExtensionPath = join(project, "reload-extension.ts");
	await Promise.all([mkdir(join(project, CONFIG_DIR_NAME)), mkdir(agentDir)]);
	const suffix = randomUUID().replaceAll("-", "").toUpperCase();
	const globalKey = `PI_PROJECT_ENV_GLOBAL_${suffix}`;
	const projectKey = `PI_PROJECT_ENV_PROJECT_${suffix}`;
	const preservedKey = `PI_PROJECT_ENV_PRESERVED_${suffix}`;
	await Promise.all([
		writeFile(join(agentDir, ".env"), `${globalKey}=global-only\n`),
		writeFile(join(project, ".env"), `${projectKey}=project-only\n${preservedKey}=from-project\n`),
		writeFile(
			reloadExtensionPath,
			[
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"export default function (pi: ExtensionAPI) {",
				'\tpi.registerCommand("reload-env", {',
				"\t\thandler: async (_args, ctx) => {",
				"\t\t\tawait ctx.reload();",
				"\t\t},",
				"\t});",
				"}",
				"",
			].join("\n"),
		),
	]);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", [preservedKey]: "from-process" },
		args: [
			"--approve",
			"--no-session",
			"--no-extensions",
			"--extension",
			extensionPath,
			"--extension",
			reloadExtensionPath,
		],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();

	const assertSingleKeyContext = async () => {
		const messages = await client.getMessages();
		const keyMessages = messages.filter((message) => message.role === "custom" && message.customType === "pi-env/keys");
		assert.equal(keyMessages.length, 1);
		const keyMessage = keyMessages[0];
		assert.ok(keyMessage);
		if (keyMessage.role !== "custom" || typeof keyMessage.content !== "string") {
			assert.fail("Expected a key-only custom context message");
		}
		for (const key of [globalKey, projectKey, preservedKey]) {
			assert.ok(keyMessage.content.includes(`- ${key}`));
		}
		for (const value of ["global-only", "project-only", "global-reloaded", "project-reloaded", "from-process"]) {
			assert.ok(!keyMessage.content.includes(value));
		}
	};

	await assertSingleKeyContext();
	await Promise.all([
		writeFile(join(agentDir, ".env"), `${globalKey}=global-reloaded\n`),
		writeFile(join(project, ".env"), `${projectKey}=project-reloaded\n${preservedKey}=from-project-reloaded\n`),
	]);
	await client.prompt("/reload-env");
	await assertSingleKeyContext();

	const result = await client.bash(`printf '%s|%s|%s' "$${globalKey}" "$${projectKey}" "$${preservedKey}"`);
	assert.equal(result.exitCode, 0);
	assert.equal(result.output, "global-reloaded|project-reloaded|from-process");
});
