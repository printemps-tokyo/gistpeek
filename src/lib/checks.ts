// The non-AI half of the report: what the page says about itself.
//
// These are deliberately boring and deterministic. They run with no model,
// no network and no configuration, so the panel has something to show on a
// machine where the on-device model is unavailable -- and so the same page
// always produces the same list.
//
// Every check states what was found before it states what to do about it. A
// check that cannot see enough to judge returns `info`, never a guess.

import type { Check, PageSnapshot } from "./types.js";

const ARTICLE_TYPES = [
  "article",
  "blogposting",
  "newsarticle",
  "techarticle",
  "report",
  "scholarlyarticle",
  "webpage",
  "faqpage",
  "howto",
];

/** Openers that announce an article instead of answering it, in ja and en. */
const THROAT_CLEARING = [
  "この記事では",
  "本記事では",
  "今回は",
  "こんにちは",
  "みなさん",
  "皆さん",
  "はじめまして",
  "いかがお過ごし",
  "について解説します",
  "について紹介します",
  "in this article",
  "in this post",
  "today we",
  "welcome to",
  "hi everyone",
  "let's talk about",
];

const QUESTION_MARKERS = ["?", "？", "とは", "なぜ", "どう", "どこ", "いつ", "何が", "できるのか"];
const QUESTION_WORDS = ["what", "why", "how", "when", "where", "which", "who", "should", "can", "is", "does"];

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function isQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  if (QUESTION_MARKERS.some((marker) => text.includes(marker))) return true;
  const firstWord = lower.split(/\s+/)[0] ?? "";
  return QUESTION_WORDS.includes(firstWord);
}

function check(
  id: string,
  title: string,
  status: Check["status"],
  detail: string,
  fix = "",
): Check {
  return { id, title, status, detail, fix };
}

