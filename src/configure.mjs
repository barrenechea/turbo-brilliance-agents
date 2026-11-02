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
  const skipped = [];
  for (const [name, overlay] of Object.entries(overlays)) {
    const agent = (config.agents[name] ??= {});
    if (agent.system && !OVERLAY_SYSTEM_PATTERN.test(agent.system)) skipped.push(name);
    else agent.system = overlay.system;
    const rules = (agent.permissions ??= []);
    for (const rule of overlay.permissions) if (!rules.some((existing) => sameRule(existing, rule))) rules.push(rule);
    if (rules.length === 0) delete agent.permissions;
  }
  return skipped;
}

function findConfigFile(opencodeDir) {
  const existing = CONFIG_FILES.map((file) => join(opencodeDir, file)).find((path) => existsSync(path));
  return existing ?? join(opencodeDir, "opencode.json");
}

/** Patches the user's opencode config with the overlays from dist/, backing the file up before any change. */
export function configure(opencodeDir, overlaysPath) {
  const configPath = findConfigFile(opencodeDir);
  const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : '{ "$schema": "https://opencode.ai/config.json" }';
  const plainJson = stripJsonc(source);
  const config = JSON.parse(plainJson);
  const skipped = mergeOverlays(config, JSON.parse(readFileSync(overlaysPath, "utf8")));
  const updated = `${JSON.stringify(config, null, 2)}\n`;
  for (const name of skipped) console.log(`kept your own system prompt for "${name}"; add the delegation prompt by hand if you want it`);
  if (updated === source) return console.log(`${configPath} already up to date`);
  if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.bak`);
  if (plainJson !== source) console.log(`comments and trailing commas in ${configPath} were dropped; the original is at ${configPath}.bak`);
  writeFileSync(configPath, updated);
  console.log(`updated ${configPath}`);
}

if (import.meta.main) {
  const [opencodeDir, overlaysPath] = process.argv.slice(2);
  configure(opencodeDir, overlaysPath);
}
