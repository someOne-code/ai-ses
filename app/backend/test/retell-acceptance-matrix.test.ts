import assert from "node:assert/strict";
import test from "node:test";

import {
  listingHelpContract,
  showingRequestContract
} from "../src/modules/retell/behavior-contracts.js";
import { listingHelpStatePrompt } from "../src/modules/retell/prompt-source/states/listing-help.js";
import { showingRequestStatePrompt } from "../src/modules/retell/prompt-source/states/showing-request.js";

test("acceptance matrix keeps verified lookup before listing facts across contract and prompt", () => {
  assert.ok(
    listingHelpContract.forbiddenBehaviors.includes(
      "speak_listing_facts_before_verified_lookup"
    )
  );
  assert.match(
    listingHelpStatePrompt,
    /Do not speak any listing fact until get_listing_by_reference returns a verified result\./
  );
  assert.match(
    listingHelpStatePrompt,
    /error\.repairStep=referenceCode, stay in referenceCode repair only\./
  );
});

test("acceptance matrix keeps required-field completion and end_call blocked in showing_request", () => {
  assert.equal(
    showingRequestContract.exitGuard.allowCompletionIntentWhenRequiredFieldsMissing,
    false
  );
  assert.equal(
    showingRequestContract.exitGuard.allowEndCallWhenRequiredFieldsMissing,
    false
  );
  assert.match(
    showingRequestStatePrompt,
    /Never use end_call while any required field is still missing or unclear\./
  );
  assert.match(
    showingRequestStatePrompt,
    /Do not use completion wording such as "talebinizi aldim" or "iletiyorum" before the required fields are complete\./
  );
});

test("acceptance matrix keeps showing_request repairs single-field and loop-resistant", () => {
  const phoneRepair = showingRequestContract.repairSteps.find(
    (step) => step.step === "customerPhone"
  );

  assert.ok(phoneRepair);
  assert.equal(phoneRepair.ownerField, "customerPhone");
  assert.match(
    showingRequestStatePrompt,
    /If create_showing_request returns repairStep=customerPhone, repair only customerPhone\./
  );
  assert.match(
    showingRequestStatePrompt,
    /Do not reopen listing, customerName, visit day, or time if they were already collected\./
  );
  assert.match(
    showingRequestStatePrompt,
    /If the caller repeats the same failed number, or only says evet or dogru after the failure, say that the number is still not usable and ask for a different reachable number\./
  );
});
