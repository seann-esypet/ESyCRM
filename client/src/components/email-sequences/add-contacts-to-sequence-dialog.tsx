import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Mail, Users, Search, Plus, FolderOpen, CalendarClock } from "lucide-react";
import type { EmailSequence, Contact, ContactGroup } from "@shared/schema";

interface AddContactsToSequenceDialogProps {
  sequence: EmailSequence;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GroupMode = "new" | "existing" | "none";
type SoftwareFilter = "all" | "yes" | "no" | "unknown";

const SOFTWARE_FILTERS: { value: SoftwareFilter; label: string }[] = [
  { value: "all",     label: "All" },
  { value: "yes",     label: "✓ Uses Software" },
  { value: "no",      label: "✗ No Software" },
  { value: "unknown", label: "? Unknown" },
];

export default function AddContactsToSequenceDialog({
  sequence,
  open,
  onOpenChange,
}: AddContactsToSequenceDialogProps) {
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [softwareFilter, setSoftwareFilter] = useState<SoftwareFilter>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("new");
  const [newGroupName, setNewGroupName] = useState("");
  const [existingGroupId, setExistingGroupId] = useState("");
  const [sendDate, setSendDate] = useState("");
  const [sendTime, setSendTime] = useState("09:00");
  const { toast } = useToast();

  const { data: allContacts, isLoading: isLoadingContacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    enabled: open,
  });

  const { data: groups, isLoading: isLoadingGroups } = useQuery<ContactGroup[]>({
    queryKey: ["/api/contact-groups"],
    enabled: open,
  });

  const filteredContacts = useMemo(() => {
    if (!allContacts) return [];
    let list = allContacts;

    // Software filter
    if (softwareFilter === "yes")     list = list.filter(c => c.usesSoftware === "Yes");
    if (softwareFilter === "no")      list = list.filter(c => c.usesSoftware === "No");
    if (softwareFilter === "unknown") list = list.filter(c => !c.usesSoftware || c.usesSoftware === "Unknown");

    // Text search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [allContacts, search, softwareFilter]);

  // Counts per software filter for badges
  const softwareCounts = useMemo(() => {
    if (!allContacts) return { all: 0, yes: 0, no: 0, unknown: 0 };
    return {
      all:     allContacts.length,
      yes:     allContacts.filter(c => c.usesSoftware === "Yes").length,
      no:      allContacts.filter(c => c.usesSoftware === "No").length,
      unknown: allContacts.filter(c => !c.usesSoftware || c.usesSoftware === "Unknown").length,
    };
  }, [allContacts]);

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setSelectedContacts([]);
      setSearch("");
      setSoftwareFilter("all");
      setGroupMode("new");
      setNewGroupName("");
      setExistingGroupId("");
      setSendDate("");
      setSendTime("09:00");
    }
    onOpenChange(val);
  };

