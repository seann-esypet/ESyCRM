import type { SerpRequestPolicy } from "./serpRequestPolicy";

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

/** Account exhaustion is not a temporary throttle, even when returned as HTTP 429. */
export function permanentSerpQuota(message: string) {
  return /quota|credits?|exhausted|run out|out of searches|(?:no|0|zero) searches left|monthly.*limit/i.test(message) ||
    (/account.{0,80}limit/i.test(message) && !/hour|throughput|per minute|per second/i.test(message));
}

export async function readSerpProviderResponse<T extends { error?: string }>(
  response: Response, policy?: SerpRequestPolicy,
): Promise<T> {
  const payload = await response.json().catch(error => {
    if (response.ok) throw error;
    return {};
  }) as T;
  const providerMessage = String(payload?.error || "");
  if (response.ok && !providerMessage) return payload;
  const permanent = permanentSerpQuota(providerMessage);
  const temporary = !permanent && ![401, 403].includes(response.status) &&
    (response.status === 429 || /rate limit|too many requests|temporar.*throttl/i.test(providerMessage));
  const message = temporary ? "SerpAPI rate limit reached"
    : permanent ? "SERP quota reached – review the provider account before resuming"
    : `SerpAPI lookup failed (HTTP ${response.status})`;
  await policy?.onProviderBlocked?.({
    temporary, message,
    ...(temporary ? { retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")) } : {}),
  });
  throw new Error(message);
}
