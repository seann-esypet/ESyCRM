import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

const profileSchema = z.object({
  workEmail: z.string().email("Please enter a valid email address").optional().or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function Settings() {
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<{
    id: string;
    email: string;
    workEmail?: string;
    firstName?: string;
    lastName?: string;
    role: string;
  }>({
    queryKey: ["/api/auth/user"],
  });

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      workEmail: "",
    },
  });

  // Update form when user data loads
  useEffect(() => {
    if (user) {
      form.reset({
        workEmail: user.workEmail || "",
      });
    }
  }, [user, form]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      return apiRequest("PATCH", "/api/user/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Profile updated",
        description: "Your work email has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground" data-testid="text-settings-subtitle">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-account-info">
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your Replit account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Email</label>
              <p className="text-sm text-muted-foreground" data-testid="text-account-email">{user?.email}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Name</label>
              <p className="text-sm text-muted-foreground" data-testid="text-account-name">
                {user?.firstName && user?.lastName 
                  ? `${user.firstName} ${user.lastName}` 
                  : user?.firstName || user?.lastName || "Not set"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <p className="text-sm text-muted-foreground capitalize" data-testid="text-account-role">{user?.role}</p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-email-settings">
          <CardHeader>
            <CardTitle>Email Settings</CardTitle>
            <CardDescription>
              Configure your professional email address for sending email sequences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="workEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work Email Address</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="john@esypet.com" 
                          {...field} 
                          data-testid="input-work-email"
                        />
                      </FormControl>
                      <FormDescription>
                        This email will be used as the sender address for your email sequences. 
                        Make sure this email is configured to receive replies (e.g., john@esypet.com).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  disabled={updateProfileMutation.isPending || !form.formState.isDirty}
                  data-testid="button-save-settings"
                >
                  {updateProfileMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
