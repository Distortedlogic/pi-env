import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { collectEnvironment } from "../index.ts";

test("collectEnvironment applies file precedence and ignores non-string settings", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-project-env-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	await Promise.all([mkdir(agentDir), mkdir(join(project, CONFIG_DIR_NAME), { recursive: true })]);
	await Promise.all([
		writeFile(join(agentDir, ".env"), "SHARED=global-dotenv\nGLOBAL_DOTENV=yes\n"),
		writeFile(join(project, ".env"), "SHARED=project-dotenv\nPROJECT_DOTENV=yes\n"),
		writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify({ env: { SHARED: "global-settings", GLOBAL_SETTINGS: "yes", IGNORED: 42 } }),
		),
		writeFile(
			join(project, CONFIG_DIR_NAME, "settings.json"),
			JSON.stringify({ env: { SHARED: "project-settings", PROJECT_SETTINGS: "yes" } }),
		),
	]);

	const environment = await collectEnvironment(project, agentDir, true);

	assert.deepEqual(Object.fromEntries(environment.values), {
		SHARED: "project-settings",
		GLOBAL_DOTENV: "yes",
		PROJECT_DOTENV: "yes",
		GLOBAL_SETTINGS: "yes",
		PROJECT_SETTINGS: "yes",
	});
	assert.deepEqual(environment.globalKeys, ["GLOBAL_DOTENV", "GLOBAL_SETTINGS", "SHARED"]);
	assert.deepEqual(environment.projectKeys, ["PROJECT_DOTENV", "PROJECT_SETTINGS", "SHARED"]);
});

test("collectEnvironment does not read project files without trust", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-project-env-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	await Promise.all([mkdir(agentDir), mkdir(join(project, CONFIG_DIR_NAME), { recursive: true })]);
	await Promise.all([
		writeFile(join(agentDir, ".env"), "GLOBAL_ONLY=yes\n"),
		writeFile(join(project, ".env"), "PROJECT_ONLY=no\n"),
		writeFile(join(project, CONFIG_DIR_NAME, "settings.json"), "not json"),
	]);

	const environment = await collectEnvironment(project, agentDir, false);

	assert.deepEqual(Object.fromEntries(environment.values), { GLOBAL_ONLY: "yes" });
	assert.deepEqual(environment.globalKeys, ["GLOBAL_ONLY"]);
	assert.deepEqual(environment.projectKeys, []);
});

test("collectEnvironment reports the path of malformed settings", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-project-env-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	const settingsPath = join(project, CONFIG_DIR_NAME, "settings.json");
	await Promise.all([mkdir(agentDir), mkdir(join(project, CONFIG_DIR_NAME), { recursive: true })]);
	await writeFile(settingsPath, "not json");

	await assert.rejects(collectEnvironment(project, agentDir, true), {
		message: `Cannot load ${settingsPath}. Check its format and read access.`,
	});
});
