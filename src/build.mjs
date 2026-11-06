import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES_DIR = join(ROOT, "roles");
const SRC_DIR = join(ROOT, "src");
const DIST_DIR = join(ROOT, "dist");
const SHARED_RULES_FILE = "_shared.md";

const NO_NESTING = [{ action: "subagent", resource: "*", effect: "deny" }];

const READ_ONLY = [
  ...NO_NESTING,
  { action: "edit", resource: "*", effect: "deny" },
  { action: "write", resource: "*", effect: "deny" },
];

const PERMISSIONS = {
  read: READ_ONLY,
  research: READ_ONLY,
  write: NO_NESTING,
};

const TEMPLATE_MODES = new Set([
  "xomni",
  "xdeeptree",
  "xhyper",
  "xsocrates",
  "xlogic",
  "xhelp",
  "xeinstein",
  "xspoon",
  "omni",
  "deeptree",
  "hyper",
  "socrates",
  "logic",
  "off",
  "help",
  "einstein",
  "spoon",
  "ultra",
  "xhigh",
  "medium",
  "low",
  "holodeck",
  "prompt",
  "pkd",
  "musk",
  "joker",
  "vader",
  "quinn",
  "joe",
  "neo",
  "curie",
  "brainstorm",
  "comedy",
  "business",
  "story",
  "teacher",
  "007",
  "coder",
  "stark",
  "matlock",
  "house",
]);

const INSTRUCT_PREFIX = "i";

const AGENT_MODES = new Set(["primary", "subagent", "all"]);

const WRITING_BUILTIN_SUBAGENTS = ["general"];

const COLORS = {
  red: "#e5484d",
  blue: "#3e63dd",
  green: "#30a46c",
  yellow: "#f5d90a",
  purple: "#8e4ec6",
  orange: "#f76b15",
  pink: "#d6409f",
  cyan: "#05a2c2",
};

function toLf(text) {
  return text.replaceAll("\r\n", "\n");
}

/** Splits a role file into its flat `key: value` frontmatter and its markdown body. */
export function parseRole(source) {
  const match = toLf(source).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("role file needs frontmatter");
  const fields = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separator = line.indexOf(": ");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 2).trim(),
      ];
    }),
  );
  const overlay = fields.overlay === "true";
  if (fields.reason && !isTemplateMode(fields.reason))
    throw new Error(`${fields.name}: unknown reason mode "${fields.reason}"`);
  if (fields.mode && !AGENT_MODES.has(fields.mode))
    throw new Error(`${fields.name}: unknown mode "${fields.mode}"`);
  if (fields.mode && !overlay)
    throw new Error(`${fields.name}: mode is only valid on an overlay`);
  if (fields.title && !overlay)
    throw new Error(`${fields.name}: title is only valid on an overlay`);
  return {
    ...fields,
    // Unset stays unset so renderAgent omits the key (unlimited steps); a declared value still converts.
    steps: fields.steps === undefined ? undefined : Number(fields.steps),
    overlay,
    body: match[2].trim(),
  };
}

/** Mirrors the chat template's check: a known mode, optionally prefixed with "i" for instruct (no thinking). */
export function isTemplateMode(reason) {
  if (TEMPLATE_MODES.has(reason)) return true;
  return (
    reason.startsWith(INSTRUCT_PREFIX) &&
    TEMPLATE_MODES.has(reason.slice(INSTRUCT_PREFIX.length))
  );
}

