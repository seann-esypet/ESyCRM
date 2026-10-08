import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { DirectoryEligibility } from "@shared/directoryEligibility";

type Duplicate = { id: string; company?: string; email?: string; address?: string; matchReasons?: string[] };
type Result = { contactId?: string; needsDuplicateReview?: boolean; duplicates?: Duplicate[] };
export type ApprovedContactLead = {
  id: string; businessName: string; email?: string; reviewStatus?: string;
  importedContactId?: string; eligibility?: unknown;
};

export function ApprovedContactNextStep({ lead, onRefresh, onReview, onAdded, onDismiss }: {
  lead: ApprovedContactLead;
  onRefresh: () => void;
  onReview: () => void;
  onAdded: (contactId: string) => void;
  onDismiss: () => void;
}) {
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [selected, setSelected] = useState("");
  const [addedId, setAddedId] = useState("");
  const submitting = useRef(false);
  const contactId = addedId || lead.importedContactId;
  const eligibility = lead.eligibility as DirectoryEligibility | undefined;
  const canAdd = lead.reviewStatus === "approved" && !eligibility?.blocked &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email?.trim() || "");
  const mutation = useMutation({
    mutationFn: async (linkContactId?: string) => {
      const response = await apiRequest("POST", `/api/leads/rows/${encodeURIComponent(lead.id)}/crm`, {
        confirmed: true, ...(linkContactId ? { linkContactId } : {}),
      });
      const result: Result = await response.json();
      if (result.needsDuplicateReview) {
        if (!result.duplicates?.length) throw new Error("No selectable matching Contacts were returned. Review the business and try again.");
      } else if (!result.contactId) {
        throw new Error("The server did not confirm a Contact. Retry to check its current status.");
      }
      return result;
    },
    onSuccess: result => {
      if (result.needsDuplicateReview) {
        setDuplicates(result.duplicates!);
        setSelected("");
        return;
      }
      setAddedId(result.contactId!);
      setDuplicates([]);
      onAdded(result.contactId!);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/rows", lead.id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/rows", lead.id, "sequences"] });
      onRefresh();
    },
  });
  const add = (linkContactId?: string) => {
    if (submitting.current) return;
    submitting.current = true;
    mutation.mutate(linkContactId, { onSettled: () => { submitting.current = false; } });
  };

  return <section data-testid="approved-contact-next-step" data-lead-id={lead.id}
    aria-live="polite" className="rounded-xl border-2 border-primary bg-primary/[0.06] p-4 shadow-sm">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <h3 className="break-words text-base font-bold">{contactId ? "Added to Contacts" :
          lead.reviewStatus === "approved" ? "Approved—not yet in Contacts" : "Approval changed—review this business again"}</h3>
        <p className="mt-1 break-words font-semibold">{lead.businessName}</p>
        <p className="mt-1 break-all text-sm">Saved email: {lead.email || "No email saved"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{contactId
          ? "The server confirmed the Contact. No sequence was scheduled or email sent."
          : "Approval saved your review only. Adding the Contact is a separate step; this confirmation stays here when the business moves in the list."}</p>
      </div>
      <div className="flex w-full min-w-0 shrink-0 flex-wrap gap-2 sm:w-auto">
        {contactId ? <>
          <Link href={`/contacts?edit=${encodeURIComponent(contactId)}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground sm:w-auto">Open Contact</Link>
          <Button className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto" variant="outline" onClick={onDismiss}>Dismiss confirmation</Button>
        </> : <>
          {!duplicates.length && <Button className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto" disabled={!canAdd || mutation.isPending}
            onClick={() => add()}>{mutation.isPending ? "Adding to Contacts…" : "Add to Contacts"}</Button>}
          <Button className="h-auto min-h-11 w-full whitespace-normal py-2 sm:w-auto" variant="outline" disabled={mutation.isPending} onClick={onReview}>Review business</Button>
        </>}
      </div>
    </div>
    {!contactId && !canAdd && <p className="mt-3 text-sm font-medium text-amber-900 dark:text-amber-200">
      Review the current email approval and grooming eligibility before adding this Contact.
    </p>}
    {!contactId && duplicates.length > 0 && <div className="mt-4 space-y-3 rounded-lg border-2 p-3">
      <p className="font-semibold">Possible matching Contacts—choose one to link</p>
      <p className="text-sm text-muted-foreground">Nothing has been linked or overwritten. Confirm the matching business below.</p>
      {duplicates.map(duplicate => <label key={duplicate.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
        <input type="radio" name={`approved-contact-duplicate-${lead.id}`} value={duplicate.id}
          checked={selected === duplicate.id} disabled={mutation.isPending} onChange={() => setSelected(duplicate.id)} />
        <span className="min-w-0 break-words">{duplicate.company || "Unnamed Contact"} · {duplicate.email || "No email"}
          {duplicate.address && <span className="block">{duplicate.address}</span>}
          {duplicate.matchReasons?.length ? <span className="block text-muted-foreground">Matches: {duplicate.matchReasons.join(", ")}</span> : null}</span>
      </label>)}
      <Button className="h-auto min-h-11 whitespace-normal py-2" disabled={!selected || !canAdd || mutation.isPending} onClick={() => add(selected)}>
        {mutation.isPending ? "Linking…" : "Confirm link to selected Contact"}
      </Button>
    </div>}
    {mutation.isError && <p role="alert" className="mt-3 rounded-md border border-destructive p-3 text-sm text-destructive">
      Could not confirm addition: {mutation.error.message}
    </p>}
  </section>;
}
