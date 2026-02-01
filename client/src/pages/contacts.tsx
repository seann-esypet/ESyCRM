import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import ContactList from "@/components/contacts/contact-list";
import ContactForm from "@/components/contacts/contact-form";
import ContactImport from "@/components/contacts/contact-import";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";

export default function Contacts() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | undefined>();

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", searchQuery],
    queryFn: async () => {
      const url = searchQuery 
        ? `/api/contacts?search=${encodeURIComponent(searchQuery)}`
        : "/api/contacts";
      const response = await fetch(url);
      return response.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/contacts/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete contact");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
  });

  const statusChangeMutation = useMutation({
    mutationFn: async ({ contactId, status }: { contactId: string; status: string }) => {
      return apiRequest("PATCH", `/api/contacts/${contactId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Status updated",
        description: "Contact status has been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update contact status",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (contact: Contact) => {
    setSelectedContact(contact);
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this contact?")) {
      deleteMutation.mutate(id);
    }
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

  const handleStatusChange = (contactId: string, newStatus: string) => {
    statusChangeMutation.mutate({ contactId, status: newStatus });
  };

  // Sort contacts: Active first, then Pipeline and Inactive at the bottom
  const sortedContacts = useMemo(() => {
    if (!contacts) return [];
    const statusOrder: Record<string, number> = { active: 0, pipeline: 1, inactive: 2 };
    return [...contacts].sort((a, b) => {
      const aOrder = statusOrder[a.status] ?? 1;
      const bOrder = statusOrder[b.status] ?? 1;
      return aOrder - bOrder;
    });
  }, [contacts]);

  return (
    <>
      <Header 
        title="Contacts" 
        onSearch={setSearchQuery}
        onAddNew={() => setIsFormOpen(true)}
        onImport={() => setIsImportOpen(true)}
        showImportButton={true}
        addButtonText="Add Contact"
        customActions={isAdmin ? (
          <Button 
            variant="outline" 
            onClick={handleExport}
            data-testid="button-export"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        ) : null}
      />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="contacts-content">
        <ContactList
          contacts={sortedContacts}
          isLoading={isLoading}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
        />
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl">
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
