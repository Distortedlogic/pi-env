# pi-project-env

Load global and trusted project environment files into the pi process. No build step.

## Install

Replace `@pi-lab/env`; do not run both loaders:

```sh
pi remove npm:@pi-lab/env
pi install /home/entropybender/repos/pi-project-env
```

Restart pi once after the replacement. This clears values left by the old loader.

## Files and precedence

On `session_start`, values are selected in this order, highest priority first:

1. Variables already in the pi process, including inherited shell variables.
2. Trusted project `<cwd>/.pi/settings.json` → `env`.
3. Global `~/.pi/agent/settings.json` → `env`.
4. Trusted project `<cwd>/.env`.
5. Global `~/.pi/agent/.env`.

The global directory follows pi's `getAgentDir()`. The project settings directory follows `CONFIG_DIR_NAME`. The project dotenv file is always **`<cwd>/.env`**, not `.pi/.env`. There is no parent-directory search.

Untrusted projects cannot supply project dotenv or settings values. Missing files are ignored. Settings accept string values only. Dotenv syntax is handled by `dotenv`; variable expansion and command execution are not enabled.

The extension removes its own unchanged values on shutdown, including reload and session changes. This lets `/reload` apply file edits and prevents old project values from remaining after a session switch. It leaves inherited values and values changed by other code alone.

All files are read before values are applied. File read and JSON errors stop the load. Error notices contain paths, not file contents or variable values. No environment values are added to chat history.

Loading occurs at `session_start`, not while other extension factories run. Restart pi if another component reads its environment only once at process startup.

**Keep `.env` gitignored. Store secrets in dotenv files, not tracked settings files.**

## Remove

```sh
pi remove /home/entropybender/repos/pi-project-env
```

Then run `/reload` or restart pi.
