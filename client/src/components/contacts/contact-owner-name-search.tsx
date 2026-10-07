import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@shared/schema";
import type { OwnerNameResult } from "@shared/salonOwnerName";
import { apiRequest } from "@/lib/queryClient";
import { OwnerNameReview } from "@/components/owner-name-review";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search } from "lucide-react";

export default function ContactOwnerNameSearch({ contact }: { contact: Contact }) {
  const [open, setOpen] = useState(false);
  const result = useQuery<{ rowId: string | null; ownerName: OwnerNameResult }>({
    queryKey: ["/api/contacts", contact.id, "owner-name"],
    queryFn: async () => (await apiRequest("GET", `/api/contacts/${contact.id}/owner-name`)).json(),
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });
  return <>
    <Button size="sm" variant="outline" className="mb-2 w-full gap-1.5"
      data-testid="button-search-contact-name" onClick={() => setOpen(true)}
      disabled={!!contact.archivedAt}>
      <Search className="h-3.5 w-3.5" />Search for owner’s name
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="contact-owner-name-dialog">
        <DialogHeader>
          <DialogTitle>Find a contact name · {contact.company || "Business name missing"}</DialogTitle>
          <DialogDescription>
            Search known business pages, Google results and available Google AI Overview suggestions.
            Review the evidence, then save a supported owner name to this Contact. Paid searches require confirmation.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">{[contact.address, contact.city, contact.state, contact.zipCode].filter(Boolean).join(", ") || "No address saved"}</p>
        {result.isLoading ? <p role="status">Loading saved name research…</p>
          : result.isError ? <div role="alert" className="text-sm text-destructive">
            <p>{(result.error as Error).message}</p>
            <Button variant="outline" onClick={() => result.refetch()}>Retry loading</Button>
          </div>
          : result.data && <OwnerNameReview rowId={contact.id} contactId={contact.id}
            businessName={contact.company || ""} ownerName={result.data.ownerName} contactName={{
              firstName: contact.firstName, lastName: contact.lastName,
              useBusinessNameForEmail: contact.useBusinessNameForEmail === "Yes" ? "Yes"
                : contact.useBusinessNameForEmail === "No" ? "No" : null,
            }} />}
      </DialogContent>
    </Dialog>
  </>;
}
