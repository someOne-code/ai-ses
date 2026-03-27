const LEAD_INTENT_VALUES = [
  "listing_question",
  "showing_request",
  "general_inquiry",
  "handoff_request"
] as const;

const LEAD_TEMPERATURE_VALUES = ["cold", "warm", "hot"] as const;

export type LeadIntent = (typeof LEAD_INTENT_VALUES)[number];
export type LeadTemperature = (typeof LEAD_TEMPERATURE_VALUES)[number];

export interface NormalizedLeadQualification {
  leadIntent: LeadIntent | null;
  leadTemperature: LeadTemperature | null;
  handoffRecommended: boolean | null;
  budgetKnown: boolean | null;
  locationKnown: boolean | null;
  timelineKnown: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getCandidateValue(
  sources: Array<Record<string, unknown> | null>,
  ...keys: string[]
): unknown {
  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const key of keys) {
      if (key in source) {
        return source[key];
      }
    }
  }

  return undefined;
}

function normalizeEnumValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "") {
    return null;
  }

  return normalized.replace(/[\s-]+/g, "_");
}

function normalizeLeadIntent(value: unknown): LeadIntent | null {
  const normalized = normalizeEnumValue(value);

  return normalized && LEAD_INTENT_VALUES.includes(normalized as LeadIntent)
    ? (normalized as LeadIntent)
    : null;
}

function normalizeLeadTemperature(value: unknown): LeadTemperature | null {
  const normalized = normalizeEnumValue(value);

  return normalized &&
    LEAD_TEMPERATURE_VALUES.includes(normalized as LeadTemperature)
    ? (normalized as LeadTemperature)
    : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }

    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "y":
    case "known":
      return true;
    case "false":
    case "no":
    case "n":
    case "unknown":
      return false;
    default:
      return null;
  }
}

export function normalizeRetellLeadQualification(
  callAnalysis: unknown
): NormalizedLeadQualification {
  const analysis = asRecord(callAnalysis);
  const customAnalysisData = asRecord(analysis?.custom_analysis_data);
  const sources = [customAnalysisData, analysis];

  return {
    leadIntent: normalizeLeadIntent(
      getCandidateValue(sources, "leadIntent", "lead_intent")
    ),
    leadTemperature: normalizeLeadTemperature(
      getCandidateValue(sources, "leadTemperature", "lead_temperature")
    ),
    handoffRecommended: normalizeBoolean(
      getCandidateValue(
        sources,
        "handoffRecommended",
        "handoff_recommended"
      )
    ),
    budgetKnown: normalizeBoolean(
      getCandidateValue(sources, "budgetKnown", "budget_known")
    ),
    locationKnown: normalizeBoolean(
      getCandidateValue(sources, "locationKnown", "location_known")
    ),
    timelineKnown: normalizeBoolean(
      getCandidateValue(sources, "timelineKnown", "timeline_known")
    )
  };
}

export function asLeadIntent(value: string | null): LeadIntent | null {
  return normalizeLeadIntent(value);
}

export function asLeadTemperature(
  value: string | null
): LeadTemperature | null {
  return normalizeLeadTemperature(value);
}
