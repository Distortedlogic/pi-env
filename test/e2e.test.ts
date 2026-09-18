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
	await Promise.all([mkdir(join(project, CONFIG_DIR_NAME)), mkdir(agentDir)]);
	const suffix = randomUUID().replaceAll("-", "").toUpperCase();
	const sharedKey = `PI_PROJECT_ENV_SHARED_${suffix}`;
	const globalKey = `PI_PROJECT_ENV_GLOBAL_${suffix}`;
	const projectKey = `PI_PROJECT_ENV_PROJECT_${suffix}`;
	const preservedKey = `PI_PROJECT_ENV_PRESERVED_${suffix}`;
	await Promise.all([
		writeFile(join(agentDir, ".env"), `${sharedKey}=from-global\n${globalKey}=global-only\n`),
		writeFile(
			join(project, ".env"),
			`${sharedKey}=from-project\n${projectKey}=project-only\n${preservedKey}=from-project\n`,
		),
	]);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", [preservedKey]: "from-process" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();

	const messages = await client.getMessages();
	const keyMessages = messages.filter((message) => message.role === "custom" && message.customType === "pi-env/keys");
	assert.equal(keyMessages.length, 1);
	const keyMessage = keyMessages[0];
	assert.ok(keyMessage);
	if (keyMessage.role !== "custom" || typeof keyMessage.content !== "string") {
		assert.fail("Expected a key-only custom context message");
	}
	assert.ok(keyMessage.content.includes("Global:"));
	assert.ok(keyMessage.content.includes("Project:"));
	for (const key of [sharedKey, globalKey, projectKey, preservedKey]) {
		assert.ok(keyMessage.content.includes(`- ${key}`));
	}
	for (const value of ["from-global", "global-only", "from-project", "project-only", "from-process"]) {
		assert.ok(!keyMessage.content.includes(value));
	}

	const result = await client.bash(
		`printf '%s|%s|%s|%s' "$${sharedKey}" "$${globalKey}" "$${projectKey}" "$${preservedKey}"`,
	);
	assert.equal(result.exitCode, 0);
	assert.equal(result.output, "from-project|global-only|project-only|from-process");
});
