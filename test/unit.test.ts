import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { applyEnvironment, collectEnvironment } from "../src/index.ts";

test("collectEnvironment applies global then project dotenv precedence and ignores settings", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-env-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	await Promise.all([mkdir(agentDir), mkdir(join(project, CONFIG_DIR_NAME), { recursive: true })]);
	await Promise.all([
		writeFile(join(agentDir, ".env"), "SHARED=global-dotenv\nGLOBAL_DOTENV=yes\n"),
		writeFile(join(project, ".env"), "SHARED=project-dotenv\nPROJECT_DOTENV=yes\n"),
		writeFile(join(agentDir, "settings.json"), JSON.stringify({ env: { SHARED: "global-settings" } })),
		writeFile(join(project, CONFIG_DIR_NAME, "settings.json"), "not json"),
	]);

	const environment = await collectEnvironment(project, agentDir, true);

	assert.deepEqual(Object.fromEntries(environment.values), {
		SHARED: "project-dotenv",
		GLOBAL_DOTENV: "yes",
		PROJECT_DOTENV: "yes",
	});
	assert.deepEqual(environment.globalKeys, ["GLOBAL_DOTENV", "SHARED"]);
	assert.deepEqual(environment.projectKeys, ["PROJECT_DOTENV", "SHARED"]);
});

test("collectEnvironment does not read a project dotenv file without trust", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-env-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	await Promise.all([mkdir(agentDir), mkdir(project)]);
	await Promise.all([
		writeFile(join(agentDir, ".env"), "GLOBAL_ONLY=yes\n"),
		writeFile(join(project, ".env"), "PROJECT_ONLY=no\n"),
	]);

	const environment = await collectEnvironment(project, agentDir, false);

	assert.deepEqual(Object.fromEntries(environment.values), { GLOBAL_ONLY: "yes" });
	assert.deepEqual(environment.globalKeys, ["GLOBAL_ONLY"]);
	assert.deepEqual(environment.projectKeys, []);
});

test("applyEnvironment preserves process values and removes only unchanged loaded values", () => {
	const target: NodeJS.ProcessEnv = { PRESERVED: "from-process" };
	const restore = applyEnvironment(
		new Map([
			["PRESERVED", "from-dotenv"],
			["LOADED", "from-dotenv"],
			["CHANGED", "from-dotenv"],
		]),
		target,
	);

	assert.deepEqual(target, {
		PRESERVED: "from-process",
		LOADED: "from-dotenv",
		CHANGED: "from-dotenv",
	});
	target.CHANGED = "changed-later";
	restore();
	assert.deepEqual(target, {
		PRESERVED: "from-process",
		CHANGED: "changed-later",
	});
});
