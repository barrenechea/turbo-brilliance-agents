# Turbo Brilliance agents

opencode subagents for a development workflow, each bound to one reasoning mode of [Qwen3.8 Flash Next Turbo Brilliance 50x](https://huggingface.co/DavidAU/Qwen3.8-Flash-Next-Abliterated-Uncensored-Turbo-Brilliance-50x-Reasoning-Instruct-GSQ-RCO-GGUF) served by any OpenAI-compatible engine. The modes live in the model's embedded Jinja chat template, not in the server, so the same template extracted from the GGUF works with other Qwen models too. Each role is written once in `roles/`, and the build renders it as an opencode v2 agent.

## How a mode gets selected

The model's chat template switches mode when a **user** message contains `{REASON:<mode>}` (`{REASON:i<mode>}` turns thinking off):

- The tag must be in a user message. In the system prompt it is ignored, so an agent's own prompt cannot select its mode.
- The template keeps the last tagged user message. A tag in the first message therefore stays active for the whole session, through every tool call.
- A tag overrides every request setting.
- Request settings depend on the engine. Some accept `reasoning_effort` (top level or in `chat_template_kwargs`) only as `none`, `low`, `medium` or `high`, mapped to the template's instruct, `low`, `medium` and `xhigh`, and reject mode names such as `house` with a 400 error. The tag is the one way to pick a mode that works on every engine.

So the plugin (`dist/plugin/index.ts`) hooks opencode's session `context` event. On every model call of a mapped agent, it adds the role's tag to the start of the first user message. It touches only requests to the configured provider, and it leaves a prompt alone when it already has a tag, for example one you typed. The plugin changes only the outgoing request, and the template strips the tag before the model sees it.

Compaction has its own hook. There the plugin tags the last user message with `compactionReason` (`ioff`: instruct, no thinking), so it wins over any earlier tag and the summary is written fast.

### A default mode for the whole server

When no tag is present, the template falls back to `default_effort = 'xhigh'` (or `default_effort_instruct = 'medium'` with thinking off). The server-wide default is set by editing those two lines in the template your engine loads (for example an extracted copy passed to llama.cpp with `--jinja --chat-template-file`), not by a request option.

## Workflow

You work in opencode's own primary agents. The install gives them a delegation prompt, so they pick subagents on their own and you never have to name one.

- **`build`** (default): for anything that should end in changed code. It does small things itself, and otherwise plans with `scout`/`planner`, implements with `engineer`/`builder`/`mechanic`, sends failures to `debugger`, always runs `reviewer` before it reports a change as done, and asks `scribe` for commit messages. It tells you in one line which subagent it uses and why.
- **`plan`**: when you want to think before touching code, or to keep a session read-only. It uses `explore`, `scout`, `planner`, `researcher` and `decomposer`, plus the read-only reverse-engineering roles, and it is denied every subagent that can write. Switch to `build` to execute the plan.
- **Reverse Engineering**: the reverse-engineering session. It carries the RE operating procedure and delegates to the ten RE roles. See "Reverse engineering" below.

All three keep running on the default `xhigh` mode (no tag), which suits orchestration.

### One subagent at a time

`maxConcurrentSubagents` (1 by default) matches a server with one slot. The prompts of `build`, `plan` and Reverse Engineering tell the agent to start one subagent, wait for its answer, then decide the next step. The plugin enforces the limit as well: it turns `background` off on every `subagent` call and queues calls until a slot is free. So two subagents requested in the same turn, or from `execute`, still run one after another. Raise the number when your server takes parallel requests, then run `./install.sh` again. Remove the key to switch the limit off. Built-in subagents get cheap modes too (`builtinReasons`): `explore` runs on `low`, and `general` on `logic`.

### Reverse engineering

The RE track (`surveyor`, `analyst`, `unpacker`, `decoder`, `hypothesist`, `prober`, `enumerator`, `verifier`, `registrar`, `explainer`) needs the `reverse-engineer-anything` skill and the `rea` MCP server; its tools reach the agent as `rea_*`. The firmware-region and capture tools call Linux-side helpers (binwalk/unblob, tshark, sigrok-cli) that a macOS host usually lacks; a role that needs a missing helper names it and stops, it never installs one.

To install or update REA, run:

```bash
npx rea-agents@latest setup
```

Choose OpenCode, review the proposed changes and approve them, then restart OpenCode. Setup installs the skill globally in `~/.agents/skills` (OpenCode reads it from there) and registers the `rea` MCP server in the global OpenCode config. Keep REA global: never install the skill into a project's `.agents/` or `.opencode/`. Point the MCP entry at `rea-agents@latest` rather than a pinned version, so each OpenCode start runs the current release. When the skill or the `rea_*` tools are missing, Reverse Engineering and `build` stop and print this command instead of guessing.

The Reverse Engineering primary agent (`roles/re.md`, installed under the config key `"Reverse Engineering"` from its `title`) carries the RE operating procedure and joins the Tab cycle next to `build` and `plan`; like them it runs on the untagged default mode. The install gives it `mode: "primary"` so it stays out of the subagent pool, where `build` or `plan` could otherwise start a second orchestrator on a server with one slot.

## Roles

| Role          | Mode                                 | Mode prompt   | Tools      | Use it for                                                                        |
| ------------- | ------------------------------------ | ------------- | ---------- | --------------------------------------------------------------------------------- |
| `scout`       | `xsocrates`                          | ~245 tokens   | read       | Questioning a vague request, cheap plans for small tasks                          |
| `planner`     | `xdeeptree`                          | ~914          | read       | Three competing designs, one executable plan                                      |
| `decomposer`  | `hyper` (MECE)                       | ~800          | read       | Splitting big work into packages that own separate files                          |
| `researcher`  | `spoon` (deep research panel)        | ~946          | read + web | Comparing libraries and APIs, reading docs, with sources                          |
| `engineer`    | `logic`                              | ~162          | all        | Tool-heavy implementation in existing code                                        |
| `mechanic`    | `ilogic` (no thinking)               | ~162          | all        | Fully specified edits: renames, applying review fixes                             |
| `builder`     | `coder` (DevOracle)                  | ~2,650        | all        | Greenfield modules written in a few tool calls                                    |
| `debugger`    | `xlogic`                             | ~254          | all        | Root cause by causal chain and falsifiable experiments                            |
| `reviewer`    | `house`                              | ~2,900        | read       | Cynical diff review that keeps only findings backed by evidence                   |
| `scribe`      | `ioff` (no thinking, no mode prompt) | 0             | read       | Commit messages, PR bodies, summaries                                             |
| `surveyor`    | `xsocrates`                          | ~245          | read       | First look at an unidentified binary, firmware image or capture                   |
| `analyst`     | `logic`                              | ~162          | read       | What one function in a native binary does, with values and xrefs traced           |
| `unpacker`    | `xlogic`                             | ~254          | read       | Firmware images: region maps, extraction, version and dump diffs                  |
| `decoder`     | `xlogic`                             | ~254          | read       | Numbers and timings out of a wire, bus or logic-analyzer capture                  |
| `hypothesist` | `einstein`                           | ~260 (est.)   | read       | Ranked, falsifiable explanations for one unknown, each with its cheapest test     |
| `prober`      | `xlogic`                             | ~254          | all        | The experiment: bench builds, live probes, the original run side by side          |
| `enumerator`  | `hyper`                              | ~800          | read       | Counted coverage: what is understood, what is not, the boundary searched          |
| `verifier`    | `matlock`                            | ~2,300 (est.) | read       | Adversarial audit of a claim or reconstructed source against the binary           |
| `registrar`   | `ioff` (no thinking, no mode prompt) | 0             | all        | Appending findings to the evidence ledger with their labels and Evidence IDs      |
| `explainer`   | `teacher`                            | ~3,300 (est.) | all        | Protocol and byte-layout write-ups for a reader who will not open the disassembly |

Mode prompt sizes are measured from rendered `prompt_tokens`. They are added to every request in the session, next to the tool schema. That is why the tool-heavy roles use the small modes (`logic`, `xlogic`), and the roughly 2,700-token personas (`coder`, `house`) go to roles that make few, chat-like turns. The `x` modes add the template's xhigh "think carefully" sentence. They are for roles where correctness beats speed. The three figures marked `est.` (`einstein` ~260, `matlock` ~2,300, `teacher` ~3,300) are the exception: estimated from the chat template's own text, not yet measured against rendered `prompt_tokens`.

Read-only roles keep the shell (for `git diff`), with `edit` and `write` denied. No subagent can start another subagent.

## Install

Requires Node 24 or newer, opencode v2, and an OpenAI-compatible server running the model (its URL, and an API key if it needs one).

1. Add the server as a provider in `~/.config/opencode/opencode.json`, if you have not yet:

   ```json
   "provider": {
     "local": {
       "npm": "@ai-sdk/openai-compatible",
       "name": "Local",
       "options": { "baseURL": "http://localhost:8080/v1", "apiKey": "<your key>" },
       "models": {
         "tb-50x": { "name": "Turbo Brilliance 50x", "limit": { "context": 262144, "output": 262144 } }
       }
     }
   }
   ```

2. Clone this repository where it will stay. The opencode config will point at files inside it.

   ```bash
   git clone https://github.com/barrenechea/turbo-brilliance-agents.git ~/Developer/turbo-brilliance-agents
   ```

3. If your provider is not called `sff` with a model `qwen`, create `turbo.config.local.json` next to `turbo.config.json`. It is gitignored, and its keys override the shared file:

   ```json
   { "providerID": "local", "model": "local/tb-50x" }
   ```

4. Install, then restart opencode (or its background service, `opencode service`):

   ```bash
   ./install.sh
   ```

To update, run `git pull`, then `./install.sh` again.

The script:

1. builds `dist/`,
2. links the subagents into `~/.config/opencode/agents/` (and removes links to roles that no longer exist),
3. links the plugin into `~/.config/opencode/plugins/turbo-brilliance.ts`,
4. patches `opencode.jsonc` or `opencode.json` (creating `opencode.json` if neither exists): `agents.build.system`, `agents.plan.system` and `agents.re.system` point at the prompts in `dist/prompts/` via `{file:...}`, `agents.re` gets `mode: "primary"` so it stays out of the subagent pool, and `plan` gets its subagent restrictions. Your other settings stay. An agent whose `system` you wrote yourself is left exactly as you wrote it, `mode` included. Before changing the file, the script saves the old version as `.bak`. Comments in a `.jsonc` file do not survive the rewrite, so the script says so when it happens.

It is idempotent: run it again after a `git pull`, after editing a role, or after moving the clone. Set `OPENCODE_CONFIG_DIR` to install somewhere else. Set `"model": null` in `turbo.config.local.json` to let subagents inherit the parent's model.

### Windows

Run `.\install.ps1` (PowerShell) instead of `./install.sh`. It needs no bash: it uses Node from `PATH`, falling back to the Node bundled with OpenCode Desktop. Differences from the bash flow:

- agents are copied into the config dir instead of symlinked, because creating symlinks needs admin or Developer Mode. Rerun the script after a `git pull` or a role edit to refresh the copies.
- the plugin is registered in the config's `plugins` array instead of linked into `plugins/`.
- while OpenCode runs, its server keeps the files under `dist/plugin` open, so a changed plugin file cannot be rewritten. The build then warns and installs the rest. To update plugin code: close OpenCode, run `.\install.ps1`, and reopen it.

### Uninstall

```bash
./install.sh --uninstall
```

On Windows, run `.\install.ps1 --uninstall`. Either one removes only what the install added:

- the agent links (on Windows, the copies listed in `agents/.turbo-brilliance.json`),
- the plugin link (on Windows, the plugin entry in `plugins`),
- the `{file:...}` prompts on `build`, `plan` and `"Reverse Engineering"`, the subagent rules added to `plan`, and the `mode` written on `"Reverse Engineering"` (the entry is deleted outright when nothing else is left in it). An entry an older install left under another key, such as `agents.re`, is removed the same way, and install moves it to the current key.

Your own agents, plugins and settings stay, and so does any agent whose `system` you wrote yourself: install and uninstall leave that entry alone, `mode` included. The config is saved as `.bak` before the change, and the clone is not deleted. Restart opencode afterwards.

## Layout

```
roles/                 one file per role (frontmatter + prompt); _shared.md is appended to every subagent
                       build.md and plan.md are overlays on opencode's built-in agents; re.md adds the
                       reverse-engineering primary agent
src/reason-tag.ts      the tagging rule
src/opencode-plugin.ts the plugin: mode tags and the subagent limit
src/subagent-slots.ts  the queue behind the limit
src/build.mjs          roles -> dist/agents, dist/prompts, dist/overlays.json, dist/plugin (with settings.json)
src/configure.mjs      merges dist/overlays.json into the opencode config
turbo.config.json      model, provider, compaction mode, subagent limit, modes for built-in subagents
turbo.config.local.json  per-machine overrides (gitignored)
```

Subagent frontmatter: `name`, `description`, `reason` (a template mode, checked at build time), `access` (`read`, `research` or `write`), `steps`, `color`. Overlay frontmatter: `name` (the agent, and the prompt file `dist/prompts/<name>.md`), an optional `title` (the config key, which opencode shows as the agent's name; `re.md` uses `Reverse Engineering`), `overlay: true`, `access` (`read` denies it every subagent that can write), and an optional `mode` (one of `primary`, `subagent`, `all`, checked at build time; `re.md` sets `primary` to keep the RE orchestrator out of the subagent pool).

## Tests

```bash
npm test
```

## Gotchas

- Do not write a literal tag in `AGENTS.md` or in a brief. Their text can end up in a user message (opencode sends instruction updates that way), and the template would then pick up that tag.
- The same rule holds for an RE role's own prompt: no reasoning role file under `roles/` may contain a literal `{REASON:...}` tag, because the rendered prompt can land in a user message. The RE briefs talk about modes and tags in prose, which makes it easy to type one by accident; a test fails the build if any `roles/` file does.
- Cloudflare in front of a server can block some default user agents (error 1010), for example Python's `urllib`.
