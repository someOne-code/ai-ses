import assert from "node:assert/strict";
import test from "node:test";

import { buildUniqueGoogleSmokeSlot } from "./helpers/google-provider-smoke.ts";

test("google provider smoke slot helper is deterministic for the same seed", () => {
  const seed = "327fc179-6500-41fa-8247-319a1a47b260";
  const first = buildUniqueGoogleSmokeSlot(seed);
  const second = buildUniqueGoogleSmokeSlot(seed);

  assert.deepEqual(second, first);
});

test("google provider smoke slot helper yields different slots for different seeds", () => {
  const first = buildUniqueGoogleSmokeSlot("327fc179-6500-41fa-8247-319a1a47b260");
  const second = buildUniqueGoogleSmokeSlot("fd037ff1-c0a3-4830-be0e-0305505234f1");

  assert.notEqual(second.preferredDatetime, first.preferredDatetime);
  assert.notEqual(second.preferredDatetimeUtc, first.preferredDatetimeUtc);
});

test("google provider smoke slot helper keeps provider tests in a dedicated future window", () => {
  const slot = buildUniqueGoogleSmokeSlot("327fc179-6500-41fa-8247-319a1a47b260");

  assert.match(slot.preferredDatetime, /^2030-01-\d{2}T\d{2}:\d{2}:00\+03:00$/);
  assert.match(slot.preferredDatetimeUtc, /^2030-01-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  assert.notEqual(slot.preferredDatetime, "2026-04-02T14:00:00+03:00");
  assert.notEqual(slot.preferredDatetimeUtc, "2026-04-02T11:00:00.000Z");
});
