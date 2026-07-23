import { config } from 'dotenv';
import { z } from 'zod';

config({ path: '../../.env' });

/**
 * Validate the environment once, at boot, and crash immediately if it's wrong.
 *
 * The alternative — reading process.env at each use site — turns a missing
 * variable into a confusing 500 hours later instead of a clear failure at
 * startup.
 */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  N8N_WEBHOOK_SECRET: z
    .string()
    .min(16, 'N8N_WEBHOOK_SECRET must be at least 16 characters'),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().min(1).default('llama-3.3-70b-versatile'),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: z.string().min(1).default('Lumen <briefs@example.com>'),
  DELIVERY_EMAIL_TO: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().email().optional(),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      'Copy .env.example to .env at the repo root and fill in the values.',
  );
}

export const env = parsed.data;
