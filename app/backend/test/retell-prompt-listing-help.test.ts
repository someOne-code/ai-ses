import assert from "node:assert/strict";
import test from "node:test";

import {
  listingHelpRulesKept,
  listingHelpRulesRemoved,
  listingHelpStatePrompt,
  listingHelpStateSource,
  listingHelpToolNames
} from "../src/modules/retell/prompt-source/states/listing-help.js";

test("listing_help prompt source keeps the listing-only tool surface", () => {
  assert.equal(listingHelpStateSource.name, "listing_help");
  assert.deepEqual(listingHelpToolNames, [
    "search_listings",
    "get_listing_by_reference"
  ]);
  assert.deepEqual(listingHelpStateSource.tools, [
    "search_listings",
    "get_listing_by_reference"
  ]);
});

test("listing_help prompt keeps verified lookup and code-only repair invariants", () => {
  assert.ok(listingHelpRulesKept.includes("verified_lookup_before_facts"));
  assert.ok(listingHelpRulesKept.includes("reference_code_repair_only"));
  assert.match(
    listingHelpStatePrompt,
    /A spoken reference code is a lookup key only\. It never proves listing facts\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not speak any listing fact until get_listing_by_reference returns a verified result\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If get_listing_by_reference returns error\.repairStep=referenceCode, stay in referenceCode repair only\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Preserve every spoken token, including prefixes like DEMO or IST\./i
  );
});

test("listing_help prompt is thin and delegates search-state intelligence to backend", () => {
  assert.ok(listingHelpRulesKept.includes("backend_owned_search_state"));
  assert.ok(listingHelpRulesRemoved.includes("manual_merge_policy_in_prompt"));
  assert.ok(
    listingHelpRulesRemoved.includes("manual_router_policy_in_prompt")
  );
  assert.match(
    listingHelpStatePrompt,
    /Backend owns decomposition, merge policy, pagination, and context reset; do not invent your own carry-over logic\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If one search returns no usable result, ask one concrete next change/i
  );
});

test("listing_help prompt keeps selected-listing detail lookup discipline", () => {
  assert.ok(
    listingHelpRulesKept.includes(
      "selected_listing_detail_lookup_before_detail_facts"
    )
  );
  assert.match(
    listingHelpStatePrompt,
    /If the latest verified lookup or latest search_listings result leaves only one concrete listing in play, treat that listing as the active selected listing\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller then says "bu ev", "bunu", "onu", "bu ilan", or simply says they want to see it, do not ask for the reference code or listing name again\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Only ask the caller to choose between listings when more than one shortlist item is still active\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller asks about dues, aidat, building age, floor, elevator, balcony, parking, full address, or another selected-listing detail, call get_listing_by_reference first/i
  );
  assert.match(
    listingHelpStatePrompt,
    /Transition to showing_request only when one specific listing is already verified and the caller clearly wants to visit it\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not collect showing-request fields in this state\./i
  );
});

test("listing_help prompt uses backend outcome messaging and approximation-safe speech", () => {
  assert.ok(listingHelpRulesKept.includes("search_outcome_message_first"));
  assert.match(
    listingHelpStatePrompt,
    /If search_listings\.data\.searchOutcomeMessage exists, say that message first\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If search_listings\.data\.nextSuggestion exists, offer it as one short next option\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If search_listings\.data\.approximationNotice exists, say that short notice first/i
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not phrase approximate shortlist matches as verified facts/i
  );
});

test("listing_help prompt does not contain showing-request payload keys", () => {
  const disallowedShowingLogic = [
    /create_showing_request/i,
    /customerName/i,
    /customerPhone/i,
    /preferredDatetime/i,
    /preferredTimeWindow/i,
    /\{\{user_number\}\}/
  ];

  for (const pattern of disallowedShowingLogic) {
    assert.doesNotMatch(listingHelpStatePrompt, pattern);
  }
});

test("listing_help prompt stays within thin prompt size budget", () => {
  assert.ok(
    listingHelpStatePrompt.length < 4600,
    `Expected listing_help prompt to stay under thin budget. Length=${listingHelpStatePrompt.length}.`
  );
});
