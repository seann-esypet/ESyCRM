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
      phoneCell: contact?.phoneCell || "",
      phoneWork: contact?.phoneWork || "",
      phoneOther: contact?.phoneOther || "",
      company: contact?.company || "",
      jobTitle: contact?.jobTitle || "",
      websiteUrl: contact?.websiteUrl || "",
      facebookUrl: contact?.facebookUrl || "",
      instagramHandle: contact?.instagramHandle || "",
      secondaryFirstName: contact?.secondaryFirstName || "",
      secondaryLastName: contact?.secondaryLastName || "",
      leadSource: contact?.leadSource || "",
      currentSoftware: contact?.currentSoftware || "",
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
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Primary Contact</h3>
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
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Phone Numbers</h3>
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="phoneCell"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cell</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="(555) 123-4567"
                      data-testid="input-phoneCell"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="phoneWork"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="(555) 987-6543"
                      data-testid="input-phoneWork"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="phoneOther"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Other</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="(555) 111-2222"
                      data-testid="input-phoneOther"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Company Information</h3>
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
            name="currentSoftware"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current Software Used</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    placeholder="e.g., Salesforce, HubSpot, Custom CRM"
                    data-testid="input-currentSoftware"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Social Media & Web</h3>
          <div className="grid grid-cols-1 gap-4">
            <FormField
              control={form.control}
              name="websiteUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website Address</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="https://www.example.com"
                      data-testid="input-websiteUrl"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="facebookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Facebook Page URL</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        value={field.value || ""}
                        placeholder="https://facebook.com/..."
                        data-testid="input-facebookUrl"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="instagramHandle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instagram Handle</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        value={field.value || ""}
                        placeholder="@username"
                        data-testid="input-instagramHandle"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground">Secondary Contact Person</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="secondaryFirstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="Jane"
                      data-testid="input-secondaryFirstName"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="secondaryLastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      value={field.value || ""}
                      placeholder="Doe"
                      data-testid="input-secondaryLastName"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="leadSource"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead Source</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                    <FormControl>
                      <SelectTrigger data-testid="select-leadSource">
                        <SelectValue placeholder="Select lead source" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Inbound">Inbound</SelectItem>
                      <SelectItem value="Outbound">Outbound</SelectItem>
                      <SelectItem value="Cold Call">Cold Call</SelectItem>
                      <SelectItem value="Facebook Ad">Facebook Ad</SelectItem>
                      <SelectItem value="Referral">Referral</SelectItem>
                      <SelectItem value="Event">Event</SelectItem>
                      <SelectItem value="EsyPet Website Form">EsyPet Website Form</SelectItem>
                      <SelectItem value="Google Search">Google Search</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

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
          </div>

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
        </div>

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
