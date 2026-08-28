import { strict as assert } from "node:assert";
import { test } from "node:test";

import { runChecks, scoreOf } from "../src/lib/checks.js";
import type { Check, CheckStatus } from "../src/lib/types.js";
import { NOW, snapshot } from "./helpers.js";

function find(checks: Check[], id: string): Check {
  const found = checks.find((check) => check.id === id);
  assert.ok(found, `no check with id ${id}`);
  return found;
}

function statusOf(id: string, overrides = {}): CheckStatus {
  return find(runChecks(snapshot(overrides), NOW), id).status;
}

test("a page that does everything right has nothing failing", () => {
  const checks = runChecks(snapshot(), NOW);
  const score = scoreOf(checks);
  assert.equal(score.failed, 0);
  assert.equal(score.warned, 0);
  assert.ok(score.passed > 8, `expected most checks to pass, got ${score.passed}/${score.total}`);
});

test("structured data is judged on what it actually carries", () => {
  assert.equal(statusOf("structured-data"), "pass");
  assert.equal(statusOf("structured-data", { structured: [] }), "fail");

  // Present but not an article type: it exists, and it does not describe this page.
  assert.equal(
    statusOf("structured-data", {
      structured: [
        {
          types: ["BreadcrumbList"],
          headline: null,
          author: null,
          datePublished: null,
          dateModified: null,
        },
      ],
    }),
    "warn",
  );

  // Broken JSON is worse than absent, because the author thinks it is there.
  assert.equal(
    statusOf("structured-data", {
      structured: [
        {
          types: [],
          headline: null,
          author: null,
          datePublished: null,
          dateModified: null,
          invalid: true,
        },
      ],
    }),
    "fail",
  );
});

test("an article missing a date is reported, and an old one is reported differently", () => {
  const undated = runChecks(
    snapshot({
      structured: [
        {
          types: ["BlogPosting"],
          headline: "x",
          author: "y",
          datePublished: null,
          dateModified: null,
        },
      ],
      publishedMeta: null,
      modifiedMeta: null,
      timeAttributes: [],
    }),
    NOW,
  );
  assert.equal(find(undated, "freshness").status, "warn");
  assert.match(find(undated, "freshness").detail, /no machine-readable/);

  const stale = runChecks(
    snapshot({
      structured: [
        {
          types: ["BlogPosting"],
          headline: "x",
          author: "y",
          datePublished: "2020-01-01",
          dateModified: "2020-01-01",
        },
      ],
      publishedMeta: null,
      modifiedMeta: null,
      timeAttributes: [],
    }),
    NOW,
  );
  assert.equal(find(stale, "freshness").status, "warn");
  assert.match(find(stale, "freshness").detail, /2020-01-01/);
});

test("a page that forbids snippets is a failure, not a warning", () => {
  const check = find(runChecks(snapshot({ robotsMeta: "index, nosnippet" }), NOW), "robots-meta");
  assert.equal(check.status, "fail");
  assert.match(check.detail, /nosnippet/);
});

test("the heading outline is checked for count and for skipped levels", () => {
  assert.equal(statusOf("headings"), "pass");

  assert.equal(
    statusOf("headings", {
      headings: [
        { level: 1, text: "one" },
        { level: 1, text: "two" },
      ],
    }),
    "fail",
  );

  const skipped = find(
    runChecks(
      snapshot({
        headings: [
          { level: 1, text: "one" },
          { level: 4, text: "jumped" },
        ],
      }),
      NOW,
    ),
    "headings",
  );
  assert.equal(skipped.status, "warn");
  assert.match(skipped.detail, /h1 -> h4/);
});

test("an opening paragraph that clears its throat is reported in both languages", () => {
  assert.equal(
    statusOf("answer-first", { firstParagraph: "この記事では、固定レイアウトEPUBについて解説します。" }),
    "warn",
  );
  assert.equal(
    statusOf("answer-first", { firstParagraph: "In this article, we will look at fixed-layout EPUB." }),
    "warn",
  );
  assert.equal(statusOf("answer-first"), "pass");
});

test("question-shaped headings are counted in both languages", () => {
  const japanese = find(runChecks(snapshot(), NOW), "question-headings");
  assert.equal(japanese.status, "pass");

  const english = find(
    runChecks(
      snapshot({
        headings: [
          { level: 1, text: "Fixed layout" },
          { level: 2, text: "The declaration" },
        ],
      }),
      NOW,
    ),
    "question-headings",
  );
  assert.equal(english.status, "info");
});

test("prose with nothing to lift out of it is reported", () => {
  assert.equal(
    statusOf("scannable", {
      counts: { ...snapshot().counts, lists: 0, tables: 0, codeBlocks: 0 },
    }),
    "warn",
  );
});

test("images without alt and pages without outbound links are reported", () => {
  assert.equal(
    statusOf("image-alt", { counts: { ...snapshot().counts, imagesWithoutAlt: 2 } }),
    "warn",
  );
  assert.equal(
    statusOf("image-alt", { counts: { ...snapshot().counts, images: 0, imagesWithoutAlt: 0 } }),
    "info",
  );
  assert.equal(statusOf("sources", { counts: { ...snapshot().counts, externalLinks: 0 } }), "warn");
});

test("a thin body says the extraction source, because that is the likelier cause", () => {
  const check = find(
    runChecks(snapshot({ charCount: 120, extractedFrom: "densest text block" }), NOW),
    "length",
  );
  assert.equal(check.status, "warn");
  assert.match(check.fix, /densest text block|extraction source/);
});

test("a canonical pointing elsewhere is information, not a verdict", () => {
  const check = find(
    runChecks(snapshot({ canonical: "https://example.com/other" }), NOW),
    "canonical",
  );
  assert.equal(check.status, "info");
  assert.equal(scoreOf([check]).total, 0);
});
