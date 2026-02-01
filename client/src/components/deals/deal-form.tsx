import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { insertDealSchema, type Deal, type InsertDeal, type Contact } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DealFormProps {
  deal?: Deal;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function DealForm({ deal, onSuccess, onCancel }: DealFormProps) {
  const { toast } = useToast();
  
  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const form = useForm<InsertDeal>({
    resolver: zodResolver(insertDealSchema),
    defaultValues: {
      title: deal?.title || "",
      contactId: deal?.contactId || "",
      value: deal?.value || "",
      plan: deal?.plan || "",
      stage: deal?.stage || "new_lead_unqualified",
      probability: deal?.probability || 0,
      expectedCloseDate: deal?.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().split('T')[0] : "",
      demoScheduledDate: deal?.demoScheduledDate ? new Date(deal.demoScheduledDate).toISOString().slice(0, 16) : "",
      demoCompletedDate: deal?.demoCompletedDate ? new Date(deal.demoCompletedDate).toISOString().split('T')[0] : "",
      wonDate: deal?.wonDate ? new Date(deal.wonDate).toISOString().split('T')[0] : "",
      description: deal?.description || "",
    },
  });

  const selectedStage = form.watch("stage");
  const previousStageRef = useRef(selectedStage);

  // Clear conditional date fields only when stage actually changes during this edit session
  useEffect(() => {
    const previousStage = previousStageRef.current;
    
    // Only clear if stage changed from the triggering stage to a different stage
    if (previousStage === "demo_scheduled" && selectedStage !== "demo_scheduled") {
      form.setValue("demoScheduledDate", "");
    }
    if (previousStage === "demo_completed" && selectedStage !== "demo_completed") {
      form.setValue("demoCompletedDate", "");
    }
    if (previousStage === "won" && selectedStage !== "won") {
      form.setValue("wonDate", "");
    }
    
    // Update the ref for next comparison
    previousStageRef.current = selectedStage;
  }, [selectedStage, form]);

  const mutation = useMutation({
    mutationFn: async (data: InsertDeal) => {
      // Convert date fields to proper format
      const formData = {
        ...data,
        expectedCloseDate: data.expectedCloseDate && data.expectedCloseDate.trim() ? new Date(data.expectedCloseDate).toISOString() : null,
        demoScheduledDate: data.demoScheduledDate && data.demoScheduledDate.trim() ? new Date(data.demoScheduledDate).toISOString() : null,
        demoCompletedDate: data.demoCompletedDate && data.demoCompletedDate.trim() ? new Date(data.demoCompletedDate).toISOString() : null,
        wonDate: data.wonDate && data.wonDate.trim() ? new Date(data.wonDate).toISOString() : null,
      };

      if (deal) {
        return apiRequest("PUT", `/api/deals/${deal.id}`, formData);
      } else {
        return apiRequest("POST", "/api/deals", formData);
      }
    },
    onSuccess: async () => {
      // When creating a new deal with a contact, change contact status to "pipeline"
      const contactId = form.getValues("contactId");
      if (!deal && contactId) {
        try {
          await apiRequest("PATCH", `/api/contacts/${contactId}`, { status: "pipeline" });
          // Refresh contacts list to show updated status
          queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
        } catch (e) {
          // Silently ignore - deal creation succeeded
        }
      }
      
      toast({
        title: deal ? "Deal updated" : "Deal created",
        description: `${form.getValues("title")} has been ${deal ? "updated" : "added"} successfully.`,
      });
      onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${deal ? "update" : "create"} deal`,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertDeal) => {
    mutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="deal-form">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Deal Title</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="Acme Corp Website Redesign"
                  data-testid="input-title"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="contactId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                  <FormControl>
                    <SelectTrigger data-testid="select-contact">
                      <SelectValue placeholder="Select a contact" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {contacts?.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.firstName} {contact.lastName} - {contact.company || "No company"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="plan"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deal Plan</FormLabel>
                <Select 
                  onValueChange={(value) => {
                    field.onChange(value);
                    // Set numeric value based on plan
                    if (value.includes("Plan 1")) {
                      form.setValue("value", "2");
                    } else if (value.includes("Plan 2")) {
                      form.setValue("value", "99");
                    } else if (value.includes("Plan 3")) {
                      form.setValue("value", "99");
                    }
                  }} 
                  defaultValue={field.value || ""}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-plan">
                      <SelectValue placeholder="Select a plan" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Plan 1 - $2/appoint">Plan 1 - $2/appoint</SelectItem>
                    <SelectItem value="Plan 2 - $99/mo">Plan 2 - $99/mo</SelectItem>
                    <SelectItem value="Plan 3. $99 + Credit Card">Plan 3. $99 + Credit Card</SelectItem>
                    <SelectItem value="Unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pipeline Stage</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-stage">
                      <SelectValue placeholder="Select stage" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="new_lead_unqualified">New Lead Unqualified</SelectItem>
                    <SelectItem value="qualified_lead">Qualified Lead</SelectItem>
                    <SelectItem value="contacted_left_message">Contacted (Left Message)</SelectItem>
                    <SelectItem value="contacted_spoke_to_decision_maker">Contacted (Spoke to Owner/Decision Maker)</SelectItem>
                    <SelectItem value="onboarded_form_completed">Onboarded Form Completed</SelectItem>
                    <SelectItem value="demo_scheduled">Demo Scheduled</SelectItem>
                    <SelectItem value="demo_completed">Demo Completed</SelectItem>
                    <SelectItem value="decision_pending">Decision Pending</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="probability"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Probability (%)</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value?.toString() || ""}
                    type="number"
                    min="0"
                    max="100"
                    placeholder="75"
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    data-testid="input-probability"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="expectedCloseDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expected Close Date</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  value={field.value || ""}
                  type="date"
                  data-testid="input-expectedCloseDate"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {selectedStage === "demo_scheduled" && (
          <FormField
            control={form.control}
            name="demoScheduledDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Demo Scheduled Date & Time</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="datetime-local"
                    data-testid="input-demoScheduledDate"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {selectedStage === "demo_completed" && (
          <FormField
            control={form.control}
            name="demoCompletedDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Demo Completed Date</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="date"
                    data-testid="input-demoCompletedDate"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {selectedStage === "won" && (
          <FormField
            control={form.control}
            name="wonDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Won Date</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="date"
                    data-testid="input-wonDate"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  value={field.value || ""}
                  placeholder="Additional details about this deal..."
                  className="min-h-[100px]"
                  data-testid="textarea-description"
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
            disabled={mutation.isPending}
            data-testid="button-submit"
          >
            {mutation.isPending ? "Saving..." : deal ? "Update Deal" : "Create Deal"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
