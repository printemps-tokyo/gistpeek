// End-to-end checks of the built extension (dist/) in a real Chromium: the
// side panel loads and degrades cleanly without an on-device model, and the
// page extractor reads a real DOM. Needs `npm run build` and Playwright's
// Chromium (`npx playwright install chromium`), or any Chromium build named
// by E2E_CHROMIUM; run with `npm run e2e`.
//
// The side panel reads a page through activeTab, which only a click on the
// toolbar button grants, so the extractor is run in the page directly
// instead, from the same built file the panel injects.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const EXTENSION = resolve(import.meta.dirname, "..", "dist");

const ARTICLE = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>How fixed layouts break</title>
  <meta name="description" content="Why a viewport on every page matters.">
  <link rel="canonical" href="https://example.com/fixed-layouts">
  <meta property="og:type" content="article">
  <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "Article", "headline": "How fixed layouts break",
     "author": {"@type": "Person", "name": "A. Writer"}, "datePublished": "2026-10-01"}
  </script>
</head><body>
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <article>
    <h1>How fixed layouts break</h1>
    <p>Fixed-layout EPUB needs a viewport on every page, or reading systems guess the size and the art is cut off.</p>
    <h2>What to check</h2>
    <p>Each content document declares its own width and height in a viewport meta element. The package also says the book is pre-paginated.</p>
    <p>Spreads come from the spine properties, not from the images, so a missing page-spread property changes how two pages pair up.</p>
    <time datetime="2026-10-01">October 1</time>
  </article>
</body></html>`;

let server;
let origin;
let context;
let worker;
let profile;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(ARTICLE);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;

  profile = await mkdtemp(join(tmpdir(), "gistpeek-e2e-"));
  context = await chromium.launchPersistentContext(profile, {
    // The Chromium build, unlike branded Chrome, still loads unpacked
    // extensions from the command line, also headless.
    channel: "chromium",
    ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}),
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
});

after(async () => {
  await context?.close();
  await new Promise((done) => server?.close(done));
  if (profile) await rm(profile, { recursive: true, force: true });
});

describe("gistpeek", () => {
  test("the service worker is the extension's", () => {
    assert.match(worker.url(), /^chrome-extension:\/\/[a-p]{32}\/src\/background\.js$/);
  });

  test("the side panel loads, reports the model, and explains a page it cannot read", async () => {
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/src/sidepanel.html`);

    const state = page.locator("#model-state");
    await page.waitForFunction(
      () => document.getElementById("model-state")?.textContent !== "checking the model",
      null,
      { timeout: 10_000 },
    );
    assert.notEqual((await state.textContent()).trim(), "");

    // The active tab is the panel itself, an extension page Chrome does not
    // let extensions script.
    await page.locator("#run").click();
    const status = page.locator("#status");
    await page.waitForFunction(() => document.getElementById("status")?.dataset.kind === "error", null, {
      timeout: 10_000,
    });
    assert.match(await status.textContent(), /^Could not read this page: /);
    assert.equal(await page.locator("#run").isDisabled(), false);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test("the extractor reads a real page, and the checks run on what it read", async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const source = await readFile(join(EXTENSION, "src", "inject", "extract.js"), "utf8");
    await page.addScriptTag({
      type: "module",
      content: `${source}\nwindow.__snapshot = extractSnapshot(4000);`,
    });
    const snapshot = await page.waitForFunction(() => window.__snapshot).then((h) => h.jsonValue());
    await page.close();

    assert.equal(snapshot.title, "How fixed layouts break");
    assert.equal(snapshot.lang, "en");
    assert.equal(snapshot.metaDescription, "Why a viewport on every page matters.");
    assert.equal(snapshot.canonical, "https://example.com/fixed-layouts");
    assert.equal(snapshot.ogType, "article");
    assert.equal(snapshot.extractedFrom, "article");
    assert.deepEqual(
      snapshot.headings.map((h) => [h.level, h.text]),
      [
        [1, "How fixed layouts break"],
        [2, "What to check"],
      ],
    );
    assert.ok(snapshot.text.startsWith("How fixed layouts break Fixed-layout EPUB needs a viewport"), snapshot.text);
    assert.ok(!snapshot.text.includes("About"), "navigation is not part of the article");
    assert.deepEqual(snapshot.timeAttributes, ["2026-10-01"]);
    const article = snapshot.structured.find((n) => n.types.includes("Article"));
    assert.ok(article, JSON.stringify(snapshot.structured));
    assert.equal(article.headline, "How fixed layouts break");
    assert.equal(article.author, "A. Writer");
    assert.equal(snapshot.truncated, false);

    const { runChecks } = await import(pathToFileURL(join(EXTENSION, "src", "lib", "checks.js")).href);
    const checks = runChecks(snapshot, new Date("2026-11-12T00:00:00Z"));
    assert.ok(checks.length >= 10, `${checks.length} checks`);
    for (const c of checks) assert.ok(["pass", "warn", "fail", "info"].includes(c.status), JSON.stringify(c));
  });
});
