import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import ContactList from "@/components/contacts/contact-list";
import ContactForm from "@/components/contacts/contact-form";
import ContactImport from "@/components/contacts/contact-import";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Users, Archive, ArchiveRestore } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Deal, User } from "@shared/schema";

export default function Contacts() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | undefined>();
  const [showArchived, setShowArchived] = useState(false);
  const [usesSoftwareFilter, setUsesSoftwareFilter] = useState<"all" | "Yes" | "No" | "Unknown">("all");

  const [sortColumn, setSortColumn] = useState<"name" | "company" | "lastContact" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const initialFilterUserId = isAdmin ? new URLSearchParams(window.location.search).get("filterUserId") || "" : "";
  const [filterUserId, setFilterUserId] = useState(initialFilterUserId);

  const handleFilterChange = (value: string) => {
    setFilterUserId(value === "all" ? "" : value);
  };

  const { data: adminUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", searchQuery, filterUserId, showArchived],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (filterUserId) params.set("filterUserId", filterUserId);
      if (showArchived) params.set("showArchived", "true");
      const queryString = params.toString();
      const url = queryString ? `/api/contacts?${queryString}` : "/api/contacts";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch contacts");
      return response.json();
    },
  });

  const { data: deals } = useQuery<Deal[]>({
    queryKey: ["/api/deals", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const url = queryString ? `/api/deals?${queryString}` : "/api/deals";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch deals");
      return response.json();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/contacts/${id}/archive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact archived", description: "Contact moved to archive. You can restore it anytime." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to archive contact", variant: "destructive" });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/contacts/${id}/unarchive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact restored", description: "Contact has been moved back to your active contacts." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to restore contact", variant: "destructive" });
    },
  });

  const statusChangeMutation = useMutation({
    mutationFn: async ({ contactId, status }: { contactId: string; status: string }) => {
      return apiRequest("PATCH", `/api/contacts/${contactId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Status updated", description: "Contact status has been updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to update contact status", variant: "destructive" });
    },
  });

  const handleEdit = (contact: Contact) => {
    setSelectedContact(contact);
    setIsFormOpen(true);
  };

  const handleArchive = (id: string) => {
    if (confirm("Archive this contact? Their deals and history will be kept. You can restore them anytime.")) {
      archiveMutation.mutate(id);
    }
  };

  const handleUnarchive = (id: string) => {
    unarchiveMutation.mutate(id);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedContact(undefined);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
  };

  const handleExport = () => {
    window.open('/api/export/contacts', '_blank');
  };

  const assignMutation = useMutation({
    mutationFn: async ({ contactId, userId: newUserId }: { contactId: string; userId: string }) => {
      return apiRequest("PATCH", `/api/contacts/${contactId}/assign`, { userId: newUserId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact reassigned", description: "Contact has been assigned to the selected salesperson." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to reassign contact", variant: "destructive" });
    },
  });

  const handleStatusChange = (contactId: string, newStatus: string) => {
    statusChangeMutation.mutate({ contactId, status: newStatus });
  };

  const handleAssign = (contactId: string, newUserId: string) => {
    assignMutation.mutate({ contactId, userId: newUserId });
  };

  const handleSortChange = (col: "name" | "company" | "lastContact") => {
    if (sortColumn === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  };

  const sortedContacts = useMemo(() => {
    if (!contacts || !Array.isArray(contacts)) return [];
    let list = [...contacts];

    if (usesSoftwareFilter !== "all") {
      list = list.filter(c => c.usesSoftware === usesSoftwareFilter);
    }

    if (sortColumn) {
      list.sort((a, b) => {
        let aVal: string | number = "";
        let bVal: string | number = "";

        if (sortColumn === "name") {
          aVal = `${a.firstName} ${a.lastName}`.toLowerCase();
          bVal = `${b.firstName} ${b.lastName}`.toLowerCase();
        } else if (sortColumn === "company") {
          aVal = (a.company || "").toLowerCase();
          bVal = (b.company || "").toLowerCase();
        } else if (sortColumn === "lastContact") {
          aVal = a.lastContactDate ? new Date(a.lastContactDate).getTime() : 0;
          bVal = b.lastContactDate ? new Date(b.lastContactDate).getTime() : 0;
        }

        if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    } else {
      // Default: Active first, then Pipeline, then Inactive
      const statusOrder: Record<string, number> = { active: 0, pipeline: 1, inactive: 2 };
      list.sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 1;
        const bOrder = statusOrder[b.status] ?? 1;
        return aOrder - bOrder;
      });
    }

    return list;
  }, [contacts, sortColumn, sortDir, usesSoftwareFilter]);

  return (
    <>
      <Header 
        title="Contacts" 
        onSearch={setSearchQuery}
        onAddNew={() => setIsFormOpen(true)}
        onImport={() => setIsImportOpen(true)}
        showImportButton={true}
        addButtonText="Add Contact"
        customActions={
          <div className="flex items-center gap-2">
            <Select
              value={usesSoftwareFilter}
              onValueChange={(v) => setUsesSoftwareFilter(v as typeof usesSoftwareFilter)}
            >
              <SelectTrigger className="w-[190px]" data-testid="select-uses-software-filter">
                <SelectValue placeholder="Uses Software" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contacts</SelectItem>
                <SelectItem value="Yes">✓ Uses Software</SelectItem>
                <SelectItem value="No">✗ No Software</SelectItem>
                <SelectItem value="Unknown">? Unknown</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setShowArchived(v => !v)}
              data-testid="button-toggle-archived"
            >
              {showArchived ? (
                <><ArchiveRestore className="h-4 w-4 mr-2" />Active Contacts</>
              ) : (
                <><Archive className="h-4 w-4 mr-2" />Archived</>
              )}
            </Button>
            {isAdmin && (
              <>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Select value={filterUserId || "all"} onValueChange={handleFilterChange}>
                    <SelectTrigger className="w-[200px]" data-testid="select-filter-user">
                      <SelectValue placeholder="All Salespeople" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Salespeople</SelectItem>
                      {adminUsers?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email || "Unknown"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleExport}
                  data-testid="button-export"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </>
            )}
          </div>
        }
      />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="contacts-content">
        <ContactList
          contacts={sortedContacts}
          deals={deals}
          isLoading={isLoading}
          isAdmin={isAdmin}
          adminUsers={adminUsers}
          showArchived={showArchived}
          sortColumn={sortColumn}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onEdit={handleEdit}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          onStatusChange={handleStatusChange}
          onAssign={handleAssign}
        />
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedContact ? "Edit Contact" : "Add New Contact"}
            </DialogTitle>
          </DialogHeader>
          <ContactForm
            contact={selectedContact}
            onSuccess={handleFormSuccess}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      <ContactImport 
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </>
  );
}
