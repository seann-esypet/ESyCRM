import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { insertEmailSequenceSchema, type EmailSequence } from "@shared/schema";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

interface EmailSequenceFormProps {
  sequence?: Partial<EmailSequence>;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function EmailSequenceForm({ sequence, onSuccess, onCancel }: EmailSequenceFormProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isEdit = !!sequence?.id;
  const sequenceNumber = sequence?.sequenceNumber || 1;

  // Generate time options (00:00 to 23:00 in 1-hour increments)
  const timeOptions = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return `${hour}:00`;
  });

  // Generate days options (1-30 days)
  const daysOptions = Array.from({ length: 30 }, (_, i) => i + 1);

  const form = useForm({
    resolver: zodResolver(insertEmailSequenceSchema),
    defaultValues: {
      sequenceNumber: sequence?.sequenceNumber || 1,
      subject: sequence?.subject || "",
      body: sequence?.body || `Hi [Contact_First_Name],\n\n\n\nBest regards,\n[Sales_Person]`,
      scheduledDate: sequence?.scheduledDate ? new Date(sequence.scheduledDate).toISOString().split('T')[0] : "",
      scheduledTime: sequence?.scheduledTime || "09:00",
      daysAfterNoReply: sequence?.daysAfterNoReply || (sequenceNumber > 1 ? 3 : null),
      isActive: sequence?.isActive || "true",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertEmailSequenceSchema>) => {
      return await apiRequest("POST", "/api/email-sequences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequences"] });
      toast({
        title: "Success",
        description: "Email sequence created successfully",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create email sequence",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<z.infer<typeof insertEmailSequenceSchema>>) => {
      return await apiRequest("PATCH", `/api/email-sequences/${sequence?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequences"] });
      toast({
        title: "Success",
        description: "Email sequence updated successfully",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update email sequence",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof insertEmailSequenceSchema>) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="form-email-sequence">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Email Subject</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="Enter email subject"
                    data-testid="input-subject"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="body"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Email Body</FormLabel>
                <FormControl>
                  <Textarea 
                    {...field} 
                    rows={12}
                    placeholder="Write your email content here..."
                    data-testid="input-body"
                    className="font-mono text-sm"
                  />
                </FormControl>
                <FormDescription>
                  Use [Contact_First_Name] and [Sales_Person] as placeholders. They will be replaced automatically.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {sequenceNumber === 1 ? (
            <>
              <FormField
                control={form.control}
                name="scheduledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="date"
                        data-testid="input-scheduled-date"
                      />
                    </FormControl>
                    <FormDescription>
                      When to send this email
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scheduledTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Time</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || "09:00"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-scheduled-time">
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {timeOptions.map(time => (
                          <SelectItem key={time} value={time}>{time}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Time to send (24-hour format)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : (
            <FormField
              control={form.control}
              name="daysAfterNoReply"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Days After No Reply</FormLabel>
                  <Select 
                    onValueChange={(value) => field.onChange(parseInt(value))} 
                    defaultValue={field.value?.toString() || "3"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-days-after-no-reply">
                        <SelectValue placeholder="Select number of days" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {daysOptions.map(days => (
                        <SelectItem key={days} value={days.toString()}>
                          {days} {days === 1 ? 'day' : 'days'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Send this email {sequenceNumber - 1 > 0 ? `after no reply to Sequence ${sequenceNumber - 1}` : ''}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || "true"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-is-active">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Only active sequences will be sent automatically
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            data-testid="button-submit"
          >
            {isPending ? "Saving..." : isEdit ? "Update Sequence" : "Create Sequence"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
