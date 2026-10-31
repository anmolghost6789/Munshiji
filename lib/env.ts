/** Secrets and settings that must be right in production. */
const DEV_SECRET = "munshiji-dev-only-secret-do-not-use-in-production";

export const isProd = () => process.env.NODE_ENV === "production";

export function authSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.MUNSHIJI_SECRET || "";
  if (s.length >= 32) return s;
  if (isProd() && process.env.NEXT_PHASE !== "phase-production-build") throw new Error("NEXTAUTH_SECRET must be set to a random value of at least 32 characters in production. See PILOT.md.");
  return DEV_SECRET;
}
