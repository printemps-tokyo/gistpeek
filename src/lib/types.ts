// The shapes that travel between the three parts of this extension: what the
// injected reader takes off the page, what the checks make of it, and what the
// on-device model says about it.

/** A structured-data node, flattened out of whatever JSON-LD the page ships. */
export interface StructuredNode {
  types: string[];
  headline: string | null;
  author: string | null;
  datePublished: string | null;
  dateModified: string | null;
  /** True when the node failed to parse; the page ships broken JSON-LD. */
  invalid?: boolean;
}

export interface Heading {
  level: number;
  text: string;
}

export interface PageCounts {
  paragraphs: number;
  lists: number;
  tables: number;
  images: number;
  imagesWithoutAlt: number;
  internalLinks: number;
  externalLinks: number;
  codeBlocks: number;
}

/** Everything read off the page in one injected pass. Nothing leaves the device. */
export interface PageSnapshot {
  url: string;
  host: string;
  title: string;
  lang: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  ogType: string | null;
  publishedMeta: string | null;
  modifiedMeta: string | null;
  /** `datetime` attributes of any <time> element inside the article. */
  timeAttributes: string[];
  headings: Heading[];
  structured: StructuredNode[];
  /** Text of the article body, whitespace collapsed. */
  text: string;
  firstParagraph: string;
  charCount: number;
  counts: PageCounts;
  /** How the article body was located, for when the guess is wrong. */
  extractedFrom: string;
  /** True when `text` was cut to the caller's budget. */
  truncated: boolean;
  readAt: string;
}

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  /** What was actually found. Evidence, not advice. */
  detail: string;
  /** What to change. Empty when there is nothing to do. */
  fix: string;
}

export type TargetVerdict = "kept" | "partial" | "missing" | "not-provided";

/** What the on-device model reports back, constrained to this shape. */
export interface ModelReading {
  takeaway: string;
  questionsAnswered: string[];
  citableFacts: string[];
  missing: string[];
  targetVerdict: TargetVerdict;
  targetEvidence: string;
}

export interface AiSupport {
  summarizer: AIAvailability | "missing";
  languageModel: AIAvailability | "missing";
  languageDetector: AIAvailability | "missing";
}

/** The publishing-side answer to "may an AI crawler read this at all". */
export interface CrawlerPolicy {
  origin: string;
  robotsFound: boolean;
  llmsTxtFound: boolean;
  /** User-agent -> whether the root path is disallowed for it. */
  agents: { agent: string; blocked: boolean; note: string }[];
}

export interface Report {
  snapshot: PageSnapshot;
  language: string | null;
  summary: string | null;
  reading: ModelReading | null;
  checks: Check[];
  score: { passed: number; total: number; failed: number; warned: number };
  policy: CrawlerPolicy | null;
  target: string | null;
  generatedAt: string;
  version: string;
}
