import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { insertContactSchema, type Contact, type InsertContact } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { DuplicateResolutionDialog } from "./duplicate-resolution-dialog";

interface ContactFormProps {
  contact?: Contact;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ContactForm({ contact, onSuccess, onCancel }: ContactFormProps) {
  const { toast } = useToast();
  const [duplicates, setDuplicates] = useState<Contact[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingContactData, setPendingContactData] = useState<InsertContact | null>(null);
  
  const form = useForm<InsertContact>({
    resolver: zodResolver(insertContactSchema),
    defaultValues: {
      firstName: contact?.firstName || "",
      lastName: contact?.lastName || "",
      email: contact?.email || "",
      phone: contact?.phone || "",
      company: contact?.company || "",
      jobTitle: contact?.jobTitle || "",
      notes: contact?.notes || "",
      status: contact?.status || "active",
    },
  });

  const checkDuplicatesMutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      const response = await apiRequest("POST", "/api/contacts/check-duplicates", { 
        contact: data,
        excludeId: contact?.id
      });
      const result: any = await response.json();
      return result.duplicates as Contact[];
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      if (contact) {
        return apiRequest("PUT", `/api/contacts/${contact.id}`, data);
      } else {
        return apiRequest("POST", "/api/contacts", data);
      }
    },
    onSuccess: () => {
      toast({
        title: contact ? "Contact updated" : "Contact created",
        description: `${form.getValues("firstName")} ${form.getValues("lastName")} has been ${contact ? "updated" : "added"} successfully.`,
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${contact ? "update" : "create"} contact`,
        variant: "destructive",
      });
    },
  });

  const createContact = (data: InsertContact) => {
    mutation.mutate(data);
  };

  const onSubmit = async (data: InsertContact) => {
    if (contact) {
      mutation.mutate(data);
      return;
    }

    try {
      const foundDuplicates = await checkDuplicatesMutation.mutateAsync(data);
      
      if (foundDuplicates && foundDuplicates.length > 0) {
        setDuplicates(foundDuplicates);
        setPendingContactData(data);
        setShowDuplicateDialog(true);
      } else {
        createContact(data);
      }
    } catch (error) {
      console.error("Error checking duplicates:", error);
      toast({
        title: "Error checking duplicates",
        description: "Could not check for duplicates. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddAnyway = () => {
    if (pendingContactData) {
      createContact(pendingContactData);
      setPendingContactData(null);
    }
  };

  const handleOverride = async (contactId: string) => {
    if (pendingContactData) {
      const response = await apiRequest("PUT", `/api/contacts/${contactId}`, pendingContactData);
      toast({
        title: "Contact updated",
        description: `${pendingContactData.firstName} ${pendingContactData.lastName} has been updated successfully.`,
      });
      setPendingContactData(null);
      onSuccess();
    }
  };

  const handleCancel = () => {
    setPendingContactData(null);
    setDuplicates([]);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="contact-form">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="John"
                    data-testid="input-firstName"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="Smith"
                    data-testid="input-lastName"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="email"
                    placeholder="john@company.com"
                    data-testid="input-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    placeholder="+1 (555) 123-4567"
                    data-testid="input-phone"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="company"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    placeholder="Acme Corp"
                    data-testid="input-company"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="jobTitle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Job Title</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    placeholder="Software Engineer"
                    data-testid="input-jobTitle"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  value={field.value || ""}
                  placeholder="Additional notes about this contact..."
                  className="min-h-[100px]"
                  data-testid="textarea-notes"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-3">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={mutation.isPending || checkDuplicatesMutation.isPending}
            data-testid="button-submit"
          >
            {mutation.isPending || checkDuplicatesMutation.isPending ? "Saving..." : contact ? "Update Contact" : "Create Contact"}
          </Button>
        </div>
      </form>

      {pendingContactData && (
        <DuplicateResolutionDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          duplicates={duplicates}
          newContact={pendingContactData}
          onAddAnyway={handleAddAnyway}
          onOverride={handleOverride}
          onCancel={handleCancel}
        />
      )}
    </Form>
  );
}
