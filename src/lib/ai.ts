// The on-device model, wrapped so the panel can degrade instead of breaking.
//
// Three built-in APIs are used and none of them is assumed to be there: the
// model is a multi-gigabyte download the user may not have, may be fetching
// right now, or may be on hardware that cannot run it. Every entry point
// reports its state first (`unavailable` / `downloadable` / `downloading` /
// `available`), and the panel shows the deterministic checks regardless.
//
// Nothing here makes a network request. Inference runs locally, which is the
// whole reason this extension can be pointed at an unpublished draft.

import type { AiSupport, ModelReading, TargetVerdict } from "./types.js";

/** How much of the page is handed to the model, in characters. */
export const MAX_MODEL_CHARS = 4000;

/** How much is handed to the summarizer, which is built for longer input. */
export const MAX_SUMMARY_CHARS = 12000;

export type Progress = (message: string) => void;

export async function detectSupport(): Promise<AiSupport> {
  const probe = async (
    present: boolean,
    availability: () => Promise<AIAvailability>,
  ): Promise<AIAvailability | "missing"> => {
    if (!present) return "missing";
    try {
      return await availability();
    } catch {
      return "unavailable";
    }
  };

  return {
    summarizer: await probe("Summarizer" in self, () => Summarizer.availability()),
    languageModel: await probe("LanguageModel" in self, () => LanguageModel.availability()),
    languageDetector: await probe("LanguageDetector" in self, () =>
      LanguageDetector.availability(),
    ),
  };
}

export function isUsable(state: AIAvailability | "missing"): boolean {
  return state === "available" || state === "downloadable" || state === "downloading";
}

/** The page's language, so the summary comes back in the language it was written in. */
export async function detectLanguage(text: string): Promise<string | null> {
  if (!("LanguageDetector" in self)) return null;
  try {
    const detector = await LanguageDetector.create();
    const results = await detector.detect(text.slice(0, 1000));
    detector.destroy();
    const best = results[0];
    return best && best.confidence > 0.5 ? best.detectedLanguage : null;
  } catch {
    return null;
  }
}

function progressMonitor(onProgress: Progress, what: string) {
  return (monitor: AICreateMonitor): void => {
    monitor.addEventListener("downloadprogress", (event) => {
      onProgress(`downloading the ${what} model: ${Math.round(event.loaded * 100)}%`);
    });
  };
}

/**
 * Summarize the page, streaming.
 *
 * Chrome has shipped both delta and cumulative chunks over the life of this
 * API, so the accumulated text is rebuilt defensively rather than assuming
 * one of them.
 */
export async function* streamSummary(
  text: string,
  options: { language: string | null; type: "tldr" | "key-points"; onProgress: Progress },
): AsyncGenerator<string> {
  const create = async (withLanguage: boolean): Promise<SummarizerInstance> =>
    Summarizer.create({
      type: options.type,
      format: "markdown",
      length: "short",
      sharedContext:
        "A published article. Summarize what a reader takes away, not what the article says about itself.",
      ...(withLanguage && options.language
        ? { expectedInputLanguages: [options.language], outputLanguage: options.language }
        : {}),
      monitor: progressMonitor(options.onProgress, "summarizer"),
    });

  let summarizer: SummarizerInstance;
  try {
    summarizer = await create(true);
  } catch {
    // An unsupported language pair is a reason to fall back to the default
    // output language, not a reason to show nothing.
    summarizer = await create(false);
  }

  let accumulated = "";
  try {
    for await (const chunk of summarizer.summarizeStreaming(text.slice(0, MAX_SUMMARY_CHARS))) {
      accumulated = chunk.startsWith(accumulated) ? chunk : accumulated + chunk;
      yield accumulated;
    }
  } finally {
    summarizer.destroy();
  }
}

const READING_SCHEMA = {
  type: "object",
  properties: {
    takeaway: { type: "string" },
    questionsAnswered: { type: "array", items: { type: "string" }, maxItems: 5 },
    citableFacts: { type: "array", items: { type: "string" }, maxItems: 5 },
    missing: { type: "array", items: { type: "string" }, maxItems: 5 },
    targetVerdict: { type: "string", enum: ["kept", "partial", "missing", "not-provided"] },
    targetEvidence: { type: "string" },
  },
  required: [
    "takeaway",
    "questionsAnswered",
    "citableFacts",
    "missing",
    "targetVerdict",
    "targetEvidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "You read a web page the way a search assistant does and report what survives.",
  "Answer only from the page text you are given. Never invent a fact that is not in it.",
  "Be concrete and short: one sentence per item, in the language the page is written in.",
].join(" ");

/**
 * Ask the model what it took away, and whether the author's intended
 * conclusion is part of it.
 *
 * `target` is the sentence the author wants a reader to leave with. When it is
 * empty the verdict is `not-provided`, which is a state and not a failure.
 */
export async function readWithModel(
  text: string,
  target: string,
  language: string | null,
  onProgress: Progress,
): Promise<ModelReading> {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    ...(language ? { expectedInputs: [{ type: "text", languages: [language, "en"] }] } : {}),
    monitor: progressMonitor(onProgress, "language"),
  });

  const trimmedTarget = target.trim();
  const instruction = [
    "PAGE TEXT:",
    text.slice(0, MAX_MODEL_CHARS),
    "",
    "Report:",
    "- takeaway: the single thing a reader leaves with.",
    "- questionsAnswered: questions this page actually answers.",
    "- citableFacts: specific facts, numbers or definitions worth quoting from it.",
    "- missing: what a reader still has to look up elsewhere.",
    trimmedTarget
      ? `- targetVerdict: does the page make this point clearly -- "${trimmedTarget}"? Answer kept, partial or missing, and quote the sentence that carries it in targetEvidence.`
      : "- targetVerdict: not-provided, and leave targetEvidence empty.",
  ].join("\n");

  try {
    const raw = await session.prompt(instruction, { responseConstraint: READING_SCHEMA });
    return normalizeReading(raw, trimmedTarget.length > 0);
  } finally {
    session.destroy();
  }
}

/**
 * The response is schema-constrained, but a local model is still a model:
 * the panel gets a well-formed reading or a clear failure, never half of one.
 */
export function normalizeReading(raw: string, hasTarget: boolean): ModelReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("the model did not return the requested JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("the model did not return the requested JSON");
  }
  const record = parsed as Record<string, unknown>;

  const asStringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, 5)
      : [];

  const verdicts: TargetVerdict[] = ["kept", "partial", "missing", "not-provided"];
  const rawVerdict = typeof record["targetVerdict"] === "string" ? record["targetVerdict"] : "";
  const verdict = verdicts.find((value) => value === rawVerdict) ?? "not-provided";

  return {
    takeaway: typeof record["takeaway"] === "string" ? record["takeaway"].trim() : "",
    questionsAnswered: asStringList(record["questionsAnswered"]),
    citableFacts: asStringList(record["citableFacts"]),
    missing: asStringList(record["missing"]),
    targetVerdict: hasTarget ? verdict : "not-provided",
    targetEvidence:
      typeof record["targetEvidence"] === "string" ? record["targetEvidence"].trim() : "",
  };
}
