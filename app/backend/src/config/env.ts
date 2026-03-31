import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_HOST: z.string().default("0.0.0.0"),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  N8N_BASE_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().optional(),
  N8N_BOOKING_TRIGGER_SECRET: z.string().optional(),
  N8N_GOOGLE_CALENDAR_ID: z.string().optional(),
  N8N_CRM_TRIGGER_SECRET: z.string().optional(),
  N8N_BOOKING_CALLBACK_SECRET: z.string().optional(),
  N8N_CRM_CALLBACK_SECRET: z.string().optional(),
  RETELL_API_KEY: z.string().optional(),
  RETELL_WEBHOOK_SECRET: z.string().optional(),
  SEARCH_DOCUMENT_REFRESH_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional()
});

export const env = envSchema.parse(process.env);

export type AppEnv = typeof env;
