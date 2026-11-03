import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  isTemplateMode,
  loadConfig,
  overlayPatches,
  parseRole,
} from "../src/build.mjs";
import {
  mergeOverlays,
  removeOverlays,
  stripJsonc,
} from "../src/configure.mjs";
import { tagWithReason } from "../src/reason-tag.ts";
import { createSlots } from "../src/subagent-slots.ts";

test("tagWithReason prefixes the mode and keeps a tag that is already there", () => {
  const actualPlain = tagWithReason("check the diff", "house");
  const actualTagged = tagWithReason("{REASON:xlogic} write it", "ioff");

  assert.equal(actualPlain, "{REASON:house} check the diff");
  assert.equal(actualTagged, "{REASON:xlogic} write it");
});

test("build maps every reasoning role to a mode the template accepts", () => {
  const { agents } = JSON.parse(
    readFileSync(
      new URL("../dist/plugin/settings.json", import.meta.url),
      "utf8",
    ),
  );

  const actualInvalid = Object.values(agents).filter(
    (reason) => !isTemplateMode(reason),
  );

  assert.deepEqual(actualInvalid, []);
  assert.equal(agents.explore, "low");
  assert.equal(agents.build, undefined);
  assert.equal(agents.re, undefined);
  assert.equal(agents.analyst, "logic");
});

test("a role with an unknown mode fails the build", () => {
  const inputRole = "---\nname: typo\nreason: houes\n---\nbody";

  assert.throws(() => parseRole(inputRole), /unknown reason mode "houes"/);
});

test("an overlay with an unknown agent mode fails the build", () => {
  const inputRole =
    "---\nname: re\noverlay: true\naccess: write\nmode: primarry\n---\nbody";

  assert.throws(() => parseRole(inputRole), /re: unknown mode "primarry"/);
});

test("a role's mode prompt stays affordable for the requests that carry it", () => {
  // The mode prompt rides on every request of the role's session, so a role that makes many
  // tool calls must not pay for a persona. Tiers are approximate sizes of the mode's own text.
  const MODE_TIERS = {
    tiny: ["off", "low", "medium", "xhigh"],
    cheap: [
      "logic",
      "xlogic",
      "socrates",
      "xsocrates",
      "einstein",
      "xeinstein",
      "ultra",
    ],
    mid: [
      "deeptree",
      "xdeeptree",
      "hyper",
      "xhyper",
      "omni",
      "xomni",
      "spoon",
      "xspoon",
      "prompt",
      "holodeck",
    ],
    large: [
      "help",
      "xhelp",
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
    ],
  };
  const stepCeiling = { tiny: Infinity, cheap: Infinity, mid: 30, large: 25 };
  const tierOf = (reason) =>
    Object.keys(MODE_TIERS).find(
      (tier) =>
        MODE_TIERS[tier].includes(reason) ||
        MODE_TIERS[tier].includes(reason.slice(1)),
    );
  const inputRoles = readdirSync(new URL("../roles/", import.meta.url))
    .filter((file) => file.endsWith(".md") && file !== "_shared.md")
    .map((file) =>
      parseRole(
        readFileSync(new URL(`../roles/${file}`, import.meta.url), "utf8"),
      ),
    )
    .filter((role) => role.reason);

  const actualUnclassified = inputRoles
    .filter((role) => !tierOf(role.reason))
    .map((role) => `${role.name}: ${role.reason}`);
  const actualTooBig = inputRoles
    .filter((role) => role.steps > stepCeiling[tierOf(role.reason)])
    .map((role) => `${role.name} (${role.reason}, ${role.steps} steps)`);

  assert.deepEqual(actualUnclassified, []); // a new mode must be given a tier here, on purpose
  assert.deepEqual(actualTooBig, []);
});

test("a subagent role cannot declare an agent mode", () => {
  const inputRole =
    "---\nname: analyst\nreason: logic\nmode: primary\n---\nbody";

  assert.throws(
    () => parseRole(inputRole),
    /analyst: mode is only valid on an overlay/,
  );
});

test("no role file carries a literal reasoning-mode tag", () => {
  const inputFiles = readdirSync(new URL("../roles/", import.meta.url)).filter(
    (file) => file.endsWith(".md"),
  );

  const actualTagged = inputFiles.filter((file) =>
    readFileSync(new URL(`../roles/${file}`, import.meta.url), "utf8").includes(
      "{REASON",
    ),
  );

  assert.deepEqual(actualTagged, []);
});

