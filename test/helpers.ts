// A snapshot of a page that passes everything, so each test can break exactly
// one thing about it and assert on that.

import type { PageSnapshot } from "../src/lib/types.js";

export function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://printemps.tokyo/blog/fixed-layout-epub",
    host: "printemps.tokyo",
    title: "Fixed-layout EPUB needs a viewport on every page",
    lang: "ja",
    metaDescription: "固定レイアウトEPUBでviewportを宣言し忘れたときに何が起きるか。",
    canonical: "https://printemps.tokyo/blog/fixed-layout-epub",
    robotsMeta: null,
    ogType: "article",
    publishedMeta: "2026-08-01T00:00:00Z",
    modifiedMeta: "2026-08-20T00:00:00Z",
    timeAttributes: ["2026-08-20"],
    headings: [
      { level: 1, text: "Fixed-layout EPUB needs a viewport on every page" },
      { level: 2, text: "viewportを宣言しないと何が起きるのか" },
      { level: 2, text: "宣言の書き方" },
      { level: 3, text: "SVGページの場合" },
    ],
    structured: [
      {
        types: ["BlogPosting"],
        headline: "Fixed-layout EPUB needs a viewport on every page",
        author: "printemps.tokyo",
        datePublished: "2026-08-01",
        dateModified: "2026-08-20",
      },
    ],
    text: "固定レイアウトEPUBは、ページごとにviewportを宣言しなければ、リーディングシステムが勝手に拡大縮小する。".repeat(20),
    firstParagraph:
      "固定レイアウトEPUBは、ページごとにviewportを宣言しなければリーディングシステムに拡大縮小され、線画から先に崩れる。",
    charCount: 2400,
    counts: {
      paragraphs: 12,
      lists: 2,
      tables: 1,
      images: 3,
      imagesWithoutAlt: 0,
      internalLinks: 4,
      externalLinks: 3,
      codeBlocks: 2,
    },
    extractedFrom: "article",
    truncated: false,
    readAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

export const NOW = new Date("2026-08-29T00:00:00Z");
