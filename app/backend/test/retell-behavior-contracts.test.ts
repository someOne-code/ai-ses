import assert from "node:assert/strict";
import test from "node:test";

import {
  behaviorContracts,
  forbiddenBehaviorKinds,
  listingHelpContract,
  showingRequestContract,
  voiceToolNames
} from "../src/modules/retell/behavior-contracts.js";
import {
  canonicalRepairSteps,
  failedCandidateNormalizations,
  sameFailedCandidateDefinition,
  voiceBehaviorFields
} from "../src/modules/retell/repair-types.js";

test("behavior contract foundation exposes the canonical state set", () => {
  assert.deepEqual(
    behaviorContracts.map((contract) => contract.state),
    ["listing_help", "showing_request"]
  );
});

test("behavior contracts only use canonical repair steps, fields, tools, and forbidden behaviors", () => {
  const repairSteps = new Set(canonicalRepairSteps);
  const fields = new Set(voiceBehaviorFields);
  const tools = new Set(voiceToolNames);
  const forbidden = new Set(forbiddenBehaviorKinds);
  const candidateNormalizations = new Set(failedCandidateNormalizations);

  for (const contract of behaviorContracts) {
    for (const field of contract.requiredFields) {
      assert.ok(fields.has(field));
    }

    for (const field of contract.collectedFields) {
      assert.ok(fields.has(field));
    }

    for (const field of contract.confirmedFields) {
      assert.ok(fields.has(field));
    }

    for (const tool of contract.allowedToolCalls) {
      assert.ok(tools.has(tool));
    }

    for (const rule of contract.repairSteps) {
      assert.ok(repairSteps.has(rule.step));
      assert.ok(fields.has(rule.ownerField));
      assert.ok(candidateNormalizations.has(rule.sameFailedCandidateNormalization));
      assert.equal(
        rule.sameFailedCandidateDefinition,
        sameFailedCandidateDefinition
      );
      assert.equal(rule.requiresCallerSafeMessage, true);

      for (const ownedField of rule.ownedFields) {
        assert.ok(fields.has(ownedField));
      }
    }

    for (const behavior of contract.forbiddenBehaviors) {
      assert.ok(forbidden.has(behavior));
    }

    assert.equal(
      contract.exitGuard.allowCompletionIntentWhenRequiredFieldsMissing,
      false
    );
    assert.equal(
      contract.exitGuard.allowEndCallWhenRequiredFieldsMissing,
      false
    );
  }
});

test("required fields have at most one primary repair owner across contracts", () => {
  for (const contract of behaviorContracts) {
    const ownerCountByField = new Map<string, number>();

    for (const rule of contract.repairSteps) {
      for (const field of rule.ownedFields) {
        ownerCountByField.set(field, (ownerCountByField.get(field) ?? 0) + 1);
      }
    }

    for (const field of contract.requiredFields) {
      assert.ok(
        (ownerCountByField.get(field) ?? 0) <= 1,
        `${contract.state} field ${field} has more than one repair owner.`
      );
    }
  }
});

test("showing_request contract keeps repair ownership narrow and unique", () => {
  const owners = showingRequestContract.repairSteps.map((rule) => rule.ownerField);

  assert.equal(new Set(owners).size, owners.length);
  assert.deepEqual(owners, [
    "customerPhone",
    "preferredDatetime",
    "preferredTimeWindow"
  ]);
  assert.deepEqual(
    showingRequestContract.repairSteps.map((rule) => rule.ownedFields),
    [["customerPhone"], ["preferredDatetime"], ["preferredTimeWindow"]]
  );
});

test("listing_help contract explicitly forbids pre-verification listing facts", () => {
  assert.ok(
    listingHelpContract.forbiddenBehaviors.includes(
      "speak_listing_facts_before_verified_lookup"
    )
  );
  assert.deepEqual(listingHelpContract.successExitConditions, [
    {
      key: "verified_listing_context_available",
      requiresVerifiedToolResult: true,
      verifiedTool: "get_listing_by_reference"
    }
  ]);
});

test("showing_request contract requires required-fields confirmation before success exit", () => {
  assert.deepEqual(showingRequestContract.requiredFields, [
    "listingId",
    "customerName",
    "customerPhone",
    "preferredDatetime"
  ]);
  assert.ok(
    showingRequestContract.successExitConditions.some(
      (condition) =>
        condition.key === "required_fields_confirmed" &&
        condition.requiresVerifiedToolResult === false &&
        condition.verifiedTool === null
    )
  );
  assert.ok(
    showingRequestContract.successExitConditions.some(
      (condition) =>
        condition.key === "showing_request_created" &&
        condition.requiresVerifiedToolResult === true &&
        condition.verifiedTool === "create_showing_request"
    )
  );
  assert.ok(
    showingRequestContract.forbiddenBehaviors.includes(
      "completion_intent_without_required_fields"
    )
  );
  assert.ok(
    showingRequestContract.forbiddenBehaviors.includes(
      "end_call_without_required_fields"
    )
  );
});

test("same failed candidate is frozen as owner field plus normalized candidate", () => {
  for (const contract of behaviorContracts) {
    assert.ok(
      contract.forbiddenBehaviors.includes("repeat_same_failed_candidate_submit")
    );

    for (const rule of contract.repairSteps) {
      assert.equal(
        rule.sameFailedCandidateDefinition,
        "same_owner_field_and_normalized_candidate"
      );
    }
  }
});

test("success exits require verified tool results whenever the exit depends on a tool", () => {
  for (const contract of behaviorContracts) {
    for (const condition of contract.successExitConditions) {
      assert.equal(
        condition.requiresVerifiedToolResult,
        condition.verifiedTool !== null
      );

      if (condition.verifiedTool !== null) {
        assert.ok(contract.allowedToolCalls.includes(condition.verifiedTool));
      }
    }
  }
});

test("listing_help and showing_request both block completion intent and end_call while required fields are missing", () => {
  for (const contract of [listingHelpContract, showingRequestContract]) {
    assert.equal(
      contract.exitGuard.allowCompletionIntentWhenRequiredFieldsMissing,
      false
    );
    assert.equal(
      contract.exitGuard.allowEndCallWhenRequiredFieldsMissing,
      false
    );
    assert.ok(
      contract.forbiddenBehaviors.includes(
        "completion_intent_without_required_fields"
      )
    );
    assert.ok(
      contract.forbiddenBehaviors.includes("end_call_without_required_fields")
    );
  }
});
