import {
  canonicalRepairSteps,
  type RepairStep,
  type VoiceFieldError
} from "./repair-types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface CanonicalRetellRepair {
  repairStep?: RepairStep | "unknown";
  fieldErrors?: VoiceFieldError[];
  callerMessage?: string;
}

export const repairStepCallerMessages: Record<RepairStep, string> = {
  customerPhone:
    "Telefon numaranizi tam anlayamadim, 10 hane olarak tekrar soyler misiniz?",
  preferredDatetime:
    "Ziyaret gunu ve saat tercihini kisa sekilde yeniden netlestirmem gerekiyor.",
  preferredTimeWindow:
    "Ziyaret gunu ve saat tercihini kisa sekilde yeniden netlestirmem gerekiyor.",
  referenceCode: "Ilan kodunu tam haliyle bir kez daha almam gerekiyor.",
  minPrice:
    "Arama kriterlerindeki fiyat, oda ya da metrekare bilgisini yeniden netlestirmem gerekiyor.",
  maxPrice:
    "Arama kriterlerindeki fiyat, oda ya da metrekare bilgisini yeniden netlestirmem gerekiyor."
};

const repairStepSet = new Set<string>(canonicalRepairSteps);

export function toCanonicalRepairStep(
  repairStep: unknown
): RepairStep | "unknown" | undefined {
  if (repairStep === "unknown") {
    return "unknown";
  }

  return typeof repairStep === "string" && repairStepSet.has(repairStep)
    ? (repairStep as RepairStep)
    : undefined;
}

export function toCanonicalVoiceFieldErrors(
  fieldErrors: unknown
): VoiceFieldError[] | undefined {
  if (!Array.isArray(fieldErrors)) {
    return undefined;
  }

  const normalizedFieldErrors: VoiceFieldError[] = [];

  for (const entry of fieldErrors) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const field = toCanonicalRepairStep(
      "field" in entry ? entry.field : undefined
    );
    const message =
      "message" in entry && typeof entry.message === "string"
        ? entry.message
        : undefined;

    if (field && message) {
      normalizedFieldErrors.push({ field, message });
    }
  }

  return normalizedFieldErrors.length > 0 ? normalizedFieldErrors : undefined;
}

export function getRepairStepCallerMessage(
  repairStep: RepairStep | "unknown" | undefined
): string | undefined {
  if (!repairStep || repairStep === "unknown") {
    return undefined;
  }

  return repairStepCallerMessages[repairStep];
}

export function getCanonicalRetellRepair(
  details: unknown
): CanonicalRetellRepair {
  const repairDetails = asRecord(details);
  const repairStep = toCanonicalRepairStep(repairDetails?.repairStep);
  const fieldErrors = toCanonicalVoiceFieldErrors(repairDetails?.fieldErrors);
  const callerMessage = getRepairStepCallerMessage(repairStep);

  return {
    ...(repairStep ? { repairStep } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(callerMessage ? { callerMessage } : {})
  };
}
