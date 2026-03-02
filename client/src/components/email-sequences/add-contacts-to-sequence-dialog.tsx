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
import { Mail, Users, Search, Plus, FolderOpen } from "lucide-react";
import type { EmailSequence, Contact, ContactGroup } from "@shared/schema";

interface AddContactsToSequenceDialogProps {
  sequence: EmailSequence;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GroupMode = "new" | "existing" | "none";

export default function AddContactsToSequenceDialog({
  sequence,
  open,
  onOpenChange,
}: AddContactsToSequenceDialogProps) {
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("new");
  const [newGroupName, setNewGroupName] = useState("");
  const [existingGroupId, setExistingGroupId] = useState("");
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
    const q = search.trim().toLowerCase();
    if (!q) return allContacts;
    return allContacts.filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  }, [allContacts, search]);

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setSelectedContacts([]);
      setSearch("");
      setGroupMode("new");
      setNewGroupName("");
      setExistingGroupId("");
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

      const bulkRes = await apiRequest("POST", "/api/email-sequence-logs/bulk", {
        sequenceId: sequence.id,
        contactIds: selectedContacts,
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
      toast({
        title: "Sequence scheduled",
        description: `${data.successful || 0} contact(s) added to Sequence ${sequence.sequenceNumber}.${groupLabel}`,
      });
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Add Contacts to Sequence {sequence.sequenceNumber}
            <span className={`text-xs px-2 py-0.5 rounded-full ${trackColor}`}>{trackLabel}</span>
          </DialogTitle>
          <DialogDescription>
            Create or select a group, then pick contacts to schedule for this sequence.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Subject preview */}
          <div className="rounded-md border bg-muted/40 px-4 py-2.5 text-sm">
            <span className="font-medium">Subject:</span> {sequence.subject}
          </div>

          {/* ── Group section ───────────────────────────────────────── */}
          <div className="rounded-md border p-4 space-y-3">
            <p className="text-sm font-medium">Group Assignment</p>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={groupMode === "new" ? "default" : "outline"}
                onClick={() => setGroupMode("new")}
                data-testid="button-group-new"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create New Group
              </Button>
              <Button
                size="sm"
                variant={groupMode === "existing" ? "default" : "outline"}
                onClick={() => setGroupMode("existing")}
                data-testid="button-group-existing"
                disabled={!groups || groups.length === 0}
              >
                <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                Add to Existing Group
              </Button>
              <Button
                size="sm"
                variant={groupMode === "none" ? "default" : "outline"}
                onClick={() => setGroupMode("none")}
                data-testid="button-group-none"
              >
                No Group
              </Button>
            </div>

            {groupMode === "new" && (
              <div className="space-y-1.5">
                <Label htmlFor="group-name">Group Name</Label>
                <Input
                  id="group-name"
                  placeholder="e.g. Spring 2026 Campaign"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  data-testid="input-group-name"
                />
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
          <div className="flex-1 overflow-hidden flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search contacts…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8"
                  data-testid="input-contact-search"
                />
              </div>
              {selectedContacts.length > 0 && (
                <Badge variant="secondary" data-testid="badge-selected-count">
                  {selectedContacts.length} selected
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 px-1">
              <Checkbox
                id="select-all"
                checked={allVisibleSelected}
                onCheckedChange={toggleAll}
                disabled={filteredContacts.length === 0}
                data-testid="checkbox-select-all"
              />
              <label htmlFor="select-all" className="text-sm cursor-pointer text-muted-foreground">
                Select all visible ({filteredContacts.length} shown)
              </label>
            </div>

            <ScrollArea className="flex-1 border rounded-md">
              {isLoadingContacts ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading contacts…</div>
              ) : filteredContacts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  {search ? "No contacts match your search." : "No contacts found. Add contacts first."}
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
                          {contact.email ?? <span className="italic">no email</span>}
                          {contact.company && ` · ${contact.company}`}
                        </div>
                      </div>
                      {contact.usesSoftware === "Yes" && (
                        <Badge variant="outline" className="text-xs shrink-0">Has Software</Badge>
                      )}
                      {contact.usesSoftware === "No" && (
                        <Badge variant="outline" className="text-xs shrink-0 text-green-600">No Software</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
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
