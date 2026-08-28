// The panel: read the page, run the checks, ask the local model, show all of
// it, and let the result leave as Markdown or JSON.
//
// The order matters. The deterministic checks are rendered as soon as the page
// has been read, before any model work starts, so the panel is useful on a
// machine where the model is missing or still downloading -- and so a slow
// summary never hides the findings that did not need one.

import { extractSnapshot } from "./inject/extract.js";
import {
  detectLanguage,
  detectSupport,
  isUsable,
  MAX_SUMMARY_CHARS,
  readWithModel,
  streamSummary,
} from "./lib/ai.js";
import { runChecks, scoreOf, truncate } from "./lib/checks.js";
import { summarizePolicy } from "./lib/policy.js";
import { fileNameFor, toJson, toMarkdown } from "./lib/report.js";
import type { AiSupport, Check, CrawlerPolicy, PageSnapshot, Report } from "./lib/types.js";

const TARGET_KEY = "gistpeek.target";

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element: ${id}`);
  return found as T;
};

const ui = {
  modelState: el<HTMLSpanElement>("model-state"),
  pageLine: el<HTMLParagraphElement>("page-line"),
  target: el<HTMLTextAreaElement>("target"),
  run: el<HTMLButtonElement>("run"),
  stop: el<HTMLButtonElement>("stop"),
  status: el<HTMLParagraphElement>("status"),
  summaryCard: el<HTMLElement>("summary-card"),
  summary: el<HTMLDivElement>("summary"),
  takeaway: el<HTMLParagraphElement>("takeaway"),
  targetVerdict: el<HTMLDivElement>("target-verdict"),
  lists: el<HTMLDivElement>("lists"),
  checksCard: el<HTMLElement>("checks-card"),
  checks: el<HTMLUListElement>("checks"),
  score: el<HTMLSpanElement>("score"),
  policy: el<HTMLButtonElement>("policy"),
  policyResult: el<HTMLDivElement>("policy-result"),
  copy: el<HTMLButtonElement>("copy"),
  download: el<HTMLButtonElement>("download"),
  version: el<HTMLSpanElement>("version"),
};

let support: AiSupport | null = null;
let current: Report | null = null;
let running: AbortController | null = null;

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  ui.status.textContent = message;
  ui.status.dataset["kind"] = kind;
}

function describeModel(state: AiSupport): { text: string; className: string } {
  if (state.summarizer === "missing" && state.languageModel === "missing") {
    return { text: "no built-in model in this browser", className: "pill pill--missing" };
  }
  if (state.summarizer === "unavailable" && state.languageModel === "unavailable") {
    return { text: "model unavailable on this device", className: "pill pill--missing" };
  }
  if (state.summarizer === "downloadable" || state.languageModel === "downloadable") {
    return { text: "model not downloaded yet", className: "pill" };
  }
  if (state.summarizer === "downloading" || state.languageModel === "downloading") {
    return { text: "model downloading", className: "pill" };
  }
  return { text: "on-device model ready", className: "pill pill--ready" };
}

async function init(): Promise<void> {
  ui.version.textContent = `v${chrome.runtime.getManifest().version}`;

  const stored = await chrome.storage.local.get([TARGET_KEY]);
  const savedTarget = stored[TARGET_KEY];
  if (typeof savedTarget === "string") ui.target.value = savedTarget;

  const tab = await activeTab();
  ui.pageLine.textContent = tab?.url ? truncate(tab.url, 90) : "no page in view";

  support = await detectSupport();
  const described = describeModel(support);
  ui.modelState.textContent = described.text;
  ui.modelState.className = described.className;
  if (!isUsable(support.summarizer) && !isUsable(support.languageModel)) {
    setStatus(
      "The checks below still run. The summary needs Chrome's built-in model, which this device does not have.",
    );
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/**
 * Read the page. `activeTab` covers the tab the user invoked the extension on;
 * when it does not (a tab the panel outlived, a site the user has not granted),
 * the failure is reported with the one thing that fixes it.
 */
async function readPage(tabId: number): Promise<PageSnapshot> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractSnapshot,
    args: [MAX_SUMMARY_CHARS],
  });
  if (!injection?.result) throw new Error("the page returned nothing to read");
  return injection.result;
}

async function run(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No page in view.", "error");
    return;
  }

  running?.abort();
  running = new AbortController();
  const signal = running.signal;

  ui.run.disabled = true;
  ui.stop.hidden = false;
  resetOutput();
  setStatus("reading the page...");

  let snapshot: PageSnapshot;
  try {
    snapshot = await readPage(tab.id);
  } catch (error) {
    ui.run.disabled = false;
    ui.stop.hidden = true;
    setStatus(
      `Could not read this page: ${message(error)}. Chrome blocks extensions on its own pages; on a normal site, click the toolbar button on that tab first.`,
      "error",
    );
    return;
  }

  const checks = runChecks(snapshot);
  renderChecks(checks);

  const target = ui.target.value.trim();
  await chrome.storage.local.set({ [TARGET_KEY]: target });

  current = {
    snapshot,
    language: null,
    summary: null,
    reading: null,
    checks,
    score: scoreOf(checks),
    policy: current?.policy ?? null,
    target: target.length > 0 ? target : null,
    generatedAt: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
  };
  ui.copy.disabled = false;
  ui.download.disabled = false;

  ui.pageLine.textContent = `${truncate(snapshot.title || snapshot.url, 70)} - ${snapshot.charCount} characters from ${snapshot.extractedFrom}`;

  if (!support || (!isUsable(support.summarizer) && !isUsable(support.languageModel))) {
    setStatus("Checks done. The summary needs the browser's built-in model.");
    finish();
    return;
  }

  try {
    setStatus("detecting the language...");
    const language = await detectLanguage(snapshot.text);
    current.language = language;

    if (isUsable(support.summarizer)) {
      setStatus("summarizing on this device...");
      ui.summaryCard.hidden = false;
      for await (const partial of streamSummary(snapshot.text, {
        language,
        type: "key-points",
        onProgress: setStatus,
      })) {
        if (signal.aborted) break;
        ui.summary.textContent = partial;
        current.summary = partial;
      }
    }

    if (!signal.aborted && isUsable(support.languageModel)) {
      setStatus("asking what it took away...");
      const reading = await readWithModel(snapshot.text, target, language, setStatus);
      current.reading = reading;
      renderReading();
    }

    setStatus(
      snapshot.truncated
        ? `Done. The page was longer than ${MAX_SUMMARY_CHARS} characters, so the model read the beginning of it.`
        : "Done.",
    );
  } catch (error) {
    setStatus(`The model stopped: ${message(error)}`, "error");
  } finally {
    finish();
  }
}

function finish(): void {
  ui.run.disabled = false;
  ui.stop.hidden = true;
  running = null;
}

function resetOutput(): void {
  ui.summary.textContent = "";
  ui.takeaway.hidden = true;
  ui.targetVerdict.hidden = true;
  ui.lists.textContent = "";
  ui.summaryCard.hidden = true;
}

function renderChecks(checks: Check[]): void {
  const score = scoreOf(checks);
  ui.score.textContent = `${score.passed}/${score.total} passed, ${score.warned} warning(s), ${score.failed} failure(s)`;
  ui.checks.textContent = "";

  for (const check of checks) {
    const item = document.createElement("li");

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.dataset["status"] = check.status;
    tag.textContent = check.status;

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "check-title";
    title.textContent = check.title;
    const detail = document.createElement("div");
    detail.textContent = check.detail;
    body.append(title, detail);

    if (check.fix) {
      const fix = document.createElement("div");
      fix.className = "check-fix";
      fix.textContent = check.fix;
      body.append(fix);
    }

    item.append(tag, body);
    ui.checks.append(item);
  }
  ui.checksCard.hidden = false;
}

function renderReading(): void {
  const reading = current?.reading;
  if (!reading) return;
  ui.summaryCard.hidden = false;

  if (reading.takeaway) {
    ui.takeaway.textContent = reading.takeaway;
    ui.takeaway.hidden = false;
  }

  ui.lists.textContent = "";
  const block = (heading: string, items: string[]): void => {
    if (items.length === 0) return;
    const title = document.createElement("h3");
    title.textContent = heading;
    const list = document.createElement("ul");
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      list.append(entry);
    }
    ui.lists.append(title, list);
  };
  block("Questions this page answers", reading.questionsAnswered);
  block("Facts worth quoting", reading.citableFacts);
  block("Still missing for a reader", reading.missing);

  if (reading.targetVerdict !== "not-provided") {
    ui.targetVerdict.dataset["verdict"] = reading.targetVerdict;
    const verdictText: Record<string, string> = {
      kept: "Your point survived the summary.",
      partial: "Your point is only partly there.",
      missing: "Your point did not survive the summary.",
    };
    ui.targetVerdict.textContent = verdictText[reading.targetVerdict] ?? "";
    if (reading.targetEvidence) {
      const evidence = document.createElement("div");
      evidence.className = "muted";
      evidence.textContent = reading.targetEvidence;
      ui.targetVerdict.append(evidence);
    }
    ui.targetVerdict.hidden = false;
  }
}

/** robots.txt and llms.txt for the origin in view, on request and nothing more. */
async function checkPolicy(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.url) {
    setStatus("No page in view.", "error");
    return;
  }

  let origin: string;
  let path: string;
  try {
    const url = new URL(tab.url);
    origin = url.origin;
    path = url.pathname;
  } catch {
    setStatus("This page has no origin to check.", "error");
    return;
  }

  const pattern = `${origin}/*`;
  const granted =
    (await chrome.permissions.contains({ origins: [pattern] })) ||
    (await chrome.permissions.request({ origins: [pattern] }));
  if (!granted) {
    setStatus("Access to this site was declined, so robots.txt was not read.");
    return;
  }

  ui.policy.disabled = true;
  setStatus(`fetching ${origin}/robots.txt ...`);
  const fetchText = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url, { credentials: "omit" });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  };

  const [robots, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
  ]);
  const policy = summarizePolicy(origin, robots, llms, path || "/");
  if (current) current.policy = policy;
  renderPolicy(policy);
  ui.policy.disabled = false;
  setStatus("Done.");
}

function renderPolicy(policy: CrawlerPolicy): void {
  ui.policyResult.textContent = "";

  const head = document.createElement("p");
  head.className = "muted";
  head.textContent = `${policy.origin}: robots.txt ${policy.robotsFound ? "found" : "not found"}, llms.txt ${
    policy.llmsTxtFound ? "found" : "not found"
  }`;
  ui.policyResult.append(head);

  const list = document.createElement("ul");
  list.className = "agents";
  for (const agent of policy.agents) {
    const item = document.createElement("li");
    const state = document.createElement("span");
    state.className = agent.blocked ? "blocked" : "allowed";
    state.textContent = agent.blocked ? "blocked" : "allowed";
    const name = document.createElement("strong");
    name.textContent = agent.agent;
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = agent.note;
    item.append(state, name, note);
    list.append(item);
  }
  ui.policyResult.append(list);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

ui.run.addEventListener("click", () => {
  void run();
});
ui.stop.addEventListener("click", () => {
  running?.abort();
  setStatus("Stopped.");
  finish();
});
ui.policy.addEventListener("click", () => {
  void checkPolicy();
});
ui.copy.addEventListener("click", () => {
  if (!current) return;
  void navigator.clipboard.writeText(toMarkdown(current)).then(
    () => setStatus("Markdown copied."),
    () => setStatus("Could not write to the clipboard.", "error"),
  );
});
ui.download.addEventListener("click", () => {
  if (!current) return;
  download(toJson(current), fileNameFor(current, "json"), "application/json");
});

void init();