export function runChecks(snapshot: PageSnapshot, now: Date = new Date()): Check[] {
  const checks: Check[] = [];
  const { counts } = snapshot;

  // --- what the page claims to be -----------------------------------------

  const articleNode = snapshot.structured.find((node) =>
    node.types.some((type) => ARTICLE_TYPES.includes(type.toLowerCase())),
  );
  const brokenJsonLd = snapshot.structured.some((node) => node.invalid);

  if (brokenJsonLd) {
    checks.push(
      check(
        "structured-data",
        "Structured data",
        "fail",
        "a script[type=application/ld+json] block on this page is not valid JSON, so a parser drops it entirely",
        "fix the JSON-LD; a block that does not parse is worth exactly as much as no block at all",
      ),
    );
  } else if (!articleNode) {
    checks.push(
      check(
        "structured-data",
        "Structured data",
        snapshot.structured.length > 0 ? "warn" : "fail",
        snapshot.structured.length > 0
          ? `JSON-LD is present but declares ${snapshot.structured
              .flatMap((n) => n.types)
              .join(", ") || "no @type"}, none of which is an article type`
          : "no JSON-LD on the page",
        "add an Article or BlogPosting node with headline, author, datePublished and dateModified",
      ),
    );
  } else {
    const missing = [
      articleNode.headline ? null : "headline",
      articleNode.author ? null : "author",
      articleNode.datePublished ? null : "datePublished",
      articleNode.dateModified ? null : "dateModified",
    ].filter((value): value is string => value !== null);
    checks.push(
      check(
        "structured-data",
        "Structured data",
        missing.length === 0 ? "pass" : "warn",
        missing.length === 0
          ? `${articleNode.types.join(", ")} with headline, author and both dates`
          : `${articleNode.types.join(", ")} is present but missing ${missing.join(", ")}`,
        missing.length === 0 ? "" : `fill in ${missing.join(", ")}`,
      ),
    );
  }

  // --- who wrote it and when ----------------------------------------------

  const author = articleNode?.author ?? null;
  checks.push(
    author
      ? check("author", "Author", "pass", `declared as "${author}"`)
      : check(
          "author",
          "Author",
          "warn",
          "no author in the structured data",
          "name a person or an organization; an unattributed page is a weaker thing to quote",
        ),
  );

  const modified =
    parseDate(articleNode?.dateModified) ??
    parseDate(snapshot.modifiedMeta) ??
    parseDate(articleNode?.datePublished) ??
    parseDate(snapshot.publishedMeta) ??
    parseDate(snapshot.timeAttributes[0]);

  if (!modified) {
    checks.push(
      check(
        "freshness",
        "Dates",
        "warn",
        "no machine-readable published or modified date anywhere on the page",
        "add datePublished and dateModified, and put the visible date in a <time datetime> element",
      ),
    );
  } else {
    const age = daysBetween(modified, now);
    const iso = modified.toISOString().slice(0, 10);
    checks.push(
      age > 730
        ? check(
            "freshness",
            "Dates",
            "warn",
            `last dated ${iso}, ${age} days ago`,
            "review it or say plainly that it still stands; a stale date is a reason to prefer someone else's page",
          )
        : check("freshness", "Dates", "pass", `last dated ${iso}, ${age} days ago`),
    );
  }

  // --- the machine-readable framing ---------------------------------------

  const titleLength = snapshot.title.length;
  checks.push(
    titleLength === 0
      ? check("title", "Title", "fail", "the document has no title", "give the page a <title>")
      : check(
          "title",
          "Title",
          titleLength > 90 ? "warn" : "pass",
          `${titleLength} characters: "${snapshot.title}"`,
          titleLength > 90 ? "tighten it; the tail is cut off in most surfaces that show it" : "",
        ),
  );

  checks.push(
    snapshot.metaDescription
      ? check(
          "description",
          "Description",
          "pass",
          `${snapshot.metaDescription.length} characters`,
        )
      : check(
          "description",
          "Description",
          "warn",
          "no meta description",
          "write one; it is the one summary of the page you get to control",
        ),
  );

  if (!snapshot.canonical) {
    checks.push(
      check(
        "canonical",
        "Canonical",
        "warn",
        "no canonical link",
        "add <link rel=canonical> pointing at this URL",
      ),
    );
  } else {
    const same = stripUrl(snapshot.canonical) === stripUrl(snapshot.url);
    checks.push(
      check(
        "canonical",
        "Canonical",
        same ? "pass" : "info",
        same ? "self-referential" : `points elsewhere: ${snapshot.canonical}`,
        same ? "" : "confirm this page is meant to be a duplicate of that one",
      ),
    );
  }

  const robots = (snapshot.robotsMeta ?? "").toLowerCase();
  const blocking = ["noindex", "nosnippet", "noarchive", "max-snippet:0"].filter((directive) =>
    robots.includes(directive),
  );
  checks.push(
    blocking.length > 0
      ? check(
          "robots-meta",
          "Robots meta",
          "fail",
          `the page asks not to be used: ${blocking.join(", ")}`,
          "nosnippet and max-snippet:0 in particular forbid quoting this page; remove them unless that is the intent",
        )
      : check("robots-meta", "Robots meta", "pass", robots ? `robots: ${robots}` : "nothing blocking"),
  );

  checks.push(
    snapshot.lang
      ? check("lang", "Language", "pass", `html lang="${snapshot.lang}"`)
      : check(
          "lang",
          "Language",
          "warn",
          "the html element declares no language",
          "add lang to <html>; a reader and a model both have to guess without it",
        ),
  );

  // --- the shape of the writing -------------------------------------------

  const h1Count = snapshot.headings.filter((heading) => heading.level === 1).length;
  const skips: string[] = [];
  let previous = 0;
  for (const heading of snapshot.headings) {
    if (previous > 0 && heading.level > previous + 1) {
      skips.push(`h${previous} -> h${heading.level} at "${truncate(heading.text, 40)}"`);
    }
    previous = heading.level;
  }
  checks.push(
    h1Count === 1 && skips.length === 0
      ? check(
          "headings",
          "Heading outline",
          "pass",
          `one h1 and ${snapshot.headings.length - 1} lower headings, no skipped levels`,
        )
      : check(
          "headings",
          "Heading outline",
          h1Count === 1 ? "warn" : "fail",
          [
            h1Count === 1 ? null : `${h1Count} h1 elements`,
            skips.length > 0 ? `skipped levels: ${skips.slice(0, 3).join("; ")}` : null,
          ]
            .filter(Boolean)
            .join("; "),
          "one h1, then h2 and h3 in order; the outline is how a machine finds the parts of the page",
        ),
  );

  const first = snapshot.firstParagraph;
  const opener = first.toLowerCase();
  const clearing = THROAT_CLEARING.find((phrase) => opener.startsWith(phrase) || opener.includes(phrase));
  if (first.length === 0) {
    checks.push(
      check(
        "answer-first",
        "Answer first",
        "info",
        "no paragraph was found in the article body",
        "if the page is not an article, most of this report does not apply to it",
      ),
    );
  } else if (clearing) {
    checks.push(
      check(
        "answer-first",
        "Answer first",
        "warn",
        `the opening paragraph starts with framing, not an answer: "${truncate(first, 70)}"`,
        "put the conclusion in the first paragraph; a summarizer keeps the top of the page and drops the run-up",
      ),
    );
  } else {
    checks.push(
      check(
        "answer-first",
        "Answer first",
        first.length < 40 ? "warn" : "pass",
        `${first.length} characters: "${truncate(first, 70)}"`,
        first.length < 40 ? "a one-line opener rarely carries the claim; state it outright" : "",
      ),
    );
  }

  const questionHeadings = snapshot.headings.filter(
    (heading) => heading.level >= 2 && isQuestion(heading.text),
  ).length;
  checks.push(
    check(
      "question-headings",
      "Question-shaped headings",
      questionHeadings > 0 ? "pass" : "info",
      `${questionHeadings} of ${snapshot.headings.filter((h) => h.level >= 2).length} section headings read as a question`,
      questionHeadings > 0
        ? ""
        : "headings phrased as the question a reader asks are the parts of a page that get quoted back",
    ),
  );

  const structuredBlocks = counts.lists + counts.tables;
  checks.push(
    check(
      "scannable",
      "Extractable blocks",
      structuredBlocks > 0 ? "pass" : "warn",
      `${counts.lists} list(s), ${counts.tables} table(s), ${counts.codeBlocks} code block(s) across ${counts.paragraphs} paragraph(s)`,
      structuredBlocks > 0
        ? ""
        : "a page of unbroken prose gives nothing to lift; put the steps, the comparison or the numbers in a list or a table",
    ),
  );

  checks.push(
    counts.imagesWithoutAlt === 0
      ? check(
          "image-alt",
          "Image alternatives",
          counts.images === 0 ? "info" : "pass",
          counts.images === 0 ? "no images in the article body" : `${counts.images} image(s), all with alt`,
        )
      : check(
          "image-alt",
          "Image alternatives",
          "warn",
          `${counts.imagesWithoutAlt} of ${counts.images} image(s) have no alt attribute`,
          "describe them; an image without alt is invisible to a screen reader and to anything reading the page as text",
        ),
  );

  checks.push(
    counts.externalLinks > 0
      ? check(
          "sources",
          "Outbound sources",
          "pass",
          `${counts.externalLinks} outbound link(s), ${counts.internalLinks} internal`,
        )
      : check(
          "sources",
          "Outbound sources",
          "warn",
          `no outbound links (${counts.internalLinks} internal)`,
          "link the sources the claims rest on; a page that cites nothing is harder to trust and harder to verify",
        ),
  );

  checks.push(
    snapshot.charCount < 600
      ? check(
          "length",
          "Body length",
          "warn",
          `${snapshot.charCount} characters of body text, read from ${snapshot.extractedFrom}`,
          "either this page is thin, or the article body was not where this tool looked -- check the extraction source before acting on the rest",
        )
      : check(
          "length",
          "Body length",
          "pass",
          `${snapshot.charCount} characters of body text, read from ${snapshot.extractedFrom}`,
        ),
  );

  return checks;
}

export function scoreOf(checks: Check[]): {
  passed: number;
  total: number;
  failed: number;
  warned: number;
} {
  const judged = checks.filter((item) => item.status !== "info");
  return {
    passed: judged.filter((item) => item.status === "pass").length,
    total: judged.length,
    failed: judged.filter((item) => item.status === "fail").length,
    warned: judged.filter((item) => item.status === "warn").length,
  };
}

function stripUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}
