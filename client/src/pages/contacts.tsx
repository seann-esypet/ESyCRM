import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import ContactList from "@/components/contacts/contact-list";
import ContactForm from "@/components/contacts/contact-form";
import ContactImport from "@/components/contacts/contact-import";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { Contact } from "@shared/schema";

export default function Contacts() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  
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
          contacts={contacts || []}
          isLoading={isLoading}
          onEdit={handleEdit}
          onDelete={handleDelete}
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
