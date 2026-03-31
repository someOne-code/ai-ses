import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type {
  RepairStep,
  VoiceFieldError,
  VoiceRepairDetails
} from "../retell/repair-types.js";

export const preferredTimeWindowValues = [
  "morning",
  "afternoon",
  "evening",
  "after_work",
  "flexible"
] as const;

export const preferredTimeWindowSchema = z.enum(preferredTimeWindowValues);

function normalizeVoiceMissingValue(value: unknown): unknown {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}

function normalizeTurkishMobilePhone(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed === "" || /[{}]/.test(trimmed)) {
    return null;
  }

  const digitsOnly = trimmed.replace(/[^\d]/g, "");

  if (digitsOnly === "") {
    return null;
  }

  if (/^5\d{9}$/.test(digitsOnly)) {
    return `+90${digitsOnly}`;
  }

  if (/^05\d{9}$/.test(digitsOnly)) {
    return `+90${digitsOnly.slice(1)}`;
  }

  if (/^905\d{9}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }

  return null;
}

export const customerPhoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !/[{}]/.test(value),
    "Customer phone must not contain unresolved template placeholders."
  )
  .transform((value, ctx) => {
    const normalized = normalizeTurkishMobilePhone(value);

    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message:
          "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
      });

      return z.NEVER;
    }

    return normalized;
  });

const officeParamsSchema = z.object({
  officeId: z.string().uuid()
});

const optionalEmail = z.preprocess(normalizeVoiceMissingValue, z.email().optional());

export const optionalPreferredTimeWindowSchema = z.preprocess(
  normalizeVoiceMissingValue,
  preferredTimeWindowSchema.optional()
);

const requiredPreferredDatetimeSchema = z.preprocess(
  normalizeVoiceMissingValue,
  z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
);

const createShowingRequestBodySchema = z.object({
  listingId: z.string().uuid(),
  customerName: z.string().trim().min(1),
  customerPhone: customerPhoneSchema,
  customerEmail: optionalEmail,
  preferredTimeWindow: optionalPreferredTimeWindowSchema,
  preferredDatetime: requiredPreferredDatetimeSchema
});

export type ShowingRequestValidationField =
  | "listingId"
  | "customerName"
  | "customerPhone"
  | "customerEmail"
  | "preferredTimeWindow"
  | "preferredDatetime";

export interface ShowingRequestValidationDetails
  extends VoiceRepairDetails<RepairStep, ShowingRequestValidationField> {}

const showingRequestValidationFields = [
  "listingId",
  "customerName",
  "customerPhone",
  "customerEmail",
  "preferredTimeWindow",
  "preferredDatetime"
] as const satisfies readonly ShowingRequestValidationField[];

const schedulingValidationFields = [
  "preferredDatetime",
  "preferredTimeWindow"
] as const satisfies readonly ShowingRequestValidationField[];

const repairFieldScopes: ReadonlyArray<{
  step: RepairStep;
  fields: readonly ShowingRequestValidationField[];
}> = [
  {
    step: "customerPhone",
    fields: ["customerPhone"]
  },
  {
    step: "preferredDatetime",
    fields: schedulingValidationFields
  },
  {
    step: "preferredTimeWindow",
    fields: ["preferredTimeWindow"]
  }
];

export type PreferredTimeWindow = z.infer<typeof preferredTimeWindowSchema>;

export function asPreferredTimeWindow(
  value: string | null | undefined
): PreferredTimeWindow | null {
  if (!value) {
    return null;
  }

  return preferredTimeWindowValues.includes(value as PreferredTimeWindow)
    ? (value as PreferredTimeWindow)
    : null;
}

export interface ShowingRequestRecord {
  id: string;
  officeId: string;
  listingId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  preferredTimeWindow: PreferredTimeWindow | null;
  preferredDatetime: string;
  status: string;
  createdAt: string;
}

export type ShowingRequestOfficeParams = z.infer<typeof officeParamsSchema>;
export type CreateShowingRequestBody = z.output<
  typeof createShowingRequestBodySchema
>;
export type CreateShowingRequestInput = ShowingRequestOfficeParams &
  CreateShowingRequestBody;

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError(message, 400);
  }

  return result.data;
}

function asShowingRequestValidationField(
  value: unknown
): ShowingRequestValidationField | "unknown" {
  return typeof value === "string" &&
    showingRequestValidationFields.includes(
      value as ShowingRequestValidationField
    )
    ? (value as ShowingRequestValidationField)
    : "unknown";
}

export function toShowingRequestValidationDetails(
  error: z.ZodError
): ShowingRequestValidationDetails {
  const fieldErrorsByField = new Map<
    ShowingRequestValidationField | "unknown",
    VoiceFieldError<ShowingRequestValidationField>
  >();

  for (const issue of error.issues) {
    const field = asShowingRequestValidationField(issue.path[0]);

    if (!fieldErrorsByField.has(field)) {
      fieldErrorsByField.set(field, {
        field,
        message: issue.message
      });
    }
  }

  const fieldErrors = Array.from(fieldErrorsByField.values());

  const matchingScope = repairFieldScopes.find(({ fields }) =>
    fieldErrors.some(
      (entry) =>
        entry.field !== "unknown" &&
        fields.includes(entry.field as ShowingRequestValidationField)
    )
  );

  const repairStep = matchingScope?.step ?? "unknown";
  const scopedFieldErrors = matchingScope
    ? fieldErrors.filter(
        (entry) =>
          entry.field !== "unknown" &&
          matchingScope.fields.includes(entry.field as ShowingRequestValidationField)
      )
    : fieldErrors;

  return {
    code: "VALIDATION_ERROR",
    repairStep,
    fieldErrors: scopedFieldErrors
  };
}

export function parseShowingRequestOfficeParams(
  input: unknown
): ShowingRequestOfficeParams {
  return parseWithSchema(
    officeParamsSchema,
    input,
    "Invalid office identifier."
  );
}

export function parseCreateShowingRequestBody(
  input: unknown
): CreateShowingRequestBody {
  const result = createShowingRequestBodySchema.safeParse(input);

  if (!result.success) {
    throw new AppError(
      "Invalid showing request payload.",
      400,
      "VALIDATION_ERROR",
      toShowingRequestValidationDetails(result.error)
    );
  }

  return result.data;
}
