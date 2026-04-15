import { createHash, randomBytes } from "node:crypto";

/** Generates a cryptographically random opaque token string. */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("hex");
}

/** SHA-256 hash of a token for safe storage (never store raw refresh tokens). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns a Date N days from now. */
export function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
