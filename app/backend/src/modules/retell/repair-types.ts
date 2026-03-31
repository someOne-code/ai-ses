export const canonicalRepairSteps = [
  "customerPhone",
  "referenceCode",
  "preferredDatetime",
  "preferredTimeWindow",
  "minPrice",
  "maxPrice"
] as const;

export type RepairStep = (typeof canonicalRepairSteps)[number];

export const voiceBehaviorFields = [
  "customerPhone",
  "referenceCode",
  "preferredDatetime",
  "preferredTimeWindow",
  "listingId",
  "customerName",
  "minPrice",
  "maxPrice"
] as const;

export type VoiceBehaviorField = (typeof voiceBehaviorFields)[number];

export const failedCandidateNormalizations = [
  "digits_only",
  "reference_code",
  "iso_datetime",
  "time_window",
  "numeric_string"
] as const;

export type FailedCandidateNormalization =
  (typeof failedCandidateNormalizations)[number];

export const sameFailedCandidateDefinition =
  "same_owner_field_and_normalized_candidate" as const;

export interface VoiceFailedCandidate<
  TField extends string = string
> {
  field: TField | "unknown";
  normalization: FailedCandidateNormalization;
  normalizedCandidate: string;
}

export interface VoiceFieldError<
  TField extends string = string
> {
  field: TField | "unknown";
  message: string;
}

export interface VoiceRepairDetails<
  TRepairStep extends string = string,
  TField extends string = string
> {
  code: string;
  repairStep: TRepairStep | "unknown";
  fieldErrors: Array<VoiceFieldError<TField>>;
  callerMessage?: string;
  failedCandidate?: VoiceFailedCandidate<TField>;
}

export interface VoiceResultSuccess<
  TState extends string = string,
  TToolName extends string = string
> {
  ok: true;
  state: TState;
  verifiedToolResults: ReadonlyArray<{
    tool: TToolName;
    verified: true;
  }>;
}

export interface VoiceResultRepair<
  TState extends string = string,
  TRepairStep extends string = string,
  TField extends string = string
> {
  ok: false;
  state: TState;
  error: VoiceRepairDetails<TRepairStep, TField>;
}

export type VoiceResult<
  TState extends string = string,
  TToolName extends string = string,
  TRepairStep extends string = string,
  TField extends string = string
> =
  | VoiceResultSuccess<TState, TToolName>
  | VoiceResultRepair<TState, TRepairStep, TField>;
