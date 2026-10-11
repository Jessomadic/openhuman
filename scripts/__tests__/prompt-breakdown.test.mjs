import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { analyse, splitSections } from "../debug/prompt-breakdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "debug", "prompt-breakdown.mjs");

const SYSTEM = [
  "### SOUL.md",
  "",
  "# Persona",
  "Be direct.",
  "## When criticized",
  "Own it.",
  "# Writing style",
  "Short sentences.",
  "<rules>",
  "# not a heading inside a tag",
  "</rules>",
  "```",
  "## not a heading inside a fence",
  "```",
].join("\n");

const REPEATED =
  "Call tool_search before telling the user something is impossible, every single time.";

const BODY = {
  model: "test/model",
  stream: true,
  messages: [
    { role: "system", content: SYSTEM },
    { role: "system", content: `## Integrations\n\n${REPEATED}` },
    { role: "user", content: "hello" },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "big_tool",
        description: `${REPEATED}\n\n${"word ".repeat(200)}`,
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "small_tool",
        description: "Tiny.",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    },
  ],
};

test("splitSections nests a file marker over its first H1 only, and ignores tags and fences", () => {
  const root = splitSections(SYSTEM);
  assert.deepEqual(
    root.children.map((c) => c.title),
    ["### SOUL.md", "# Writing style"],
  );
  const soul = root.children[0];
  assert.deepEqual(
    soul.children.map((c) => c.title),
    ["# Persona"],
  );
  assert.deepEqual(
    soul.children[0].children.map((c) => c.title),
    ["## When criticized"],
  );
  const style = root.children[1];
  assert.deepEqual(
    style.children.map((c) => c.title),
    ["<rules>"],
  );
  assert.ok(style.lines.includes("## not a heading inside a fence"));
});

test("analyse splits the request into system, tools, conversation and envelope and finds repeats", () => {
  const a = analyse(BODY, {});
  const { totals } = a;
  assert.equal(
    totals.all,
    totals.system + totals.tools + totals.conversation + totals.envelope,
  );
  assert.ok(
    totals.tools > totals.system,
    "the padded tool description dominates",
  );
  assert.deepEqual(
    a.tools.map((t) => t.name),
    ["big_tool", "small_tool"],
  );
  assert.equal(a.scale, null, "no provider usage, no calibration");
  assert.equal(a.duplicates.length, 1);
  assert.deepEqual(a.duplicates[0].where, ["msg 2 (system)", "tool big_tool"]);
});

test("CLI calibrates against the provider usage in an SSE response", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-breakdown-"));
  try {
    const req = path.join(dir, "req.json");
    const res = path.join(dir, "res.txt");
    fs.writeFileSync(req, JSON.stringify(BODY));
    fs.writeFileSync(
      res,
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":1}}\n\n' +
        "data: [DONE]\n\n",
    );
    const out = spawnSync(process.execPath, [SCRIPT, req, "--response", res], {
      encoding: "utf8",
    });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /calibration: o200k total \d+ → provider 1000/);
    assert.match(out.stdout, /^\s+\d+\s+1000 100\.0%  TOTAL$/m);
    assert.match(out.stdout, /big_tool/);
    assert.match(out.stdout, /repeated paragraphs/);

    const json = spawnSync(
      process.execPath,
      [SCRIPT, req, "--prompt-tokens", "500", "--json"],
      { encoding: "utf8" },
    );
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).usage.prompt_tokens, 500);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
