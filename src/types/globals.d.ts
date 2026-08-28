// Ambient declarations for the two platform surfaces this extension stands on.
//
// Neither is in the TypeScript DOM library yet, and only the members actually
// used here are declared. That keeps the install to a single dev dependency
// and keeps the shape of what we depend on visible in one file. Both were
// written against the official documentation, read on 2026-08-29:
//   https://developer.chrome.com/docs/ai/summarizer-api
//   https://developer.chrome.com/docs/extensions/ai/prompt-api
//   https://developer.chrome.com/docs/ai/language-detection
//   https://developer.chrome.com/docs/extensions/reference/api/sidePanel

// --- Built-in AI ------------------------------------------------------------

/** Every built-in AI entry point reports readiness with this vocabulary. */
type AIAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface AICreateMonitor extends EventTarget {
  addEventListener(
    type: "downloadprogress",
    listener: (event: { loaded: number }) => void,
  ): void;
}

interface SummarizerCreateOptions {
  sharedContext?: string;
  type?: "key-points" | "tldr" | "teaser" | "headline";
  format?: "markdown" | "plain-text";
  length?: "short" | "medium" | "long";
  expectedInputLanguages?: string[];
  outputLanguage?: string;
  monitor?: (monitor: AICreateMonitor) => void;
  signal?: AbortSignal;
}

interface SummarizerInstance {
  summarize(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  summarizeStreaming(
    input: string,
    options?: { context?: string; signal?: AbortSignal },
  ): AsyncIterable<string>;
  destroy(): void;
}

declare const Summarizer: {
  availability(options?: SummarizerCreateOptions): Promise<AIAvailability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
};

interface LanguageModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelMessage[];
  temperature?: number;
  topK?: number;
  expectedInputs?: { type: "text"; languages?: string[] }[];
  expectedOutputs?: { type: "text"; languages?: string[] }[];
  monitor?: (monitor: AICreateMonitor) => void;
  signal?: AbortSignal;
}

interface LanguageModelPromptOptions {
  /** A JSON Schema the model output is constrained to. */
  responseConstraint?: object;
  omitResponseConstraintInput?: boolean;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): AsyncIterable<string>;
  readonly contextUsage: number;
  readonly contextWindow: number;
  destroy(): void;
}

declare const LanguageModel: {
  availability(options?: LanguageModelCreateOptions): Promise<AIAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  params(): Promise<{
    defaultTopK: number;
    maxTopK: number;
    defaultTemperature: number;
    maxTemperature: number;
  }>;
};

interface LanguageDetectorInstance {
  detect(input: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
  destroy(): void;
}

declare const LanguageDetector: {
  availability(options?: { expectedInputLanguages?: string[] }): Promise<AIAvailability>;
  create(options?: {
    expectedInputLanguages?: string[];
    monitor?: (monitor: AICreateMonitor) => void;
  }): Promise<LanguageDetectorInstance>;
};

// --- The slice of the extension platform this extension touches -------------

declare namespace chrome {
  namespace runtime {
    const lastError: { message?: string } | undefined;
    const onInstalled: { addListener(callback: () => void): void };
    const onStartup: { addListener(callback: () => void): void };
    function getURL(path: string): string;
    function getManifest(): { version: string; name: string };
  }

  namespace sidePanel {
    function setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      windowId?: number;
    }
    function query(query: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result?: T;
      frameId: number;
    }
    function executeScript<Args extends unknown[], R>(injection: {
      target: { tabId: number };
      func: (...args: Args) => R;
      args?: Args;
    }): Promise<InjectionResult<R>[]>;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string[] | string | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
  }

  namespace permissions {
    function contains(permissions: { origins?: string[] }): Promise<boolean>;
    function request(permissions: { origins?: string[] }): Promise<boolean>;
  }
}
