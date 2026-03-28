import { z } from "zod";

import { AppError } from "../../lib/errors.js";

export const preferredTimeWindowValues = [
  "morning",
  "afternoon",
  "evening",
  "after_work",
  "flexible"
] as const;

export const preferredTimeWindowSchema = z.enum(preferredTimeWindowValues);

export const customerPhoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !/[{}]/.test(value),
    "Customer phone must not contain unresolved template placeholders."
  );

const officeParamsSchema = z.object({
  officeId: z.string().uuid()
});

const optionalEmail = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.email().optional());

const createShowingRequestBodySchema = z.object({
  listingId: z.string().uuid(),
  customerName: z.string().trim().min(1),
  customerPhone: customerPhoneSchema,
  customerEmail: optionalEmail,
  preferredTimeWindow: preferredTimeWindowSchema.optional(),
  preferredDatetime: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
});

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
  return parseWithSchema(
    createShowingRequestBodySchema,
    input,
    "Invalid showing request payload."
  );
}
