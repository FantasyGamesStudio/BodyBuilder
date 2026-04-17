/**
 * Typed environment variables with runtime validation.
 * Fail fast on startup if required vars are missing.
 */

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  API_HOST: process.env.API_HOST ?? "0.0.0.0",
  API_PORT: Number(process.env.API_PORT ?? "3000"),
  JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES ?? "15m",
  JWT_REFRESH_EXPIRES_DAYS: Number(process.env.JWT_REFRESH_EXPIRES_DAYS ?? "30"),
  MOCK_SUBSCRIPTION: process.env.MOCK_SUBSCRIPTION === "true",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
} as const;
