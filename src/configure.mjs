import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILES = ["opencode.jsonc", "opencode.json"];
const OVERLAY_SYSTEM_PATTERN = /^\{file:.*\/dist\/prompts\/[\w-]+\.md\}$/;

/** Turns JSONC into plain JSON by dropping comments and trailing commas outside strings. */
export function stripJsonc(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const end = findStringEnd(source, index);
      output += source.slice(index, end);
      index = end;
    } else if (source.startsWith("//", index)) {
      index = source.indexOf("\n", index) === -1 ? source.length : source.indexOf("\n", index);
    } else if (source.startsWith("/*", index)) {
      index = source.indexOf("*/", index) + 2;
    } else if (char === "," && /^\s*[}\]]/.test(stripLeadingComments(source.slice(index + 1)))) {
      index += 1;
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

function findStringEnd(source, start) {
  let index = start + 1;
  while (source[index] !== '"') index += source[index] === "\\" ? 2 : 1;
  return index + 1;
}

function stripLeadingComments(rest) {
  return rest.replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*/, "");
}

function sameRule(left, right) {
  return left.action === right.action && left.resource === right.resource && left.effect === right.effect;
}

/** Applies the built-in agent overlays to an opencode config, keeping any system prompt the user wrote; returns the names it skipped. */
export function mergeOverlays(config, overlays) {
  config.agents ??= {};
  for (const [name, overlay] of staleKeys(config, overlays)) takeBackAgent(config, name, overlay);
  const skipped = [];
  for (const [name, overlay] of Object.entries(overlays)) {
    const agent = (config.agents[name] ??= {});
    const ownsPrompt = !agent.system || OVERLAY_SYSTEM_PATTERN.test(agent.system);
    if (!ownsPrompt) skipped.push(name);
    else agent.system = overlay.system;
    if (ownsPrompt && overlay.mode && agent.mode === undefined) agent.mode = overlay.mode;
    const rules = (agent.permissions ??= []);
    for (const rule of overlay.permissions) if (!rules.some((existing) => sameRule(existing, rule))) rules.push(rule);
    if (rules.length === 0) delete agent.permissions;
  }
  return skipped;
}

/** Undoes mergeOverlays and the Windows plugin registration, removing only what this project added: an agent whose `system` is the user's own is left exactly as they wrote it, `mode` included. */
export function removeOverlays(config, overlays, pluginEntry) {
  for (const [name, overlay] of [...Object.entries(overlays), ...staleKeys(config, overlays)]) takeBackAgent(config, name, overlay);
  if (config.plugins) config.plugins = config.plugins.filter((plugin) => (typeof plugin === "string" ? plugin : plugin.package) !== pluginEntry);
}

function promptFileOf(system) {
  return typeof system === "string" && OVERLAY_SYSTEM_PATTERN.test(system) ? system.slice(system.lastIndexOf("/") + 1, -1) : undefined;
}

function staleKeys(config, overlays) {
  const overlayByPrompt = new Map(Object.values(overlays).map((overlay) => [promptFileOf(overlay.system), overlay]));
  return Object.entries(config.agents ?? {})
    .filter(([name, agent]) => !(name in overlays) && overlayByPrompt.has(promptFileOf(agent.system)))
    .map(([name, agent]) => [name, overlayByPrompt.get(promptFileOf(agent.system))]);
}

function takeBackAgent(config, name, overlay) {
  const agent = config.agents?.[name];
  if (!agent) return;
  const ownsPrompt = promptFileOf(agent.system) !== undefined;
  if (ownsPrompt) delete agent.system;
  if (agent.permissions) agent.permissions = agent.permissions.filter((rule) => !overlay.permissions.some((ours) => sameRule(ours, rule)));
  if (agent.permissions?.length === 0) delete agent.permissions;
  if (ownsPrompt && overlay.mode && agent.mode === overlay.mode) delete agent.mode;
  if (Object.keys(agent).length === 0) delete config.agents[name];
}

function findConfigFile(opencodeDir) {
  return CONFIG_FILES.map((file) => join(opencodeDir, file)).find((path) => existsSync(path));
}

function updateConfig(opencodeDir, change) {
  const configPath = findConfigFile(opencodeDir) ?? join(opencodeDir, "opencode.json");
  const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : '{ "$schema": "https://opencode.ai/config.json" }';
  const plainJson = stripJsonc(source);
  const config = JSON.parse(plainJson);
  change(config);
  const updated = `${JSON.stringify(config, null, 2)}\n`;
  if (updated === source) return console.log(`${configPath} already up to date`);
  if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.bak`);
  if (plainJson !== source) console.log(`comments and trailing commas in ${configPath} were dropped; the original is at ${configPath}.bak`);
  writeFileSync(configPath, updated);
  console.log(`updated ${configPath}`);
}

/** Patches the user's opencode config with the overlays from dist/, backing the file up before any change. */
export function configure(opencodeDir, overlaysPath) {
  updateConfig(opencodeDir, (config) => {
    const skipped = mergeOverlays(config, JSON.parse(readFileSync(overlaysPath, "utf8")));
    for (const name of skipped) console.log(`kept your own system prompt for "${name}"; add the delegation prompt by hand if you want it`);
  });
}

/** Removes this project's overlays and plugin registration from the user's opencode config, if it has one. */
export function unconfigure(opencodeDir, overlays, pluginEntry) {
  if (!findConfigFile(opencodeDir)) return;
  updateConfig(opencodeDir, (config) => removeOverlays(config, overlays, pluginEntry));
}

if (import.meta.main) {
  const [first, ...rest] = process.argv.slice(2);
  if (first === "--uninstall") {
    const { overlayPatches, pluginEntryURL } = await import("./build.mjs");
    unconfigure(rest[0], overlayPatches(), pluginEntryURL());
  } else {
    configure(first, rest[0]);
  }
}
