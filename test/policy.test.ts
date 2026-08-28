import { strict as assert } from "node:assert";
import { test } from "node:test";

import { AI_AGENTS, isAllowed, parseRobots, summarizePolicy } from "../src/lib/policy.js";

const ROBOTS = `
# a normal site
User-agent: *
Disallow: /admin
Allow: /admin/public

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
User-agent: PerplexityBot
Disallow: /drafts
`;

test("consecutive user-agent lines share the rules that follow", () => {
  const groups = parseRobots(ROBOTS);
  const shared = groups.find((group) => group.agents.includes("claudebot"));
  assert.ok(shared);
  assert.deepEqual(shared.agents, ["claudebot", "perplexitybot"]);
  assert.deepEqual(shared.rules, [{ allow: false, path: "/drafts" }]);
});

test("a group naming the agent wins over the wildcard group", () => {
  const groups = parseRobots(ROBOTS);
  assert.deepEqual(isAllowed(groups, "GPTBot", "/blog/post"), {
    allowed: false,
    source: "explicit",
  });
  // The * group disallows /admin, and GPTBot's own group says nothing about it,
  // so GPTBot is not covered by that rule at all.
  assert.equal(isAllowed(groups, "ClaudeBot", "/admin").allowed, true);
  assert.equal(isAllowed(groups, "Bytespider", "/admin").allowed, false);
  assert.equal(isAllowed(groups, "Bytespider", "/admin").source, "wildcard");
});

test("the longest matching rule wins, and Allow wins a tie", () => {
  const groups = parseRobots(ROBOTS);
  assert.equal(isAllowed(groups, "Bytespider", "/admin/public/page").allowed, true);
  assert.equal(isAllowed(groups, "Bytespider", "/admin/secret").allowed, false);
});

test("an agent nobody mentions is allowed, and says so", () => {
  const groups = parseRobots("User-agent: GPTBot\nDisallow: /\n");
  assert.deepEqual(isAllowed(groups, "PerplexityBot", "/"), {
    allowed: true,
    source: "default",
  });
});

test("wildcards and the end anchor are honoured", () => {
  const groups = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/private\n");
  assert.equal(isAllowed(groups, "GPTBot", "/files/report.pdf").allowed, false);
  assert.equal(isAllowed(groups, "GPTBot", "/files/report.pdf.html").allowed, true);
  assert.equal(isAllowed(groups, "GPTBot", "/a/b/private").allowed, false);
  assert.equal(isAllowed(groups, "GPTBot", "/a/b/public").allowed, true);
});

test("comments and blank lines are ignored", () => {
  const groups = parseRobots("# nothing here\n\nUser-agent: *  # everyone\nDisallow: /x\n");
  assert.equal(groups.length, 1);
  assert.equal(isAllowed(groups, "GPTBot", "/x").allowed, false);
});

test("a site with no robots.txt reports every agent as allowed", () => {
  const policy = summarizePolicy("https://example.com", null, null, "/blog");
  assert.equal(policy.robotsFound, false);
  assert.equal(policy.llmsTxtFound, false);
  assert.equal(policy.agents.length, AI_AGENTS.length);
  assert.ok(policy.agents.every((agent) => !agent.blocked));
});

test("the summary says which rule decided each agent", () => {
  const policy = summarizePolicy("https://example.com", ROBOTS, "# llms", "/blog/post");
  const gptbot = policy.agents.find((agent) => agent.agent === "GPTBot");
  assert.ok(gptbot);
  assert.equal(gptbot.blocked, true);
  assert.match(gptbot.note, /named in robots\.txt/);
  assert.equal(policy.llmsTxtFound, true);
});