function loadRoles() {
  const sharedRules = toLf(
    readFileSync(join(ROLES_DIR, SHARED_RULES_FILE), "utf8"),
  ).trim();
  return readdirSync(ROLES_DIR)
    .filter((file) => file.endsWith(".md") && file !== SHARED_RULES_FILE)
    .map((file) => parseRole(readFileSync(join(ROLES_DIR, file), "utf8")))
    .map((role) =>
      role.overlay ? role : { ...role, body: `${role.body}\n\n${sharedRules}` },
    );
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/** Reads turbo.config.json with the machine's gitignored turbo.config.local.json on top; nested objects merge one level deep. */
export function loadConfig(root = ROOT) {
  const shared = readJson(join(root, "turbo.config.json"));
  const local = readJson(join(root, "turbo.config.local.json"));
  const merged = { ...shared, ...local };
  for (const [key, value] of Object.entries(local)) {
    if (value && typeof value === "object" && !Array.isArray(value))
      merged[key] = { ...shared[key], ...value };
  }
  return merged;
}

function loadBuiltinReasons(config) {
  const builtins = config.builtinReasons ?? {};
  const invalid = Object.entries(builtins).filter(
    ([, reason]) => !isTemplateMode(reason),
  );
  if (invalid.length > 0)
    throw new Error(
      `unknown builtin reason modes: ${JSON.stringify(Object.fromEntries(invalid))}`,
    );
  return builtins;
}

function toYaml(fields, indent = "") {
  return Object.entries(fields)
    .filter(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        !(Array.isArray(value) && value.length === 0),
    )
    .map(([key, value]) => {
      if (!Array.isArray(value))
        return `${indent}${key}: ${JSON.stringify(value)}`;
      const items = value.map((item) =>
        toYaml(item, `${indent}    `).replace(/^\s+/, `${indent}  - `),
      );
      return `${indent}${key}:\n${items.join("\n")}`;
    })
    .join("\n");
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  writeFileSync(path, content);
}

function copyFile(src, dest) {
  if (
    existsSync(dest) &&
    readFileSync(dest, "utf8") === readFileSync(src, "utf8")
  )
    return;
  copyFileSync(src, dest);
}

function renderAgent(role, config) {
  const fields = {
    description: role.description,
    mode: "subagent",
    model: config.model,
    steps: role.steps,
    color: COLORS[role.color],
    permissions: PERMISSIONS[role.access],
  };
  return `---\n${toYaml(fields)}\n---\n\n${role.body}\n`;
}

function renderOverlays(roles) {
  const writers = [
    ...roles
      .filter((role) => !role.overlay && role.access === "write")
      .map((role) => role.name),
    ...WRITING_BUILTIN_SUBAGENTS,
  ];
  const overlays = roles
    .filter((role) => role.overlay)
    .map((role) => [
      role.title ?? role.name,
      {
        system: `{file:${join(DIST_DIR, "prompts", `${role.name}.md`).replaceAll("\\", "/")}}`,
        permissions:
          role.access === "write"
            ? []
            : writers.map((writer) => ({
                action: "subagent",
                resource: writer,
                effect: "deny",
              })),
        ...(role.mode ? { mode: role.mode } : {}),
      },
    ]);
  return Object.fromEntries(overlays);
}

/** Returns the config patches for the built-in agents, computed from the roles without writing dist/. */
export function overlayPatches() {
  return renderOverlays(loadRoles());
}

/** Returns the file URL under which the Windows installer registers the plugin in the config's plugins array. */
export function pluginEntryURL() {
  return pathToFileURL(join(DIST_DIR, "plugin")).href;
}

/** Describes the subagent concurrency limit to the main agents, so they plan for it instead of only being made to wait. */
export function renderConcurrencyRule(maxConcurrentSubagents) {
  if (!maxConcurrentSubagents) return "";
  const limit =
    maxConcurrentSubagents === 1
      ? "The model server answers one request at a time. Start one subagent, wait for its answer, then decide the next step. Never start two subagents in the same turn, and never start one in the background."
      : `The model server answers at most ${maxConcurrentSubagents} requests at a time. Never run more than ${maxConcurrentSubagents} subagents at once, and never start one in the background.`;
  return `\n\n## Subagent concurrency\n\n${limit} Independent parts still run one after another. Extra calls are queued by the harness until a slot frees up, so starting more only makes you wait.`;
}

/** Renders subagent roles into opencode agents, overlay roles into prompts and config patches for built-in agents, and the plugin under dist/. */
export function build() {
  const config = loadConfig();
  const roles = loadRoles();
  const pluginDir = join(DIST_DIR, "plugin");
  const concurrencyRule = renderConcurrencyRule(config.maxConcurrentSubagents);
  try {
    rmSync(DIST_DIR, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (error) {
    // On Windows a running OpenCode server holds the loaded plugin files open, so dist/plugin cannot be deleted.
    if (error.code !== "EPERM" && error.code !== "ENOTEMPTY") throw error;
    for (const dir of ["agents", "prompts"])
      rmSync(join(DIST_DIR, dir), {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    rmSync(join(DIST_DIR, "overlays.json"), { force: true });
  }
  for (const role of roles) {
    if (role.overlay)
      writeFile(
        join(DIST_DIR, "prompts", `${role.name}.md`),
        `${role.body}${concurrencyRule}\n`,
      );
    else
      writeFile(
        join(DIST_DIR, "agents", `${role.name}.md`),
        renderAgent(role, config),
      );
  }
  writeFile(
    join(DIST_DIR, "overlays.json"),
    JSON.stringify(renderOverlays(roles), null, 2),
  );
  const roleReasons = roles
    .filter((role) => role.reason)
    .map((role) => [role.name, role.reason]);
  const agents = {
    ...loadBuiltinReasons(config),
    ...Object.fromEntries(roleReasons),
  };
  if (config.compactionReason && !isTemplateMode(config.compactionReason))
    throw new Error(
      `unknown compaction reason mode "${config.compactionReason}"`,
    );
  const settings = {
    providerID: config.providerID,
    compaction: config.compactionReason,
    maxConcurrentSubagents: config.maxConcurrentSubagents,
    agents,
  };
  try {
    writeFile(
      join(pluginDir, "settings.json"),
      JSON.stringify(settings, null, 2),
    );
    copyFile(join(SRC_DIR, "reason-tag.ts"), join(pluginDir, "reason-tag.ts"));
    copyFile(
      join(SRC_DIR, "subagent-slots.ts"),
      join(pluginDir, "subagent-slots.ts"),
    );
    copyFile(join(SRC_DIR, "opencode-plugin.ts"), join(pluginDir, "index.ts"));
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EBUSY") {
      console.warn(
        `warning: a changed plugin file could not be written because the running OpenCode server holds ${pluginDir} open.`,
      );
    } else {
      throw error;
    }
  }
  return roles;
}

if (import.meta.main) {
  const roles = build();
  console.log(`built ${roles.length} roles into ${DIST_DIR}`);
}
