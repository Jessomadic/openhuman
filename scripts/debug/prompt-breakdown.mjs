#!/usr/bin/env node
//
// prompt-breakdown.mjs — token accounting for one captured inference request.
//
// Where render-inference-capture.mjs reproduces a capture verbatim, this is the
// analysis layer: it splits every system message into its sections (Markdown
// headings and top-level `<tag>` blocks), prices each section, every tool
// schema and every other message in tokens, and flags text repeated across the
// request. Use it to decide what to trim.
//
// Token counts come from the o200k_base encoding (gpt-tokenizer). The model on
// the other end may tokenize differently, so when the captured response (or
// --prompt-tokens) supplies the provider's own `usage.prompt_tokens`, every row
// also gets a calibrated column scaled to that total.
//
// Section attribution follows the wire text only. An injected workspace file
// (`### SOUL.md`) owns its first `#` heading's subtree, and nothing marks where
// a file ends, so text that follows it under the same `#` heading (the agent
// body's `##` sections after ROLE.md, for example) is counted under that file.
// Use --depth 3 to see those sections one by one.
//
// Usage:
//   node scripts/debug/prompt-breakdown.mjs <request.json>
//        [--response <response.json|sse>] [--prompt-tokens N]
//        [--depth 1|2|3] [--top N] [--json]
//
// Capture a request with `CAPTURE_ALL=1 CAPTURE_RESPONSES=1 pnpm debug capture`
// (scripts/debug/capture-first-inference.mjs), then point this at a numbered
// request file under the capture directory.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { encode } from "gpt-tokenizer/encoding/o200k_base";

const USAGE = `usage: prompt-breakdown.mjs <request.json> [--response <file>] [--prompt-tokens N]
                           [--depth 1|2|3] [--top N] [--json]`;

function parseArgs(argv) {
  const opts = { depth: 2, top: 25, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (a === "--response") opts.response = argv[++i];
    else if (a === "--prompt-tokens") opts.promptTokens = Number(argv[++i]);
    else if (a === "--depth") opts.depth = Number(argv[++i]);
    else if (a === "--top") opts.top = Number(argv[++i]);
    else if (a === "--json") opts.json = true;
    else rest.push(a);
  }
  if (rest.length !== 1) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
  opts.request = rest[0];
  return opts;
}

export const tok = (s) => (s ? encode(s).length : 0);

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : (p.text ?? JSON.stringify(p))))
      .join("");
  }
  return content == null ? "" : JSON.stringify(content);
}

// Split text into a section tree. A section opens at a Markdown heading
// (outside fenced code) or at a line that is exactly a top-level `<tag ...>`
// whose matching `</tag>` closes it later. Text before the first marker is the
// preamble. Tags nest as children of the heading they appear under.
export function splitSections(text) {
  const lines = text.split("\n");
  const root = { title: "(root)", level: 0, lines: [], children: [] };
  const stack = [root];
  let inFence = false;
  let openTag = null; // name of the tag block we are inside, if any

  const push = (node) => {
    // A file marker owns only its file's first `#` heading: the wire text
    // carries no end-of-file marker, so a second `#` heading is taken to be
    // the next top-level block (the agent body, STYLE.md) and pops out.
    if (node.level === 1) {
      const file = stack.findLast((n) => n.level === 0.25);
      if (file?.children.some((c) => c.level === 1)) stack.length = 1;
    }
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level)
      stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !openTag) {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        // `### SOUL.md`-style lines mark an injected workspace file: they sit
        // above the file's own `#` headings, whatever their hash count.
        const level = /^[\w.-]+\.md$/.test(h[2].trim()) ? 0.25 : h[1].length;
        push({
          title: `${h[1]} ${h[2].trim()}`,
          level,
          lines: [line],
          children: [],
        });
        continue;
      }
      const t = /^<([A-Za-z_][\w.-]*)(\s[^>]*)?>\s*$/.exec(line);
      if (t && text.includes(`</${t[1]}>`)) {
        openTag = t[1];
        // Tags sit one level below the current heading.
        const level = stack[stack.length - 1].level + 0.5;
        push({ title: `<${t[1]}>`, level, lines: [line], children: [] });
        continue;
      }
    }
    stack[stack.length - 1].lines.push(line);
    if (openTag && line.trim() === `</${openTag}>`) {
      openTag = null;
      stack.pop();
    }
  }
  return root;
}

