import type {
  FailedCandidateNormalization,
  RepairStep,
  VoiceBehaviorField
} from "./repair-types.js";

export const behaviorStates = ["listing_help", "showing_request"] as const;
export type BehaviorState = (typeof behaviorStates)[number];

export const voiceToolNames = [
  "search_listings",
  "get_listing_by_reference",
  "create_showing_request"
] as const;
export type VoiceToolName = (typeof voiceToolNames)[number];

export const forbiddenBehaviorKinds = [
  "speak_listing_facts_before_verified_lookup",
  "success_exit_without_required_fields",
  "completion_intent_without_required_fields",
  "end_call_without_required_fields",
  "repeat_same_failed_candidate_submit"
] as const;
export type ForbiddenBehaviorKind = (typeof forbiddenBehaviorKinds)[number];

export interface BehaviorRepairRule {
  step: RepairStep;
  ownerField: VoiceBehaviorField;
  ownedFields: readonly VoiceBehaviorField[];
  sameFailedCandidateNormalization: FailedCandidateNormalization;
  sameFailedCandidateDefinition: "same_owner_field_and_normalized_candidate";
  requiresCallerSafeMessage: true;
}

export interface BehaviorSuccessExitCondition {
  key: string;
  requiresVerifiedToolResult: boolean;
  verifiedTool: VoiceToolName | null;
}

export interface BehaviorExitGuard {
  allowCompletionIntentWhenRequiredFieldsMissing: false;
  allowEndCallWhenRequiredFieldsMissing: false;
}

export interface BehaviorContract {
  state: BehaviorState;
  requiredFields: readonly VoiceBehaviorField[];
  collectedFields: readonly VoiceBehaviorField[];
  confirmedFields: readonly VoiceBehaviorField[];
  allowedToolCalls: readonly VoiceToolName[];
  repairSteps: readonly BehaviorRepairRule[];
  successExitConditions: readonly BehaviorSuccessExitCondition[];
  exitGuard: BehaviorExitGuard;
  forbiddenBehaviors: readonly ForbiddenBehaviorKind[];
}

export const listingHelpContract: BehaviorContract = {
  state: "listing_help",
  requiredFields: [],
  collectedFields: ["referenceCode", "minPrice", "maxPrice"],
  confirmedFields: ["referenceCode"],
  allowedToolCalls: ["search_listings", "get_listing_by_reference"],
  repairSteps: [
    {
      step: "referenceCode",
      ownerField: "referenceCode",
      ownedFields: ["referenceCode"],
      sameFailedCandidateNormalization: "reference_code",
      sameFailedCandidateDefinition:
        "same_owner_field_and_normalized_candidate",
      requiresCallerSafeMessage: true
    },
    {
      step: "minPrice",
      ownerField: "minPrice",
      ownedFields: ["minPrice"],
      sameFailedCandidateNormalization: "numeric_string",
      sameFailedCandidateDefinition:
        "same_owner_field_and_normalized_candidate",
      requiresCallerSafeMessage: true
    },
    {
      step: "maxPrice",
      ownerField: "maxPrice",
      ownedFields: ["maxPrice"],
      sameFailedCandidateNormalization: "numeric_string",
      sameFailedCandidateDefinition:
        "same_owner_field_and_normalized_candidate",
      requiresCallerSafeMessage: true
    }
  ],
  successExitConditions: [
    {
      key: "verified_listing_context_available",
      requiresVerifiedToolResult: true,
      verifiedTool: "get_listing_by_reference"
    }
  ],
  exitGuard: {
    allowCompletionIntentWhenRequiredFieldsMissing: false,
    allowEndCallWhenRequiredFieldsMissing: false
  },
  forbiddenBehaviors: [
    "speak_listing_facts_before_verified_lookup",
    "success_exit_without_required_fields",
    "completion_intent_without_required_fields",
    "end_call_without_required_fields",
    "repeat_same_failed_candidate_submit"
  ]
};

export const showingRequestContract: BehaviorContract = {
  state: "showing_request",
  requiredFields: [
    "listingId",
    "customerName",
    "customerPhone",
    "preferredDatetime"
  ],
  collectedFields: [
    "listingId",
    "customerName",
    "customerPhone",
    "preferredDatetime",
    "preferredTimeWindow"
  ],
  confirmedFields: ["customerPhone"],
  allowedToolCalls: ["create_showing_request"],
  repairSteps: [
    {
      step: "customerPhone",
      ownerField: "customerPhone",
      ownedFields: ["customerPhone"],
      sameFailedCandidateNormalization: "digits_only",
      sameFailedCandidateDefinition:
        "same_owner_field_and_normalized_candidate",
      requiresCallerSafeMessage: true
    },
    {
      step: "preferredDatetime",
      ownerField: "preferredDatetime",
      ownedFields: ["preferredDatetime"],
      sameFailedCandidateNormalization: "iso_datetime",
      sameFailedCandidateDefinition:
        "same_owner_field_and_normalized_candidate",
      requiresCallerSafeMessage: true
    },
    {
      step: "preferredTimeWindow",
      ownerField: "preferredTimeWindow",
      ownedFields: ["preferredTimeWindow"],
      sameFailedCandidateNormalization: "time_window",
      sameFailedCandidateDefinition:
        "same_owner_field_and_normalized_candidate",
      requiresCallerSafeMessage: true
    }
  ],
  successExitConditions: [
    {
      key: "required_fields_confirmed",
      requiresVerifiedToolResult: false,
      verifiedTool: null
    },
    {
      key: "showing_request_created",
      requiresVerifiedToolResult: true,
      verifiedTool: "create_showing_request"
    }
  ],
  exitGuard: {
    allowCompletionIntentWhenRequiredFieldsMissing: false,
    allowEndCallWhenRequiredFieldsMissing: false
  },
  forbiddenBehaviors: [
    "success_exit_without_required_fields",
    "completion_intent_without_required_fields",
    "end_call_without_required_fields",
    "repeat_same_failed_candidate_submit"
  ]
};

export const behaviorContracts = [
  listingHelpContract,
  showingRequestContract
] as const;
