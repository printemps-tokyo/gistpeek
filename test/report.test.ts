import { strict as assert } from "node:assert";
import { test } from "node:test";

import { runChecks, scoreOf } from "../src/lib/checks.js";
import { fileNameFor, toJson, toMarkdown } from "../src/lib/report.js";
import type { Report } from "../src/lib/types.js";
import { NOW, snapshot } from "./helpers.js";

function report(overrides: Partial<Report> = {}): Report {
  const page = snapshot();
  const checks = runChecks(page, NOW);
  return {
    snapshot: page,
    language: "ja",
    summary: "- viewportを宣言しないとリーディングシステムが拡大縮小する\n- 宣言はページごとに必要",
    reading: {
      takeaway: "固定レイアウトEPUBはページごとにviewportが要る。",
      questionsAnswered: ["viewportを宣言しないと何が起きるか"],
      citableFacts: ["EPUB 3.3ではrendition:viewportは非推奨"],
      missing: ["ストアごとの容量上限"],
      targetVerdict: "kept",
      targetEvidence: "ページごとにviewportを宣言しなければ拡大縮小される。",
    },
    checks,
    score: scoreOf(checks),
    policy: null,
    target: "固定レイアウトEPUBはページごとにviewportが要る",
    generatedAt: "2026-08-29T00:00:00.000Z",
    version: "0.1.0",
    ...overrides,
  };
}

test("the markdown carries the summary, the verdict and every check", () => {
  const markdown = toMarkdown(report());
  assert.match(markdown, /# gistpeek: Fixed-layout EPUB/);
  assert.match(markdown, /## What the on-device model takes away/);
  assert.match(markdown, /### The point you wanted to land/);
  assert.match(markdown, /- Verdict: kept/);
  assert.match(markdown, /\| ok \| Structured data \|/);
  assert.match(markdown, /nothing on this page was sent anywhere/);
});

test("a run without a model still produces a report", () => {
  const markdown = toMarkdown(report({ summary: null, reading: null, target: null }));
  assert.doesNotMatch(markdown, /What the on-device model takes away/);
  assert.match(markdown, /## Checks/);
});

test("pipes in evidence do not break the table", () => {
  const base = report();
  const withPipe = report({
    checks: [
      { id: "x", title: "Title", status: "warn", detail: 'found "a | b"', fix: "fix | it" },
    ],
    score: base.score,
  });
  const row = toMarkdown(withPipe)
    .split("\n")
    .find((line) => line.includes("Title"));
  assert.ok(row);
  // Escaped pipes stay inside the cell; only the unescaped ones are columns.
  const separators = row.split(/(?<!\\)\|/).length - 1;
  assert.equal(separators, 5, `unexpected column count in: ${row}`);
  assert.match(row, /found "a \\\| b"/);
});

test("the JSON round-trips", () => {
  const parsed: Report = JSON.parse(toJson(report()));
  assert.equal(parsed.snapshot.url, snapshot().url);
  assert.equal(parsed.reading?.targetVerdict, "kept");
});

test("the file name says which page it came from", () => {
  assert.equal(
    fileNameFor(report(), "json"),
    "gistpeek-printemps-tokyo-blog-fixed-layout-epub.json",
  );
});