function priceTree(node) {
  node.own = tok(node.lines.join("\n"));
  node.total = node.own;
  for (const c of node.children) node.total += priceTree(c).total;
  node.chars =
    node.lines.join("\n").length +
    node.children.reduce((n, c) => n + c.chars, 0);
  return node;
}

function readUsage(opts) {
  if (Number.isFinite(opts.promptTokens))
    return { prompt_tokens: opts.promptTokens };
  if (!opts.response) return null;
  const raw = fs.readFileSync(opts.response, "utf8");
  // A JSON body, or an SSE stream whose last usage-bearing chunk wins.
  try {
    const j = JSON.parse(raw);
    if (j.usage) return j.usage;
  } catch {
    /* SSE */
  }
  let usage = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j.usage) usage = j.usage;
    } catch {
      /* [DONE] and keep-alives */
    }
  }
  return usage;
}

// Paragraph-level duplicates: any normalised block of >= 60 chars that occurs
// more than once anywhere in the request text is paying for itself twice.
function findDuplicates(texts) {
  const seen = new Map();
  for (const { where, text } of texts) {
    for (const para of text.split(/\n\s*\n/)) {
      const norm = para.replace(/\s+/g, " ").trim();
      if (norm.length < 60) continue;
      const e = seen.get(norm) ?? { text: norm, where: [] };
      e.where.push(where);
      seen.set(norm, e);
    }
  }
  return [...seen.values()]
    .filter((e) => e.where.length > 1)
    .map((e) => ({
      ...e,
      tokens: tok(e.text),
      wasted: tok(e.text) * (e.where.length - 1),
    }))
    .sort((a, b) => b.wasted - a.wasted);
}

export function analyse(body, opts = {}) {
  const messages = (body.messages || []).map((m, i) => {
    const text = contentText(m.content);
    const calls = m.tool_calls ? JSON.stringify(m.tool_calls) : "";
    const entry = {
      index: i + 1,
      role: m.role,
      tokens: tok(text) + tok(calls),
      chars: text.length,
    };
    if (m.role === "system") entry.tree = priceTree(splitSections(text));
    return entry;
  });

  const tools = (body.tools || []).map((t) => {
    const fn = t.function ?? t;
    return {
      name: fn.name ?? "(unnamed)",
      tokens: tok(JSON.stringify(t)),
      description: tok(fn.description ?? ""),
      parameters: tok(JSON.stringify(fn.parameters ?? fn.input_schema ?? {})),
    };
  });

  const envelope = { ...body };
  delete envelope.messages;
  delete envelope.tools;

  const totals = {
    system: messages
      .filter((m) => m.role === "system")
      .reduce((n, m) => n + m.tokens, 0),
    conversation: messages
      .filter((m) => m.role !== "system")
      .reduce((n, m) => n + m.tokens, 0),
    tools: tools.reduce((n, t) => n + t.tokens, 0),
    envelope: tok(JSON.stringify(envelope)),
  };
  totals.all =
    totals.system + totals.conversation + totals.tools + totals.envelope;

  const usage = readUsage(opts);
  const scale = usage?.prompt_tokens ? usage.prompt_tokens / totals.all : null;

  const dupTexts = [
    ...messages.map((m) => ({
      where: `msg ${m.index} (${m.role})`,
      text: contentText(body.messages[m.index - 1].content),
    })),
    ...(body.tools || []).map((t) => ({
      where: `tool ${(t.function ?? t).name}`,
      text: (t.function ?? t).description ?? "",
    })),
  ];

  return {
    model: body.model,
    envelope,
    messages,
    tools,
    totals,
    usage,
    scale,
    duplicates: findDuplicates(dupTexts),
  };
}

function fmtRow(label, tokens, all, scale, extra = "") {
  const pct = ((100 * tokens) / all).toFixed(1).padStart(5);
  const cal = scale ? String(Math.round(tokens * scale)).padStart(7) : "";
  return `${String(tokens).padStart(7)} ${cal} ${pct}%  ${label}${extra}`;
}

