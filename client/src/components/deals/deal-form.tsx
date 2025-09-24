import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { insertDealSchema, type Deal, type InsertDeal, type Contact } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

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
      stage: deal?.stage || "lead",
      probability: deal?.probability || 0,
      expectedCloseDate: deal?.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().split('T')[0] : "",
      description: deal?.description || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertDeal) => {
      // Convert expectedCloseDate to proper format
      const formData = {
        ...data,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate).toISOString() : null,
      };

      if (deal) {
        return apiRequest("PUT", `/api/deals/${deal.id}`, formData);
      } else {
        return apiRequest("POST", "/api/deals", formData);
      }
    },
    onSuccess: () => {
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
            name="value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deal Value</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="number"
                    step="0.01"
                    placeholder="25000.00"
                    data-testid="input-value"
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
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stage</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-stage">
                      <SelectValue placeholder="Select stage" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="negotiation">Negotiation</SelectItem>
                    <SelectItem value="closed_won">Closed Won</SelectItem>
                    <SelectItem value="closed_lost">Closed Lost</SelectItem>
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
