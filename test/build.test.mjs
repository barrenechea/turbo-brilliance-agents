import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isTemplateMode, loadConfig, parseRole } from "../src/build.mjs";
import { mergeOverlays, stripJsonc } from "../src/configure.mjs";
import { tagWithReason } from "../src/reason-tag.mjs";
import { createSlots } from "../src/subagent-slots.mjs";

test("tagWithReason prefixes the mode and keeps a tag that is already there", () => {
  const actualPlain = tagWithReason("check the diff", "house");
  const actualTagged = tagWithReason("{REASON:xlogic} write it", "ioff");

  assert.equal(actualPlain, "{REASON:house} check the diff");
  assert.equal(actualTagged, "{REASON:xlogic} write it");
});

test("build maps every reasoning role to a mode the template accepts", () => {
  const { agents } = JSON.parse(readFileSync(new URL("../dist/plugin/settings.json", import.meta.url), "utf8"));

  const actualInvalid = Object.values(agents).filter((reason) => !isTemplateMode(reason));

  assert.deepEqual(actualInvalid, []);
  assert.equal(agents.explore, "low");
  assert.equal(agents.build, undefined);
});

test("a role with an unknown mode fails the build", () => {
  const inputRole = "---\nname: typo\nreason: houes\n---\nbody";

  assert.throws(() => parseRole(inputRole), /unknown reason mode "houes"/);
});

test("stripJsonc drops comments and trailing commas but keeps them inside strings", () => {
  const inputSource = '{\n  // note\n  "url": "http://x//y", /* block */\n  "list": [1, 2,],\n}';

  const actualConfig = JSON.parse(stripJsonc(inputSource));

  assert.deepEqual(actualConfig, { url: "http://x//y", list: [1, 2] });
});

test("mergeOverlays sets the prompt once, keeps user settings and a user-written prompt", () => {
  const inputOverlays = {
    build: { system: "{file:/repo/dist/prompts/build.md}", permissions: [] },
    plan: { system: "{file:/repo/dist/prompts/plan.md}", permissions: [{ action: "subagent", resource: "engineer", effect: "deny" }] },
  };
  const inputConfig = { agents: { build: { request: { body: { top_p: 0.95 } } }, plan: { system: "my own prompt" } } };

  mergeOverlays(inputConfig, inputOverlays);
  const actualSkipped = mergeOverlays(inputConfig, inputOverlays);

  assert.deepEqual(actualSkipped, ["plan"]);
  assert.deepEqual(inputConfig.agents.build, { request: { body: { top_p: 0.95 } }, system: "{file:/repo/dist/prompts/build.md}" });
  assert.equal(inputConfig.agents.plan.system, "my own prompt");
  assert.equal(inputConfig.agents.plan.permissions.length, 1);
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

  assert.deepEqual(actualOrder, ["start a", "end a", "start b", "end b", "start c", "end c"]);
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
  writeFileSync(join(inputRoot, "turbo.config.json"), JSON.stringify({ providerID: "sff", model: "sff/qwen", builtinReasons: { explore: "low", general: "logic" } }));
  writeFileSync(join(inputRoot, "turbo.config.local.json"), JSON.stringify({ providerID: "local", model: "local/tb-50x", builtinReasons: { explore: "ioff" } }));

  const actualConfig = loadConfig(inputRoot);

  assert.deepEqual(actualConfig, { providerID: "local", model: "local/tb-50x", builtinReasons: { explore: "ioff", general: "logic" } });
});

test("a role saved with CRLF line endings parses like the LF version", () => {
  const inputLf = "---\nname: scout\nreason: xsocrates\nsteps: 15\n---\nScope it.\n";
  const inputCrlf = inputLf.replaceAll("\n", "\r\n");

  const actualRole = parseRole(inputCrlf);

  assert.deepEqual(actualRole, parseRole(inputLf));
  assert.equal(actualRole.reason, "xsocrates");
});
