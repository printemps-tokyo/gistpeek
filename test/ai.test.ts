import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isUsable, normalizeReading } from "../src/lib/ai.js";

const VALID = JSON.stringify({
  takeaway: " Fixed layout needs a viewport. ",
  questionsAnswered: ["What breaks without one?", "", "How is it declared?"],
  citableFacts: ["rendition:viewport is deprecated in EPUB 3.3"],
  missing: ["per-store size limits"],
  targetVerdict: "partial",
  targetEvidence: "Every page declares its own viewport.",
});

test("a well-formed reading is trimmed and kept", () => {
  const reading = normalizeReading(VALID, true);
  assert.equal(reading.takeaway, "Fixed layout needs a viewport.");
  assert.deepEqual(reading.questionsAnswered, ["What breaks without one?", "How is it declared?"]);
  assert.equal(reading.targetVerdict, "partial");
});

test("without an intended point there is no verdict to report", () => {
  assert.equal(normalizeReading(VALID, false).targetVerdict, "not-provided");
});

test("a verdict the model invented falls back to not-provided", () => {
  const raw = JSON.stringify({ ...JSON.parse(VALID), targetVerdict: "definitely kept" });
  assert.equal(normalizeReading(raw, true).targetVerdict, "not-provided");
});

test("lists are capped and non-strings are dropped", () => {
  const raw = JSON.stringify({
    ...JSON.parse(VALID),
    citableFacts: ["a", "b", "c", "d", "e", "f", 7, null],
  });
  assert.deepEqual(normalizeReading(raw, true).citableFacts, ["a", "b", "c", "d", "e"]);
});

test("output that is not JSON is an error, not a half-filled reading", () => {
  assert.throws(() => normalizeReading("Sure! Here is the summary:", true), /did not return/);
  assert.throws(() => normalizeReading("42", true), /did not return/);
});

test("a model that is downloadable is still usable, a missing one is not", () => {
  assert.equal(isUsable("available"), true);
  assert.equal(isUsable("downloadable"), true);
  assert.equal(isUsable("downloading"), true);
  assert.equal(isUsable("unavailable"), false);
  assert.equal(isUsable("missing"), false);
});