  const toggleContact = (id: string) => {
    setSelectedContacts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const visibleIds = filteredContacts.map(c => c.id);
    const allVisible = visibleIds.every(id => selectedContacts.includes(id));
    if (allVisible) {
      setSelectedContacts(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedContacts(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const allVisibleSelected = filteredContacts.length > 0 &&
    filteredContacts.every(c => selectedContacts.includes(c.id));

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (selectedContacts.length === 0) throw new Error("No contacts selected");
      if (!sendDate) throw new Error("Please pick a send date");

      let groupId: string | null = null;

      if (groupMode === "new") {
        if (!newGroupName.trim()) throw new Error("Please enter a group name");
        const groupRes = await apiRequest("POST", "/api/contact-groups", { name: newGroupName.trim() });
        if (!groupRes.ok) throw new Error("Failed to create group");
        const group = await groupRes.json();
        groupId = group.id;
        await apiRequest("POST", `/api/contact-groups/${groupId}/assign-contacts`, {
          contactIds: selectedContacts,
        });
      } else if (groupMode === "existing") {
        if (!existingGroupId) throw new Error("Please select a group");
        groupId = existingGroupId;
        await apiRequest("POST", `/api/contact-groups/${groupId}/assign-contacts`, {
          contactIds: selectedContacts,
        });
      }

      // Build an ISO string with the correct Eastern Time offset (handles DST automatically).
      // Probe: take noon UTC on the chosen date, see what hour ET shows — that gives us the offset.
      const refUtc = new Date(`${sendDate}T12:00:00Z`);
      const etHour = parseInt(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          hour12: false,
        }).format(refUtc),
        10
      );
      // etHour = 12 + offset  →  offset = etHour - 12  (e.g. 7 for EST = -5, 8 for EDT = -4)
      const offsetHours = etHour - 12; // negative for ET (e.g. -5 or -4)
      const sign = offsetHours >= 0 ? "+" : "-";
      const etOffsetStr = `${sign}${String(Math.abs(offsetHours)).padStart(2, "0")}:00`;
      const scheduledSendAt = `${sendDate}T${sendTime}:00${etOffsetStr}`;

      const bulkRes = await apiRequest("POST", "/api/email-sequence-logs/bulk", {
        sequenceId: sequence.id,
        contactIds: selectedContacts,
        scheduledSendAt,
      });
      if (!bulkRes.ok) {
        const err = await bulkRes.json().catch(() => ({ message: "Failed to schedule sequence" }));
        throw new Error(err.message);
      }
      return bulkRes.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contact-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      const groupLabel = groupMode === "new"
        ? ` Group "${newGroupName.trim()}" created.`
        : groupMode === "existing" ? " Contacts added to group." : "";

      // Show success toast
      if (data.successful > 0) {
        toast({
          title: "Sequence scheduled",
          description: `${data.successful} contact(s) added to Sequence ${sequence.sequenceNumber}.${groupLabel}`,
        });
      }

      // Show track mismatch warnings
      const trackErrors: Array<{ contactId: string; error: string }> = data.errors ?? [];
      const trackMismatches = trackErrors.filter((e: { contactId: string; error: string }) =>
        e.error.includes("does not match sequence track")
      );
      const alreadyQueued = trackErrors.filter((e: { contactId: string; error: string }) =>
        e.error.includes("already in this email sequence")
      );

      if (trackMismatches.length > 0) {
        const names = trackMismatches.map(e => {
          const c = allContacts?.find(x => x.id === e.contactId);
          return c ? `${c.firstName} ${c.lastName}`.trim() : e.contactId;
        });
        const trackName = sequence.sequenceTrack === "uses_competitor" ? "Uses Competitor" : "No Software";
        toast({
          title: `${trackMismatches.length} contact(s) skipped — wrong track`,
          description: `These contacts don't match the "${trackName}" track and were not queued: ${names.join(", ")}`,
          variant: "destructive",
        });
      }

      if (alreadyQueued.length > 0) {
        const names = alreadyQueued.map(e => {
          const c = allContacts?.find(x => x.id === e.contactId);
          return c ? `${c.firstName} ${c.lastName}`.trim() : e.contactId;
        });
        toast({
          title: `${alreadyQueued.length} contact(s) already in queue`,
          description: `Skipped (already scheduled): ${names.join(", ")}`,
        });
      }

      if (data.successful === 0 && trackMismatches.length === 0 && alreadyQueued.length === 0) {
        toast({
          title: "Nothing scheduled",
          description: "No contacts were added. Check the errors above.",
          variant: "destructive",
        });
      }

      handleOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const trackLabel = sequence.sequenceTrack === "uses_competitor" ? "Uses Competitor" : "No Software";
  const trackColor = sequence.sequenceTrack === "uses_competitor"
    ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
    : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Add Contacts to Sequence {sequence.sequenceNumber}
            <span className={`text-xs px-2 py-0.5 rounded-full ${trackColor}`}>{trackLabel}</span>
          </DialogTitle>
          <DialogDescription>
            Create or select a group, then pick contacts to schedule for this sequence.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* Subject preview */}
          <div className="rounded-md border bg-muted/40 px-4 py-2.5 text-sm">
            <span className="font-medium">Subject:</span> {sequence.subject}
          </div>

          {/* ── Send Date & Time ─────────────────────────────────────── */}
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Send Date &amp; Time <span className="text-xs text-muted-foreground font-normal">(Eastern Time)</span>
            </p>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="send-date" className="text-xs">Date</Label>
                <Input
                  id="send-date"
                  type="date"
                  value={sendDate}
                  onChange={e => setSendDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  data-testid="input-send-date"
                />
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor="send-time" className="text-xs">Time (ET)</Label>
                <Input
                  id="send-time"
                  type="time"
                  value={sendTime}
                  onChange={e => setSendTime(e.target.value)}
                  data-testid="input-send-time"
                />
              </div>
            </div>
            {!sendDate && (
              <p className="text-xs text-amber-600 dark:text-amber-400">A send date is required before scheduling.</p>
            )}
          </div>

          {/* ── Group section ───────────────────────────────────────── */}
          <div className="rounded-md border p-3 space-y-3">
            <p className="text-sm font-medium">Group Assignment</p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant={groupMode === "new" ? "default" : "outline"}
                onClick={() => setGroupMode("new")} data-testid="button-group-new">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Create New Group
              </Button>
              <Button size="sm" variant={groupMode === "existing" ? "default" : "outline"}
                onClick={() => setGroupMode("existing")} data-testid="button-group-existing"
                disabled={!groups || groups.length === 0}>
                <FolderOpen className="h-3.5 w-3.5 mr-1.5" /> Add to Existing Group
              </Button>
              <Button size="sm" variant={groupMode === "none" ? "default" : "outline"}
                onClick={() => setGroupMode("none")} data-testid="button-group-none">
                No Group
              </Button>
            </div>

            {groupMode === "new" && (
              <div className="space-y-1.5">
                <Label htmlFor="group-name">Group Name</Label>
                <Input id="group-name" placeholder="e.g. Spring 2026 Campaign"
                  value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                  data-testid="input-group-name" />
              </div>
            )}

            {groupMode === "existing" && (
              <div className="space-y-1.5">
                <Label>Select Group</Label>
                {isLoadingGroups ? (
                  <p className="text-sm text-muted-foreground">Loading groups…</p>
                ) : (
                  <Select value={existingGroupId} onValueChange={setExistingGroupId}>
                    <SelectTrigger data-testid="select-existing-group">
                      <SelectValue placeholder="Choose a group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups?.map(g => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          {/* ── Contact picker ──────────────────────────────────────── */}
          <div className="space-y-2">
            {/* Search + selected count */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by name, email, or company…"
                  value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-8" data-testid="input-contact-search" />
              </div>
              {selectedContacts.length > 0 && (
                <Badge variant="secondary" data-testid="badge-selected-count">
                  {selectedContacts.length} selected
                </Badge>
              )}
            </div>

            {/* Software filter tabs */}
            <div className="flex gap-1.5 flex-wrap">
              {SOFTWARE_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setSoftwareFilter(f.value)}
                  data-testid={`filter-software-${f.value}`}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    softwareFilter === f.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {f.label}
                  <span className="ml-1 opacity-70">({softwareCounts[f.value]})</span>
                </button>
              ))}
            </div>

            {/* Select all row */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox id="select-all" checked={allVisibleSelected}
                onCheckedChange={toggleAll} disabled={filteredContacts.length === 0}
                data-testid="checkbox-select-all" />
              <label htmlFor="select-all" className="text-sm cursor-pointer text-muted-foreground">
                Select all visible ({filteredContacts.length} shown)
              </label>
            </div>

            {/* Contact list — fixed height with scroll */}
            <div className="border rounded-md overflow-hidden">
              <ScrollArea className="h-64">
                {isLoadingContacts ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading contacts…</div>
                ) : filteredContacts.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    {search || softwareFilter !== "all"
                      ? "No contacts match your filters."
                      : "No contacts found. Add contacts first."}
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredContacts.map(contact => (
                      <div
                        key={contact.id}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${
                          selectedContacts.includes(contact.id) ? "bg-muted/30" : ""
                        }`}
                        onClick={() => toggleContact(contact.id)}
                        data-testid={`contact-item-${contact.id}`}
                      >
                        <Checkbox
                          checked={selectedContacts.includes(contact.id)}
                          onCheckedChange={() => toggleContact(contact.id)}
                          onClick={e => e.stopPropagation()}
                          data-testid={`checkbox-contact-${contact.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {contact.firstName} {contact.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {contact.email || <span className="italic">no email</span>}
                            {contact.company && ` · ${contact.company}`}
                          </div>
                        </div>
                        {contact.usesSoftware === "Yes" && (
                          <Badge variant="outline" className="text-xs shrink-0 text-orange-600 border-orange-300">
                            ✓ Has Software
                          </Badge>
                        )}
                        {contact.usesSoftware === "No" && (
                          <Badge variant="outline" className="text-xs shrink-0 text-green-600 border-green-300">
                            ✗ No Software
                          </Badge>
                        )}
                        {(!contact.usesSoftware || contact.usesSoftware === "Unknown") && (
                          <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                            ? Unknown
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t mt-2 shrink-0">
          <p className="text-xs text-muted-foreground">
            {selectedContacts.length} of {allContacts?.length ?? 0} contacts selected
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={
                selectedContacts.length === 0 ||
                submitMutation.isPending ||
                !sendDate ||
                (groupMode === "new" && !newGroupName.trim()) ||
                (groupMode === "existing" && !existingGroupId)
              }
              data-testid="button-submit"
            >
              <Users className="h-4 w-4 mr-2" />
              {submitMutation.isPending
                ? "Scheduling…"
                : groupMode === "none"
                  ? `Add ${selectedContacts.length} to Sequence`
                  : `Create Group & Add ${selectedContacts.length} to Sequence`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
