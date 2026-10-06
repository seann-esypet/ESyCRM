import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProviderCreditSnapshot } from "@shared/providerCredits";
import { APPROVED_SERP_BUDGET } from "@shared/serpBudget";

export function SharedProviderBudgetPanel({ batchId, snapshot, onUpdated }: {
  batchId: string;
  snapshot?: ProviderCreditSnapshot;
  onUpdated: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const budget = snapshot?.sharedBudget;
  const blocked = budget && budget.used >= budget.hardStopAt;
  const needsUpdate = budget && (budget.monthlyQuota !== 1000 || budget.hardStopAt !== 800);
  const verified = snapshot?.status === "available" && (snapshot.monthlyLimit ?? 0) >= 1000;
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/leads/${encodeURIComponent(batchId)}/shared-provider-budget`, {
        confirmed: true, ...APPROVED_SERP_BUDGET,
      });
      return response.json();
    },
    onSuccess: async () => {
      setConfirmed(false);
      setMessage("Shared budget saved: 1,000-search allowance, 800-attempt safety stop. Prior spending is retained. Paused lists still need a separate Confirm and resume.");
      await onUpdated();
    },
    onError: error => setMessage(error.message),
  });
  if (!budget) return null;
  return <div data-testid="shared-provider-budget" className="space-y-3 rounded-lg border bg-muted/30 p-3">
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div><b data-testid="shared-provider-budget-count">{budget.used.toLocaleString()} / {budget.hardStopAt.toLocaleString()}</b><span className="block text-xs text-muted-foreground">shared monthly attempts / safety stop</span></div>
      <div><b>{budget.remaining.toLocaleString()}</b><span className="block text-xs text-muted-foreground">attempts left before shared safety stop</span></div>
      <div><b>{budget.monthlyQuota.toLocaleString()}</b><span className="block text-xs text-muted-foreground">app’s saved monthly allowance</span></div>
    </div>
    <p className="text-xs text-muted-foreground">All lists share this app safety budget for {budget.monthYear}. It is separate from SerpAPI credits and each list’s cap. Upgrading SerpAPI does not raise it automatically.</p>
    {blocked && <Alert data-testid="shared-provider-budget-blocked">
      <AlertTitle>Shared app safety stop reached</AlertTitle>
      <AlertDescription>SerpAPI may still have credits. This app has reached its shared monthly attempt cap; waiting an hour will not clear this stop.</AlertDescription>
    </Alert>}
    {needsUpdate && (user?.role === "admin" ? <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Update the shared budget for the upgraded plan</p>
      <label className="flex items-start gap-2 text-xs leading-5">
        <Checkbox data-testid="shared-provider-budget-consent" checked={confirmed}
          onCheckedChange={value => setConfirmed(value === true)} disabled={mutation.isPending || !verified}/>
        <span>I approve a 1,000-search monthly allowance and an 800-attempt shared safety stop. This increases permitted spending across all lists. Keep existing attempt counts and individual list caps; do not resume paused research.</span>
      </label>
      {!verified && <p className="text-xs text-muted-foreground">Check the provider balance to verify an allowance of at least 1,000 searches before updating this budget.</p>}
      <Button data-testid="shared-provider-budget-update" size="sm" disabled={!confirmed || !verified || mutation.isPending}
        onClick={() => { setMessage(""); mutation.mutate(); }}>{mutation.isPending ? "Saving shared budget…" : "Confirm shared budget update"}</Button>
    </div> : <p className="text-xs text-muted-foreground">An administrator can confirm the shared-budget update for the upgraded plan. Your list’s cap and spending history remain unchanged.</p>)}
    {message && <p role={mutation.isError ? "alert" : "status"} className={`text-xs ${mutation.isError ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>}
  </div>;
}
