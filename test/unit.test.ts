import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyEnvironment, collectEnvironment } from "../src/index.ts";

test("collectEnvironment applies trust and precedence", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-env-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	await Promise.all([mkdir(agentDir), mkdir(project)]);
	await Promise.all([
		writeFile(join(agentDir, ".env"), "SHARED=global-dotenv\nGLOBAL_DOTENV=yes\n"),
		writeFile(join(project, ".env"), "SHARED=project-dotenv\nPROJECT_DOTENV=yes\n"),
	]);

	const trusted = await collectEnvironment(project, agentDir, true);
	assert.deepEqual(Object.fromEntries(trusted.values), {
		SHARED: "project-dotenv",
		GLOBAL_DOTENV: "yes",
		PROJECT_DOTENV: "yes",
	});
	assert.deepEqual(trusted.globalKeys, ["GLOBAL_DOTENV", "SHARED"]);
	assert.deepEqual(trusted.projectKeys, ["PROJECT_DOTENV", "SHARED"]);

	const untrusted = await collectEnvironment(project, agentDir, false);
	assert.deepEqual(Object.fromEntries(untrusted.values), {
		SHARED: "global-dotenv",
		GLOBAL_DOTENV: "yes",
	});
	assert.deepEqual(untrusted.globalKeys, ["GLOBAL_DOTENV", "SHARED"]);
	assert.deepEqual(untrusted.projectKeys, []);
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
