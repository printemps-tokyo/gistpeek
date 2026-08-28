// The one function that runs inside the page.
//
// It is handed to chrome.scripting.executeScript as a value, so the browser
// serializes it: it can close over nothing, import nothing and call nothing
// from this module. Every helper is therefore nested inside it, which is ugly
// and is the price of the injection contract. Everything it collects stays on
// the device -- the return value goes straight back to the side panel.

import type { PageSnapshot, Heading, StructuredNode } from "../lib/types.js";

export function extractSnapshot(maxChars: number): PageSnapshot {
  const collapse = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/g, " ").trim();

  const metaContent = (selector: string): string | null => {
    const element = document.querySelector<HTMLMetaElement>(selector);
    const value = collapse(element?.content);
    return value.length > 0 ? value : null;
  };

  // The article body. Semantic containers are trusted first; when a page has
  // none, the densest block of paragraph text wins, with link-heavy blocks
  // (navigation, related-post rails) discounted.
  const findArticle = (): { root: Element; from: string } => {
    for (const selector of ["article", "main", "[role='main']", "#content", ".post-content"]) {
      const candidate = document.querySelector(selector);
      if (candidate && collapse(candidate.textContent).length > 200) {
        return { root: candidate, from: selector };
      }
    }

    let best: Element | null = null;
    let bestScore = 0;
    for (const candidate of Array.from(document.querySelectorAll("div, section"))) {
      const paragraphs = candidate.querySelectorAll("p").length;
      if (paragraphs < 2) continue;
      const text = collapse(candidate.textContent).length;
      const linkText = Array.from(candidate.querySelectorAll("a")).reduce(
        (sum, link) => sum + collapse(link.textContent).length,
        0,
      );
      const density = text === 0 ? 1 : linkText / text;
      const score = text * (1 - Math.min(density, 1)) * Math.min(paragraphs, 20);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) return { root: best, from: "densest text block" };
    return { root: document.body, from: "document body" };
  };

  const { root, from } = findArticle();

  // Chrome removes nothing for us: navigation and footers inside the chosen
  // root are dropped here so the model is not fed the site furniture.
  const clone = root.cloneNode(true) as Element;
  for (const junk of Array.from(
    clone.querySelectorAll("script, style, nav, aside, footer, form, noscript, template, [aria-hidden='true']"),
  )) {
    junk.remove();
  }

  const headings: Heading[] = Array.from(
    clone.querySelectorAll("h1, h2, h3, h4, h5, h6"),
  )
    .map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: collapse(element.textContent),
    }))
    .filter((heading) => heading.text.length > 0);

  // A page's own <h1> often sits outside the article container.
  const documentH1 = document.querySelector("h1");
  if (documentH1 && !headings.some((h) => h.level === 1)) {
    const text = collapse(documentH1.textContent);
    if (text.length > 0) headings.unshift({ level: 1, text });
  }

  const paragraphs = Array.from(clone.querySelectorAll("p"))
    .map((p) => collapse(p.textContent))
    .filter((text) => text.length > 0);

  const links = Array.from(clone.querySelectorAll<HTMLAnchorElement>("a[href]"));
  let internalLinks = 0;
  let externalLinks = 0;
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#") || href.startsWith("javascript:")) continue;
    try {
      const resolved = new URL(href, document.baseURI);
      if (resolved.host === location.host) internalLinks += 1;
      else if (resolved.protocol === "http:" || resolved.protocol === "https:") externalLinks += 1;
    } catch {
      // A malformed href tells us nothing; it is not a finding of this tool.
    }
  }

  const images = Array.from(clone.querySelectorAll("img"));

  // JSON-LD, flattened: @graph, arrays and single nodes all end up as a list.
  const structured: StructuredNode[] = [];
  const pickString = (value: unknown): string | null => {
    if (typeof value === "string") return collapse(value) || null;
    if (Array.isArray(value)) return pickString(value[0]);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return pickString(record["name"] ?? record["@id"] ?? null);
    }
    return null;
  };
  const pushNode = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record["@graph"])) {
      for (const child of record["@graph"]) pushNode(child);
      return;
    }
    const rawType = record["@type"];
    const types = Array.isArray(rawType)
      ? rawType.map(String)
      : typeof rawType === "string"
        ? [rawType]
        : [];
    structured.push({
      types,
      headline: pickString(record["headline"] ?? record["name"]),
      author: pickString(record["author"]),
      datePublished: pickString(record["datePublished"]),
      dateModified: pickString(record["dateModified"]),
    });
  };
  for (const script of Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']"),
  )) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? "");
      if (Array.isArray(parsed)) parsed.forEach(pushNode);
      else pushNode(parsed);
    } catch {
      structured.push({
        types: [],
        headline: null,
        author: null,
        datePublished: null,
        dateModified: null,
        invalid: true,
      });
    }
  }

  const bodyText = collapse((clone as HTMLElement).innerText ?? clone.textContent);
  const truncated = bodyText.length > maxChars;

  return {
    url: location.href,
    host: location.host,
    title: collapse(document.title),
    lang: collapse(document.documentElement.lang) || null,
    metaDescription: metaContent("meta[name='description']"),
    canonical:
      document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href ?? null,
    robotsMeta: metaContent("meta[name='robots']"),
    ogType: metaContent("meta[property='og:type']"),
    publishedMeta: metaContent("meta[property='article:published_time']"),
    modifiedMeta: metaContent("meta[property='article:modified_time']"),
    timeAttributes: Array.from(clone.querySelectorAll("time[datetime]"))
      .map((element) => element.getAttribute("datetime") ?? "")
      .filter((value) => value.length > 0)
      .slice(0, 8),
    headings,
    structured,
    text: truncated ? bodyText.slice(0, maxChars) : bodyText,
    firstParagraph: paragraphs[0] ?? "",
    charCount: bodyText.length,
    counts: {
      paragraphs: paragraphs.length,
      lists: clone.querySelectorAll("ul, ol").length,
      tables: clone.querySelectorAll("table").length,
      images: images.length,
      imagesWithoutAlt: images.filter((img) => !img.hasAttribute("alt")).length,
      internalLinks,
      externalLinks,
      codeBlocks: clone.querySelectorAll("pre, code").length,
    },
    extractedFrom: from,
    truncated,
    readAt: new Date().toISOString(),
  };
}
