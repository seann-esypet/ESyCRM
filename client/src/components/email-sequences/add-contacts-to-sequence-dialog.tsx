import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Mail, Users } from "lucide-react";
import type { EmailSequence, Contact } from "@shared/schema";

interface AddContactsToSequenceDialogProps {
  sequence: EmailSequence;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddContactsToSequenceDialog({
  sequence,
  open,
  onOpenChange,
}: AddContactsToSequenceDialogProps) {
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const { toast } = useToast();

  const { data: allContacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Filter contacts to only show those matching the sequence track
  const contacts = allContacts?.filter(contact => {
    // If contact has a sequenceTrack assigned, it must match the sequence track
    if (contact.sequenceTrack) {
      return contact.sequenceTrack === sequence.sequenceTrack;
    }
    // If contact has no track assigned yet, show in "no_software" by default
    // This allows manually adding contacts before they're marked as qualified
    return sequence.sequenceTrack === "no_software";
  });

  const addContactsMutation = useMutation({
    mutationFn: async (contactIds: string[]) => {
      const response = await apiRequest("POST", "/api/email-sequence-logs/bulk", {
        sequenceId: sequence.id,
        contactIds,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to add contacts" }));
        throw new Error(error.message || "Failed to add contacts");
      }
      return await response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      toast({
        title: "Contacts added to sequence",
        description: `Successfully added ${data.successful || 0} contact(s) to Sequence ${sequence.sequenceNumber}${(data.failed || 0) > 0 ? `. ${data.failed} failed.` : ""}`,
      });
      setSelectedContacts([]);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add contacts",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reset selected contacts when dialog closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedContacts([]);
    }
    onOpenChange(open);
  };

  const handleSubmit = () => {
    if (selectedContacts.length === 0) {
      toast({
        title: "No contacts selected",
        description: "Please select at least one contact to add to the sequence",
        variant: "destructive",
      });
      return;
    }

    addContactsMutation.mutate(selectedContacts);
  };

  const toggleContact = (contactId: string) => {
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const toggleAll = () => {
    if (selectedContacts.length === contacts?.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(contacts?.map(c => c.id) || []);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Mail className="h-5 w-5" />
            <span>Add Contacts to Sequence {sequence.sequenceNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              sequence.sequenceTrack === "uses_competitor" 
                ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" 
                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            }`}>
              {sequence.sequenceTrack === "uses_competitor" ? "Uses Competitor" : "No Software"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Select contacts to add to this email sequence. Only contacts matching this track are shown.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Alert className="mb-4">
            <AlertDescription>
              <strong>Subject:</strong> {sequence.subject}
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="select-all"
                checked={(contacts?.length || 0) > 0 && selectedContacts.length === (contacts?.length || 0)}
                onCheckedChange={toggleAll}
                data-testid="checkbox-select-all"
              />
              <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                Select All ({selectedContacts.length} of {contacts?.length || 0} selected)
              </label>
            </div>
          </div>

          <ScrollArea className="flex-1 border rounded-md">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading contacts...
              </div>
            ) : contacts && contacts.length > 0 ? (
              <div className="divide-y">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center space-x-3 p-4 hover:bg-muted/50 transition-colors"
                    data-testid={`contact-item-${contact.id}`}
                  >
                    <Checkbox
                      id={`contact-${contact.id}`}
                      checked={selectedContacts.includes(contact.id)}
                      onCheckedChange={() => toggleContact(contact.id)}
                      data-testid={`checkbox-contact-${contact.id}`}
                    />
                    <label
                      htmlFor={`contact-${contact.id}`}
                      className="flex-1 cursor-pointer"
                    >
                      <div className="font-medium">{contact.firstName} {contact.lastName}</div>
                      <div className="text-sm text-muted-foreground">{contact.email}</div>
                      {contact.company && (
                        <div className="text-sm text-muted-foreground">{contact.company}</div>
                      )}
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <p>No contacts found for this track.</p>
                <p className="text-sm mt-2">
                  {sequence.sequenceTrack === "uses_competitor" 
                    ? "Contacts are assigned to this track when their deal is marked as 'Qualified Lead' and they use competitor software."
                    : "Contacts are assigned to this track when their deal is marked as 'Qualified Lead' and they don't use software."}
                </p>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex items-center justify-end space-x-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedContacts.length === 0 || addContactsMutation.isPending}
            data-testid="button-add-to-queue"
          >
            <Users className="h-4 w-4 mr-2" />
            {addContactsMutation.isPending
              ? "Adding..."
              : `Add ${selectedContacts.length} to Queue`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
