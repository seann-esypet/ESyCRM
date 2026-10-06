/** Sanitized account usage only. Never include provider identity or credentials. */
export type ProviderCredits = {
  status: "available" | "unavailable";
  remaining: number | null;
  monthlyLimit: number | null;
  usedThisMonth: number | null;
  checkedAt: string;
};
