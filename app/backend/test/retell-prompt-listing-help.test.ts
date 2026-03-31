import assert from "node:assert/strict";
import test from "node:test";

import {
  listingHelpRulesKept,
  listingHelpRulesRemoved,
  listingHelpStatePrompt,
  listingHelpStateSource,
  listingHelpToolNames
} from "../src/modules/retell/prompt-source/states/listing-help.js";

test("listing_help prompt source exposes the thin listing-only tool set", () => {
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

test("listing_help prompt keeps verified lookup before listing facts explicit", () => {
  assert.ok(
    listingHelpRulesKept.includes("verified_lookup_before_facts")
  );
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
    /do not guess any listing detail such as district, room layout, type, price, dues, metrekare, building age, or address\./i
  );
});

test("listing_help prompt keeps code-only repair and verified handoff behavior", () => {
  assert.ok(
    listingHelpRulesKept.includes("reference_code_repair_only")
  );
  assert.ok(
    listingHelpRulesKept.includes("field_specific_search_repair")
  );
  assert.ok(
    listingHelpRulesKept.includes("verified_listing_handoff_to_showing_request")
  );
  assert.match(
    listingHelpStatePrompt,
    /If get_listing_by_reference returns error\.repairStep=referenceCode, stay in referenceCode repair only\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /A failed code candidate stays in referenceCode repair only\. Never reuse it as listing evidence or search criteria\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not switch to district, budget, room-count, or alternatives unless the caller explicitly changes intent\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller repeats the same failed code candidate, or only says yes, ask for the full code again in short blocks\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If search_listings returns error\.repairStep=minPrice or error\.repairStep=maxPrice, repair only that unclear price-range constraint\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Ask one short clarification about the budget or price range, then rerun search_listings\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not switch to showing_request, callback-number collection, contact confirmation, or scheduling questions while repairing listing search\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Transition to showing_request only when one specific listing is already verified and the caller clearly wants to visit it\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /When that visit intent is clear, transition silently to showing_request\. Do not ask any showing-request field in this state\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /When bridging into showing_request, use one short neutral offer such as that you can take the visit request for this listing\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not say transfer, handoff, route, connect, "aktariyorum", or imply the request is already received, forwarded, or underway before showing_request starts collecting fields\./i
  );
});

test("listing_help prompt keeps search clarification and detail lookup behavior", () => {
  assert.ok(
    listingHelpRulesKept.includes(
      "listing_search_single_clarification_then_search"
    )
  );
  assert.ok(
    listingHelpRulesKept.includes(
      "selected_listing_detail_lookup_before_detail_facts"
    )
  );
  assert.ok(
    listingHelpRulesKept.includes("latest_active_criteria_rebuild")
  );
  assert.match(
    listingHelpStatePrompt,
    /Ask at most one high-value clarification before the first search\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller gives enough information for a useful first pass, search now instead of waiting for perfect detail\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Preserve every spoken token, including prefixes like DEMO or IST\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller asks about dues, aidat, building age, floor, elevator, balcony, parking, full address, or another selected-listing detail, call get_listing_by_reference first/i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller returns to the same listing after a side path or failed visit attempt, call get_listing_by_reference again before repeating listing facts\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the same verified listing keeps returning no additional detail for repeated follow-up questions, stop the open-ended "baska detay" loop\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /offer one concrete next step only: visit request, another listing, or another verified question\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /Rebuild each new search from the caller's latest active criteria/i
  );
  assert.match(
    listingHelpStatePrompt,
    /If search_listings keeps returning no usable alternatives, do not keep auto-broadening forever\./i
  );
  assert.match(
    listingHelpStatePrompt,
    /If the caller only says "evet" to another alternative search without giving a new concrete change, ask for the missing concrete change instead of running another invented broader search\./i
  );
});

test("listing_help prompt does not carry showing contact or scheduling workflow logic", () => {
  assert.ok(
    listingHelpRulesRemoved.includes("showing_request_data_collection_order")
  );
  assert.ok(listingHelpRulesRemoved.includes("callback_number_logic"));
  assert.ok(listingHelpRulesRemoved.includes("time_preference_collection"));
  assert.match(
    listingHelpStatePrompt,
    /Do not collect showing-request fields in this state\./i
  );

  const disallowedShowingLogic = [
    /create_showing_request/i,
    /customerName/i,
    /customerPhone/i,
    /preferredDatetime/i,
    /preferredTimeWindow/i,
    /\{\{user_number\}\}/,
    /\{\{call_type\}\}/,
    /web_call/i,
    /phone_call/i,
    /last-4-digit/i,
    /current caller number/i,
    /current line/i
  ];

  for (const pattern of disallowedShowingLogic) {
    assert.doesNotMatch(listingHelpStatePrompt, pattern);
  }
});

test("listing_help prompt stays bounded while keeping the needed guards", () => {
  const thinPrompt = listingHelpStatePrompt;
  assert.ok(
    thinPrompt.length < 4500,
    `Expected listing_help prompt to stay below the thin-state budget. Length=${thinPrompt.length}.`
  );
  assert.match(
    thinPrompt,
    /Do not speak any listing fact until get_listing_by_reference returns a verified result\./i
  );
  assert.match(
    thinPrompt,
    /Do not collect showing-request fields in this state\./i
  );
});