function report(a, opts) {
  const out = [];
  const w = (s) => out.push(s);
  const { totals, scale } = a;
  w(`model: ${a.model ?? "?"}`);
  if (a.usage) {
    w(`provider usage: ${JSON.stringify(a.usage)}`);
    w(
      `calibration: o200k total ${totals.all} → provider ${a.usage.prompt_tokens} (×${scale.toFixed(3)})`,
    );
  }
  w("");
  w(
    `${"o200k".padStart(7)} ${scale ? "calib".padStart(7) : ""} ${"share".padStart(6)}  part`,
  );
  w(fmtRow("TOTAL", totals.all, totals.all, scale));
  w(fmtRow("system prompt", totals.system, totals.all, scale));
  w(
    fmtRow(`tool schemas (${a.tools.length})`, totals.tools, totals.all, scale),
  );
  w(
    fmtRow(
      "conversation (non-system messages)",
      totals.conversation,
      totals.all,
      scale,
    ),
  );
  w(fmtRow("request envelope", totals.envelope, totals.all, scale));

  for (const m of a.messages.filter((m) => m.tree)) {
    w("");
    w(`== system message #${m.index}: ${m.tokens} tokens, ${m.chars} chars`);
    const walk = (node, depth) => {
      for (const c of node.children) {
        if (depth > opts.depth) continue;
        const indent = "  ".repeat(depth - 1);
        const own = c.children.length ? ` (own ${c.own})` : "";
        w(
          fmtRow(
            `${indent}${c.title.slice(0, 90)}`,
            c.total,
            totals.all,
            scale,
            own,
          ),
        );
        walk(c, depth + 1);
      }
    };
    if (m.tree.own)
      w(
        fmtRow(
          "(preamble before first section)",
          m.tree.own,
          totals.all,
          scale,
        ),
      );
    walk(m.tree, 1);
  }

  w("");
  w(
    `== tool schemas, largest first (${Math.min(opts.top, a.tools.length)} of ${a.tools.length})`,
  );
  for (const t of [...a.tools]
    .sort((x, y) => y.tokens - x.tokens)
    .slice(0, opts.top)) {
    w(
      fmtRow(
        t.name,
        t.tokens,
        totals.all,
        scale,
        `   [desc ${t.description} / params ${t.parameters}]`,
      ),
    );
  }
  const byPrefix = new Map();
  for (const t of a.tools) {
    const p = t.name.split(/[_.:-]/)[0];
    const e = byPrefix.get(p) ?? { n: 0, tokens: 0 };
    e.n++;
    e.tokens += t.tokens;
    byPrefix.set(p, e);
  }
  w("");
  w("== tool schemas by name prefix");
  for (const [p, e] of [...byPrefix].sort(
    (x, y) => y[1].tokens - x[1].tokens,
  )) {
    w(fmtRow(`${p}* (${e.n})`, e.tokens, totals.all, scale));
  }

  w("");
  w("== non-system messages");
  for (const m of a.messages.filter((m) => m.role !== "system")) {
    w(fmtRow(`#${m.index} ${m.role}`, m.tokens, totals.all, scale));
  }

  if (a.duplicates.length) {
    w("");
    w("== repeated paragraphs (tokens paid more than once)");
    for (const d of a.duplicates.slice(0, opts.top)) {
      w(
        `${String(d.wasted).padStart(7)} wasted ×${d.where.length}  ${d.text.slice(0, 100)}…`,
      );
      w(`${"".padStart(18)}in: ${[...new Set(d.where)].join(", ")}`);
    }
  }
  return out.join("\n");
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const body = JSON.parse(fs.readFileSync(opts.request, "utf8"));
  const a = analyse(body, opts);
  if (opts.json) {
    const strip = (n) => ({
      title: n.title,
      own: n.own,
      total: n.total,
      children: n.children.map(strip),
    });
    const json = {
      ...a,
      messages: a.messages.map((m) =>
        m.tree ? { ...m, tree: strip(m.tree) } : m,
      ),
    };
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    process.stdout.write(`${report(a, opts)}\n`);
  }
}
