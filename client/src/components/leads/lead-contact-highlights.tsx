import { Badge } from "@/components/ui/badge";
import { ExternalLink, Mail, UserRound } from "lucide-react";
import { relevantOwnerCandidate } from "@shared/salonOwnerDiscoveryRelevance";

type Candidate = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  roleConfirmed?: boolean;
  businessMatched?: boolean;
  confidence?: string | number;
};

type Props = {
  businessName: string;
  contactName?: {
    firstName?: string | null;
    lastName?: string | null;
    useBusinessNameForEmail?: "Yes" | "No" | null;
  } | null;
  ownerName?: {
    candidates?: Candidate[];
    selectedCandidateId?: string | null;
    approvedAt?: string | null;
    status?: string;
  } | null;
  email?: string | null;
  candidateEmail?: string | null;
  reviewStatus?: string | null;
  importedContactId?: string | null;
  sourceUrl?: string | null;
};

const clean = (value?: string | null) => value?.trim() ?? "";
const normalizeName = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

export function LeadContactHighlights({
  businessName, contactName, ownerName, email, candidateEmail, reviewStatus,
  importedContactId, sourceUrl,
}: Props) {
  const contactFullName = [clean(contactName?.firstName), clean(contactName?.lastName)].filter(Boolean).join(" ");
  const isBusinessLabel = Boolean(contactFullName && normalizeName(contactFullName) === normalizeName(businessName));
  const displayContactName = contactFullName && !isBusinessLabel ? contactFullName : "";

  const candidates = (ownerName?.candidates ?? []).filter(candidate =>
    relevantOwnerCandidate(candidate as Parameters<typeof relevantOwnerCandidate>[0], businessName),
  );
  const uniqueCandidates = candidates.filter((candidate, index) => {
    const name = [clean(candidate.firstName), clean(candidate.lastName)].filter(Boolean).join(" ");
    return Boolean(name) &&
      normalizeName(name) !== normalizeName(businessName) &&
      candidates.findIndex(other =>
        normalizeName([clean(other.firstName), clean(other.lastName)].filter(Boolean).join(" ")) === normalizeName(name),
      ) === index;
  });
  const selectedCandidate = uniqueCandidates.find(candidate => candidate.id === ownerName?.selectedCandidateId);
  const strongestCandidate = selectedCandidate ?? [...uniqueCandidates].sort((a, b) =>
    Number(Boolean(b.roleConfirmed && b.businessMatched)) - Number(Boolean(a.roleConfirmed && a.businessMatched)),
  )[0];
  const ownerApproved = Boolean(
    strongestCandidate?.id &&
    strongestCandidate.roleConfirmed && strongestCandidate.businessMatched &&
    ownerName?.approvedAt &&
    ownerName.selectedCandidateId === strongestCandidate.id,
  );
  const approvedEmail = reviewStatus === "approved" ? clean(email) : "";
  const suggestedEmail = approvedEmail ? "" : clean(candidateEmail) || clean(email);
  const hasAnyContact = Boolean(displayContactName || strongestCandidate || approvedEmail || suggestedEmail);

  if (!hasAnyContact) return null;

  return (
    <section
      className="mt-4 grid gap-3 rounded-xl border-2 border-slate-400 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-900/40 sm:grid-cols-2 sm:p-4"
      aria-label="Found contact details"
    >
      <div className="min-w-0 rounded-lg border-2 border-slate-300 bg-card p-3 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary/10 p-1.5 text-primary"><UserRound className="h-4 w-4" /></span>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Found contact</p>
        </div>
        {displayContactName ? (
          <div className="mt-2">
            <p className="break-words text-xl font-bold leading-tight text-foreground">{displayContactName}</p>
            <Badge className="mt-2" variant={importedContactId ? "secondary" : "outline"}>
              {importedContactId ? "Name on linked contact" : "Name suggestion · review status separate"}
            </Badge>
          </div>
        ) : strongestCandidate ? (
          <div className="mt-2">
            <p className="break-words text-xl font-bold leading-tight text-foreground">
              {[clean(strongestCandidate.firstName), clean(strongestCandidate.lastName)].filter(Boolean).join(" ")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={ownerApproved ? "default" : "outline"}>
                {ownerApproved ? "Owner approved" : "Unverified candidate"}
              </Badge>
              {strongestCandidate.role && <Badge variant="secondary">{strongestCandidate.role}</Badge>}
              {uniqueCandidates.length > 1 && <Badge variant="outline">{uniqueCandidates.length} distinct candidates</Badge>}
            </div>
            {!ownerApproved && <p className="mt-2 text-xs leading-5 text-muted-foreground">
              This is a source-backed suggestion, not an approved contact name. Review evidence before using a personal greeting.
            </p>}
          </div>
        ) : (
          <p className="mt-2 text-sm font-medium text-muted-foreground">No personal contact name found</p>
        )}
        {displayContactName && strongestCandidate && (
          <p className="mt-2 border-t border-slate-300 pt-2 text-xs leading-5 text-muted-foreground dark:border-slate-700">
            Owner search also found {[clean(strongestCandidate.firstName), clean(strongestCandidate.lastName)].filter(Boolean).join(" ")}
            {ownerApproved ? " (approved)" : " (unverified)"}
            {uniqueCandidates.length > 1 ? ` · ${uniqueCandidates.length} distinct candidates` : ""}.
          </p>
        )}
      </div>

      <div className={`min-w-0 rounded-lg border-2 p-3 ${approvedEmail
        ? "border-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
        : "border-amber-700 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"}`}>
        <div className="flex items-center gap-2">
          <span className={`rounded-md p-1.5 ${approvedEmail ? "bg-emerald-900/10 text-emerald-900 dark:text-emerald-200" : "bg-amber-900/10 text-amber-950 dark:text-amber-200"}`}>
            <Mail className="h-4 w-4" />
          </span>
          <p className="text-xs font-bold uppercase tracking-wide">Email</p>
          <Badge className="ml-auto" variant={approvedEmail ? "default" : "outline"}>
            {approvedEmail ? "Approved" : "Unverified"}
          </Badge>
        </div>
        <p className="mt-2 break-all text-lg font-bold leading-snug text-foreground" data-testid="lead-highlight-email">
          {approvedEmail || suggestedEmail || "No email found"}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {approvedEmail
            ? "Approved for this business; deliverability is not guaranteed."
            : suggestedEmail
              ? "Suggestion only. Review the source before approving; this address is not linked for sending."
              : "No address is available to review."}
        </p>
        {approvedEmail && candidateEmail && clean(candidateEmail) !== approvedEmail && (
          <p className="mt-2 break-all border-t border-emerald-800/30 pt-2 text-xs text-muted-foreground">
            Other suggestion (unverified): <span className="font-semibold text-foreground">{candidateEmail}</span>
          </p>
        )}
        {sourceUrl && (
          <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline" href={sourceUrl} target="_blank" rel="noreferrer">
            Review source evidence <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </section>
  );
}