test("overlayPatches covers build, plan and re, keeps re a primary and plan refused the writers", () => {
  const actualOverlays = overlayPatches();

  assert.deepEqual(Object.keys(actualOverlays).sort(), [
    "Reverse Engineering",
    "build",
    "plan",
  ]);
  assert.equal(actualOverlays["Reverse Engineering"].mode, "primary");
  assert.match(
    actualOverlays["Reverse Engineering"].system,
    /^\{file:.+[\\/]dist[\\/]prompts[\\/]re\.md\}$/,
  );
  const denied = new Set(
    actualOverlays.plan.permissions.map((rule) => rule.resource),
  );
  for (const writer of ["prober", "registrar", "explainer"])
    assert.ok(denied.has(writer), `plan should deny ${writer}`);
  for (const reader of ["analyst", "surveyor"])
    assert.ok(!denied.has(reader), `plan should keep ${reader}`);
});

test("stripJsonc drops comments and trailing commas but keeps them inside strings", () => {
  const inputSource =
    '{\n  // note\n  "url": "http://x//y", /* block */\n  "list": [1, 2,],\n}';

  const actualConfig = JSON.parse(stripJsonc(inputSource));

  assert.deepEqual(actualConfig, { url: "http://x//y", list: [1, 2] });
});

test("mergeOverlays sets the prompt once, keeps user settings and a user-written prompt", () => {
  const inputOverlays = {
    build: { system: "{file:/repo/dist/prompts/build.md}", permissions: [] },
    plan: {
      system: "{file:/repo/dist/prompts/plan.md}",
      permissions: [
        { action: "subagent", resource: "engineer", effect: "deny" },
      ],
    },
    re: {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputConfig = {
    agents: {
      build: { request: { body: { top_p: 0.95 } } },
      plan: { system: "my own prompt" },
      re: {},
    },
  };

  mergeOverlays(inputConfig, inputOverlays);
  const actualSkipped = mergeOverlays(inputConfig, inputOverlays);

  assert.deepEqual(actualSkipped, ["plan"]);
  assert.deepEqual(inputConfig.agents.build, {
    request: { body: { top_p: 0.95 } },
    system: "{file:/repo/dist/prompts/build.md}",
  });
  assert.equal(inputConfig.agents.plan.system, "my own prompt");
  assert.equal(inputConfig.agents.plan.permissions.length, 1);
  assert.deepEqual(inputConfig.agents.re, {
    system: "{file:/repo/dist/prompts/re.md}",
    mode: "primary",
  });
});

test("mergeOverlays never overwrites a mode the user set", () => {
  const inputOverlays = {
    re: {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputConfig = { agents: { re: { mode: "subagent" } } };

  mergeOverlays(inputConfig, inputOverlays);

  assert.equal(inputConfig.agents.re.mode, "subagent");
});

test("an agent whose prompt the user wrote keeps its mode through install and uninstall", () => {
  const inputOverlays = {
    re: {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputConfig = {
    agents: { re: { system: "my own prompt", mode: "all" } },
  };

  const actualSkipped = mergeOverlays(inputConfig, inputOverlays);
  removeOverlays(inputConfig, inputOverlays, "file:///repo/dist/plugin");

  assert.deepEqual(actualSkipped, ["re"]);
  assert.deepEqual(inputConfig.agents.re, {
    system: "my own prompt",
    mode: "all",
  });
});

test("uninstall removes the mode it installed, even when the user had set that same value", () => {
  const inputOverlays = {
    re: {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputConfig = { agents: { re: { mode: "primary" } } };

  mergeOverlays(inputConfig, inputOverlays);
  removeOverlays(inputConfig, inputOverlays, "file:///repo/dist/plugin");

  assert.deepEqual(inputConfig.agents, {}); // the install owned the entry: it wrote the prompt, so uninstall takes the entry back
});

test("slots run one subagent at a time, in the order they asked", async () => {
  const slots = createSlots(1);
  const actualOrder = [];
  const run = async (id) => {
    await slots.acquire(id);
    actualOrder.push(`start ${id}`);
    await Promise.resolve();
    actualOrder.push(`end ${id}`);
    slots.release(id);
  };

  await Promise.all([run("a"), run("b"), run("c")]);

  assert.deepEqual(actualOrder, [
    "start a",
    "end a",
    "start b",
    "end b",
    "start c",
    "end c",
  ]);
});

test("releasing a call that never got a slot leaves the queue intact", async () => {
  const slots = createSlots(1);
  await slots.acquire("a");
  const second = slots.acquire("b");

  slots.release("unknown");
  slots.release("a");
  await second;

  assert.doesNotThrow(() => slots.release("b"));
});

test("turbo.config.local.json overrides the shared config one level deep", () => {
  const inputRoot = mkdtempSync(join(tmpdir(), "turbo-config-"));
  writeFileSync(
    join(inputRoot, "turbo.config.json"),
    JSON.stringify({
      providerID: "sff",
      model: "sff/qwen",
      builtinReasons: { explore: "low", general: "logic" },
    }),
  );
  writeFileSync(
    join(inputRoot, "turbo.config.local.json"),
    JSON.stringify({
      providerID: "local",
      model: "local/tb-50x",
      builtinReasons: { explore: "ioff" },
    }),
  );

  const actualConfig = loadConfig(inputRoot);

  assert.deepEqual(actualConfig, {
    providerID: "local",
    model: "local/tb-50x",
    builtinReasons: { explore: "ioff", general: "logic" },
  });
});

test("a role saved with CRLF line endings parses like the LF version", () => {
  const inputLf =
    "---\nname: scout\nreason: xsocrates\nsteps: 15\n---\nScope it.\n";
  const inputCrlf = inputLf.replaceAll("\n", "\r\n");

  const actualRole = parseRole(inputCrlf);

  assert.deepEqual(actualRole, parseRole(inputLf));
  assert.equal(actualRole.reason, "xsocrates");
});

test("removeOverlays undoes mergeOverlays and the plugin entry, and keeps the user's own settings", () => {
  const inputOverlays = {
    build: { system: "{file:/repo/dist/prompts/build.md}", permissions: [] },
    plan: {
      system: "{file:/repo/dist/prompts/plan.md}",
      permissions: [
        { action: "subagent", resource: "engineer", effect: "deny" },
      ],
    },
    re: {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputPlugin = "file:///repo/dist/plugin";
  const expectedConfig = {
    plugins: ["opencode-browser-v2"],
    agents: {
      build: { request: { body: { top_p: 0.95 } } },
      plan: { system: "my own prompt" },
      re: { mode: "subagent" },
    },
  };
  const actualConfig = structuredClone(expectedConfig);
  mergeOverlays(actualConfig, inputOverlays);
  actualConfig.plugins.push(inputPlugin);

  removeOverlays(actualConfig, inputOverlays, inputPlugin);

  assert.deepEqual(actualConfig, expectedConfig);
});

test("removeOverlays deletes agents.re outright when the merge put it there", () => {
  const inputOverlays = {
    re: {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputConfig = { agents: {} };
  mergeOverlays(inputConfig, inputOverlays);

  removeOverlays(inputConfig, inputOverlays, "file:///repo/dist/plugin");

  assert.deepEqual(inputConfig, { agents: {} });
});

test("install moves an overlay it owns to the overlay's new key, and uninstall cleans the old key too", () => {
  const inputOverlays = {
    "Reverse Engineering": {
      system: "{file:/repo/dist/prompts/re.md}",
      permissions: [],
      mode: "primary",
    },
  };
  const inputConfig = {
    agents: {
      re: { system: "{file:/old/clone/dist/prompts/re.md}", mode: "primary" },
      mine: { system: "my own prompt" },
    },
  };

  mergeOverlays(inputConfig, inputOverlays);

  assert.deepEqual(inputConfig.agents, {
    mine: { system: "my own prompt" },
    "Reverse Engineering": {
      system: "{file:/repo/dist/prompts/re.md}",
      mode: "primary",
    },
  });

  inputConfig.agents.re = {
    system: "{file:/repo/dist/prompts/re.md}",
    mode: "primary",
  };
  removeOverlays(inputConfig, inputOverlays, "file:///repo/dist/plugin");

  assert.deepEqual(inputConfig.agents, { mine: { system: "my own prompt" } });
});

test("a subagent role cannot declare a title", () => {
  const inputRole =
    "---\nname: analyst\nreason: logic\ntitle: Analyst\n---\nbody";

  assert.throws(
    () => parseRole(inputRole),
    /analyst: title is only valid on an overlay/,
  );
});
