// Creating symlinks needs admin or Developer Mode on Windows, so agents are copied and the plugin is registered by URL.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, overlayPatches, pluginEntryURL } from "./src/build.mjs";
import { configure, stripJsonc, unconfigure } from "./src/configure.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode");
const AGENTS_DIR = join(CONFIG_DIR, "agents");
const MANIFEST_PATH = join(AGENTS_DIR, ".turbo-brilliance.json");

function readManifest() {
  return existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : [];
}

function install() {
  const roles = build();
  console.log(`built ${roles.length} roles into ${join(ROOT, "dist")}`);

  const distAgents = join(ROOT, "dist", "agents");
  mkdirSync(AGENTS_DIR, { recursive: true });
  const installed = readdirSync(distAgents).filter((file) => file.endsWith(".md"));
  for (const stale of readManifest().filter((file) => !installed.includes(file))) rmSync(join(AGENTS_DIR, stale), { force: true });
  for (const file of installed) cpSync(join(distAgents, file), join(AGENTS_DIR, file));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(installed, null, 2)}\n`);
  console.log(`copied ${installed.length} agents into ${AGENTS_DIR}`);

  // configure() writes the .bak, so it must run before the plugins write below for the backup to hold the user's own file.
  configure(CONFIG_DIR, join(ROOT, "dist", "overlays.json"));

  const configFile = ["opencode.jsonc", "opencode.json"].map((file) => join(CONFIG_DIR, file)).find((path) => existsSync(path)) ?? join(CONFIG_DIR, "opencode.json");
  const config = JSON.parse(stripJsonc(readFileSync(configFile, "utf8")));
  config.plugins ??= [];
  const entry = pluginEntryURL();
  if (config.plugins.some((plugin) => (typeof plugin === "string" ? plugin : plugin.package) === entry)) {
    console.log(`${configFile} already lists the plugin`);
    return;
  }
  config.plugins.push(entry);
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`registered ${entry} in ${configFile}`);
}

function uninstall() {
  const installed = readManifest();
  for (const file of installed) rmSync(join(AGENTS_DIR, file), { force: true });
  rmSync(MANIFEST_PATH, { force: true });
  console.log(`removed ${installed.length} agents from ${AGENTS_DIR}`);
  unconfigure(CONFIG_DIR, overlayPatches(), pluginEntryURL());
}

if (process.argv.includes("--uninstall")) uninstall();
else install();
