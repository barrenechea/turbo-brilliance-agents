// Creating symlinks needs admin or Developer Mode on Windows, so agents are copied and the plugin is registered by URL.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./src/build.mjs";
import { configure, stripJsonc } from "./src/configure.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode");

const roles = build();
console.log(`built ${roles.length} roles into ${join(ROOT, "dist")}`);

const agentsDir = join(CONFIG_DIR, "agents");
const distAgents = join(ROOT, "dist", "agents");
mkdirSync(agentsDir, { recursive: true });
const manifestPath = join(agentsDir, ".turbo-brilliance.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const installed = readdirSync(distAgents).filter((file) => file.endsWith(".md"));
for (const stale of previous.filter((file) => !installed.includes(file))) rmSync(join(agentsDir, stale), { force: true });
for (const file of installed) cpSync(join(distAgents, file), join(agentsDir, file));
writeFileSync(manifestPath, `${JSON.stringify(installed, null, 2)}\n`);
console.log(`copied ${installed.length} agents into ${agentsDir}`);

// configure() writes the .bak, so it must run before the plugins write below for the backup to hold the user's own file.
configure(CONFIG_DIR, join(ROOT, "dist", "overlays.json"));

const configFile = ["opencode.jsonc", "opencode.json"].map((file) => join(CONFIG_DIR, file)).find((path) => existsSync(path)) ?? join(CONFIG_DIR, "opencode.json");
const source = readFileSync(configFile, "utf8");
const config = JSON.parse(stripJsonc(source));
config.plugins ??= [];
const entry = pathToFileURL(join(ROOT, "dist", "plugin")).href;
if (!config.plugins.some((plugin) => (typeof plugin === "string" ? plugin : plugin.package) === entry)) {
  config.plugins.push(entry);
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`registered ${entry} in ${configFile}`);
} else {
  console.log(`${configFile} already lists the plugin`);
}
