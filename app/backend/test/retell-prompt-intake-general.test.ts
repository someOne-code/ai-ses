import assert from "node:assert/strict";
import test from "node:test";

import intakeGeneralState from "../src/modules/retell/prompt-source/states/intake-general.js";

test("intake_general keeps the thin routing edges", () => {
  assert.equal(intakeGeneralState.name, "intake_general");
  assert.deepEqual(
    intakeGeneralState.edges.map((edge) => edge.destination_state_name),
    ["listing_help", "showing_request"]
  );
  assert.deepEqual(intakeGeneralState.rulesKept, [
    "rapid_intent_discovery",
    "listing_and_reference_route_to_listing_help",
    "spoken_reference_code_is_lookup_only",
    "verified_listing_can_route_to_showing_request",
    "single_confirmation_for_misheard_routing_detail",
    "explicit_human_transfer_or_polite_end"
  ]);
});

test("spoken reference codes route to listing_help and do not count as verified facts", () => {
  const prompt = intakeGeneralState.state_prompt;

  assert.match(
    prompt,
    /A spoken reference code is only a lookup key, not verified listing data\./
  );
  assert.match(
    prompt,
    /transition to listing_help first\. Do not speak listing facts from that spoken input alone\./
  );
  assert.match(
    prompt,
    /Only transition directly to showing_request when one specific listing is already verified and identified in the current call context and the caller clearly wants to visit it\./
  );
});

test("intake_general does not carry showing_request collection logic", () => {
  const prompt = intakeGeneralState.state_prompt;
  const forbiddenPhrases = [
    "create_showing_request",
    "customerPhone",
    "customerName",
    "preferredDatetime",
    "preferredTimeWindow",
    "last 4 digits",
    "current caller number",
    "contact-number step",
    "listingId",
    "repairStep"
  ];

  for (const phrase of forbiddenPhrases) {
    assert.equal(prompt.includes(phrase), false);
  }

  assert.deepEqual(intakeGeneralState.rulesRemoved, [
    "listing_detail_answering",
    "listing_search_workflow_prose",
    "showing_request_field_collection",
    "callback_number_logic",
    "visit_day_and_time_collection",
    "tool_submission_or_repair_logic",
    "workflow_engine_explanations"
  ]);
});

test("intake_general stays a routing state instead of a collection workflow", () => {
  const prompt = intakeGeneralState.state_prompt;
  const nonEmptyLines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  assert.match(
    prompt,
    /This is a thin routing state, not a listing workflow or data-collection state\./
  );
  assert.match(
    prompt,
    /Ask only the minimum clarifying question needed to route\. If the caller's intent is already clear, route immediately\./
  );
  assert.match(
    prompt,
    /Do not collect caller name, callback number, email, visit day, exact time, broad time window, or other showing-request fields here\./
  );
  assert.match(
    prompt,
    /Do not explain tools, workflow, state transitions, or internal validation\./
  );
  assert.ok(nonEmptyLines.length < 28);
});
