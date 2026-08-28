// Turning a reading into something that leaves the panel: Markdown for a
// pull request or an editorial note, JSON for anything downstream.

import type { Check, Report } from "./types.js";

const STATUS_MARK: Record<Check["status"], string> = {
  pass: "ok",
  warn: "warn",
  fail: "FAIL",
  info: "--",
};

export function toMarkdown(report: Report): string {
  const { snapshot, checks, score } = report;
  const lines: string[] = [];

  lines.push(`# gistpeek: ${snapshot.title || snapshot.url}`);
  lines.push("");
  lines.push(`- URL: ${snapshot.url}`);
  lines.push(`- Read: ${report.generatedAt}`);
  lines.push(
    `- Body: ${snapshot.charCount} characters from \`${snapshot.extractedFrom}\`${
      snapshot.truncated ? " (truncated before the model saw it)" : ""
    }`,
  );
  if (report.language) lines.push(`- Language: ${report.language}`);
  lines.push("");

  if (report.summary) {
    lines.push("## What the on-device model takes away");
    lines.push("");
    lines.push(report.summary.trim());
    lines.push("");
  }

  const reading = report.reading;
  if (reading) {
    if (reading.takeaway) {
      lines.push(`> ${reading.takeaway}`);
      lines.push("");
    }
    const section = (title: string, items: string[]): void => {
      if (items.length === 0) return;
      lines.push(`### ${title}`);
      lines.push("");
      for (const item of items) lines.push(`- ${item}`);
      lines.push("");
    };
    section("Questions this page answers", reading.questionsAnswered);
    section("Facts worth quoting", reading.citableFacts);
    section("Still missing for a reader", reading.missing);

    if (reading.targetVerdict !== "not-provided" && report.target) {
      lines.push("### The point you wanted to land");
      lines.push("");
      lines.push(`- Intended: ${report.target}`);
      lines.push(`- Verdict: ${reading.targetVerdict}`);
      if (reading.targetEvidence) lines.push(`- Evidence: ${reading.targetEvidence}`);
      lines.push("");
    }
  }

  lines.push("## Checks");
  lines.push("");
  lines.push(`${score.passed}/${score.total} passed, ${score.warned} warning(s), ${score.failed} failure(s)`);
  lines.push("");
  lines.push("| | check | found | fix |");
  lines.push("| --- | --- | --- | --- |");
  for (const check of checks) {
    lines.push(
      `| ${STATUS_MARK[check.status]} | ${check.title} | ${escapeCell(check.detail)} | ${escapeCell(check.fix)} |`,
    );
  }
  lines.push("");

  if (report.policy) {
    const blocked = report.policy.agents.filter((agent) => agent.blocked);
    lines.push("## AI crawler policy");
    lines.push("");
    lines.push(
      `${report.policy.origin}: robots.txt ${report.policy.robotsFound ? "found" : "not found"}, llms.txt ${
        report.policy.llmsTxtFound ? "found" : "not found"
      }`,
    );
    lines.push("");
    lines.push(
      blocked.length === 0
        ? "- No listed AI crawler is disallowed from this path."
        : `- Disallowed here: ${blocked.map((agent) => agent.agent).join(", ")}`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `Produced locally by gistpeek ${report.version}. The summary came from the browser's built-in model; nothing on this page was sent anywhere.`,
  );
  return `${lines.join("\n")}\n`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function toJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** A filename that says which page it came from, without inventing a title. */
export function fileNameFor(report: Report, extension: string): string {
  let slug = "page";
  try {
    const url = new URL(report.snapshot.url);
    slug = `${url.host}${url.pathname}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  } catch {
    // A URL that will not parse is not worth a better name than "page".
  }
  return `gistpeek-${slug.slice(0, 60)}.${extension}`;
}
