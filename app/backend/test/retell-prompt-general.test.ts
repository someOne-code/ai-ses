import assert from "node:assert/strict";
import test from "node:test";

import { generalPrompt } from "../src/modules/retell/prompt-source/general.js";

test("global prompt keeps verified listing guardrails", () => {
  assert.match(
    generalPrompt,
    /Treat backend tool output as the only source of truth for listing-specific details\./
  );
  assert.match(
    generalPrompt,
    /A spoken listing reference code is only a lookup key, not proof of listing details\./
  );
  assert.match(
    generalPrompt,
    /Do not say any property detail from a spoken reference code until a verified backend lookup returns\./
  );
  assert.match(
    generalPrompt,
    /Offer possible candidates only as approximate alternatives, never as confirmed exact matches\./
  );
  assert.doesNotMatch(
    generalPrompt,
    /Before verified lookup, only acknowledge and check\./
  );
});

test("global prompt no longer contains showing request sequencing or submission workflow prose", () => {
  const forbiddenWorkflowPhrases = [
    "create_showing_request",
    "contact-number step",
    "Missing-field priority order",
    "preferredDatetime",
    "preferredTimeWindow",
    "visit day is mandatory",
    "Only transition directly to showing_request",
    "Do not use end_call while any required field is still missing or unclear"
  ];

  for (const phrase of forbiddenWorkflowPhrases) {
    assert.equal(
      generalPrompt.includes(phrase),
      false,
      `did not expect global prompt to contain: ${phrase}`
    );
  }
});

test("global prompt no longer duplicates state-specific repair behavior", () => {
  const forbiddenRepairPhrases = [
    "Field-specific repair override",
    "repairStep=customerPhone",
    "repairStep=preferredDatetime",
    "repairStep=preferredTimeWindow",
    "repairStep=referenceCode",
    "If create_showing_request fails",
    "repair only the callback number",
    "repeat the full number again from the beginning in short blocks",
    "Stay on reference-code repair until one of these happens",
    "Do not pivot to search_listings"
  ];

  for (const phrase of forbiddenRepairPhrases) {
    assert.equal(
      generalPrompt.includes(phrase),
      false,
      `did not expect global prompt to contain: ${phrase}`
    );
  }
});

test("global prompt no longer carries call-control or contact workflow logic", () => {
  const forbiddenWorkflowPhrases = [
    "transfer_to_human",
    "end_call",
    "{{user_number}}",
    "web_call",
    "Do not ask for the full phone number up front when the current caller number is already available",
    "If a tool call fails",
    "matchInterpretation",
    "If matchInterpretation is hybrid_candidate"
  ];

  for (const phrase of forbiddenWorkflowPhrases) {
    assert.equal(
      generalPrompt.includes(phrase),
      false,
      `did not expect global prompt to contain: ${phrase}`
    );
  }
});
