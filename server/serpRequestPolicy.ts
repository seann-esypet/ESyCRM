/** Only the confirmed Full Research worker supplies this policy. Other callers
 * retain the legacy hourly guard; all callers retain the shared monthly stop. */
export type SerpRequestPolicy = {
  hourlyLimit: number;
  onReservationBlocked: () => Promise<void>;
  onProviderBlocked?: (block: { temporary: boolean; retryAfterMs?: number; message: string }) => Promise<void>;
};

export function providerHourlyLimit(legacyLimit: number, policy?: SerpRequestPolicy) {
  if (!policy) return legacyLimit;
  if (!Number.isInteger(policy.hourlyLimit) || policy.hourlyLimit < 1 || policy.hourlyLimit > 100) {
    throw new Error("Invalid confirmed provider hourly allowance.");
  }
  return policy.hourlyLimit;
}
