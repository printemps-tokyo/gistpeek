// The publishing-side question: is an AI crawler allowed to read this at all.
//
// A page can be written perfectly for a summarizer and still be off limits,
// because robots.txt says so three levels up. That is a different failure from
// anything on the page, and it is invisible while you are looking at the page,
// so it gets its own section -- fetched only when the user asks for it, and
// only for the origin they are already on.
//
// The parse follows the de facto robots.txt rules (RFC 9309): groups are keyed
// by User-agent, the most specific matching group wins, and the longest
// matching path rule wins within it.

import type { CrawlerPolicy } from "./types.js";

/**
 * The crawlers worth reporting on, with what each one is for. Names are the
 * tokens the operators publish; whether a given bot honours robots.txt is not
 * something this tool can verify, and it does not claim to.
 */
export const AI_AGENTS: { agent: string; purpose: string }[] = [
  { agent: "GPTBot", purpose: "OpenAI, training" },
  { agent: "OAI-SearchBot", purpose: "OpenAI, search index" },
  { agent: "ChatGPT-User", purpose: "OpenAI, user-triggered fetch" },
  { agent: "ClaudeBot", purpose: "Anthropic, training" },
  { agent: "Claude-User", purpose: "Anthropic, user-triggered fetch" },
  { agent: "Claude-SearchBot", purpose: "Anthropic, search index" },
  { agent: "PerplexityBot", purpose: "Perplexity, search index" },
  { agent: "Google-Extended", purpose: "Google, Gemini training and grounding" },
  { agent: "Applebot-Extended", purpose: "Apple, training" },
  { agent: "CCBot", purpose: "Common Crawl" },
  { agent: "Bytespider", purpose: "ByteDance" },
  { agent: "meta-externalagent", purpose: "Meta" },
];

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let expectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share the rules that follow them.
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgents = true;
      continue;
    }
    if (field === "allow" || field === "disallow") {
      if (!current) continue;
      expectingAgents = false;
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

/** Whether `path` is allowed for `agent`, and which group decided it. */
export function isAllowed(
  groups: RobotsGroup[],
  agent: string,
  path: string,
): { allowed: boolean; source: "explicit" | "wildcard" | "default" } {
  const wanted = agent.toLowerCase();
  const explicit = groups.filter((group) => group.agents.includes(wanted));
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const chosen = explicit.length > 0 ? explicit : wildcard;
  const source = explicit.length > 0 ? "explicit" : wildcard.length > 0 ? "wildcard" : "default";
  if (chosen.length === 0) return { allowed: true, source: "default" };

  // Longest match wins; Allow wins a tie, as the standard specifies.
  let best: { allow: boolean; length: number } | null = null;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (rule.path === "") continue;
      if (!matches(rule.path, path)) continue;
      const length = rule.path.length;
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
  }
  return { allowed: best ? best.allow : true, source };
}

function matches(pattern: string, path: string): boolean {
  // Only the two wildcards robots.txt actually defines: * and end-anchoring $.
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const segments = body.split("*");
  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? "";
    if (segment.length === 0) continue;
    const found = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, index);
    if (found < 0) return false;
    index = found + segment.length;
  }
  return anchored ? index === path.length : true;
}

export function summarizePolicy(
  origin: string,
  robots: string | null,
  llmsTxt: string | null,
  path: string,
): CrawlerPolicy {
  const groups = robots ? parseRobots(robots) : [];
  return {
    origin,
    robotsFound: robots !== null,
    llmsTxtFound: llmsTxt !== null,
    agents: AI_AGENTS.map(({ agent, purpose }) => {
      const verdict = robots ? isAllowed(groups, agent, path) : { allowed: true, source: "default" as const };
      const note =
        verdict.source === "explicit"
          ? `${purpose}, named in robots.txt`
          : verdict.source === "wildcard"
            ? `${purpose}, covered by the * group`
            : `${purpose}, no rule`;
      return { agent, blocked: !verdict.allowed, note };
    }),
  };
}
