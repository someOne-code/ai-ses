import { z } from "zod";

import { AppError } from "../../lib/errors.js";

const officeParamsSchema = z.object({
  officeId: z.string().uuid()
});

const createShowingRequestBodySchema = z.object({
  listingId: z.string().uuid(),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(1),
  customerEmail: z.email().optional(),
  preferredDatetime: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
});

export interface ShowingRequestRecord {
  id: string;
  officeId: string;
  listingId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
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
