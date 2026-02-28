import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FlaskConical, Send, CheckCircle2, XCircle, Clock, Loader2, Mail, AlertTriangle, Wifi } from "lucide-react";

const testSchema = z.object({
  contactId: z.string().min(1, "Please select a contact"),
  track: z.enum(["no_software", "uses_competitor"]),
  toEmail: z.string().email("Please enter a valid email address"),
});

type TestFormData = z.infer<typeof testSchema>;

interface TestStep {
  sequenceNumber: number;
  status: "pending" | "waiting" | "sending" | "sent" | "failed";
  scheduledAt?: string;
  sentAt?: string;
  error?: string;
}

interface TestRun {
  id: string;
  contactName: string;
  track: string;
  toEmail: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  steps: TestStep[];
}

const WAIT_LABELS: Record<number, string> = {
  1: "Sends immediately",
  2: "7 min after Email 1",
  3: "7 min after Email 2",
  4: "30 min after Email 3",
  5: "30 min after Email 4",
};

function StepStatusIcon({ status }: { status: TestStep["status"] }) {
  if (status === "sent") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (status === "failed") return <XCircle className="h-5 w-5 text-destructive" />;
  if (status === "sending") return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
  if (status === "waiting") return <Clock className="h-5 w-5 text-amber-500" />;
  return <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />;
}

function StepStatusBadge({ status }: { status: TestStep["status"] }) {
  if (status === "sent") return <Badge className="bg-green-100 text-green-700 border-green-200">Sent</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (status === "sending") return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Sending…</Badge>;
  if (status === "waiting") return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Waiting</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
}

export default function AdminSequenceTest() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const { data: contacts = [], isLoading: isLoadingContacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const form = useForm<TestFormData>({
    resolver: zodResolver(testSchema),
    defaultValues: {
      contactId: "",
      track: "no_software",
      toEmail: user?.workEmail || user?.email || "",
    },
  });

  const selectedContactId = form.watch("contactId");
  const selectedContact = contacts.find(c => c.id === selectedContactId);

  // Auto-set track based on selected contact
  useEffect(() => {
    if (selectedContact) {
      form.setValue("track", selectedContact.usesSoftware === "Yes" ? "uses_competitor" : "no_software");
    }
  }, [selectedContact, form]);

  // Poll for test run status
  useEffect(() => {
    if (!activeRunId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/sequence-test/${activeRunId}`, { credentials: "include" });
        if (!res.ok) return;
        const data: TestRun = await res.json();
        setTestRun(data);

        if (data.status === "completed" || data.status === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          toast({
            title: data.status === "completed" ? "Test complete!" : "Test failed",
            description: data.status === "completed"
              ? `${data.steps.filter(s => s.status === "sent").length}/5 emails sent. Check your inbox for the summary.`
              : "The test encountered an error.",
            variant: data.status === "completed" ? "default" : "destructive",
          });
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    pollingRef.current = setInterval(poll, 10000); // poll every 10 seconds
    poll(); // immediate first check

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeRunId, toast]);

  const pingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/sendgrid-ping", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Connection successful!", description: data.message });
    },
    onError: async (error: any) => {
      let message = "Could not connect to SendGrid";
      try { const body = await error.json?.(); message = body?.message || message; } catch {}
      toast({ title: "Connection failed", description: message, variant: "destructive" });
    },
  });

  const startMutation = useMutation({
    mutationFn: async (data: TestFormData) => {
      const res = await apiRequest("POST", "/api/admin/sequence-test/start", data);
      return res.json();
    },
    onSuccess: (run: TestRun) => {
      setActiveRunId(run.id);
      setTestRun(run);
      toast({
        title: "Test started",
        description: `Testing ${run.track === "no_software" ? "No Software" : "Uses Competitor"} track. Emails will arrive over the next ~74 minutes.`,
      });
    },
    onError: async (error: any) => {
      let message = "Failed to start test";
      try {
        const body = await error.json?.();
        message = body?.message || message;
      } catch {}
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const onSubmit = (data: TestFormData) => {
    startMutation.mutate(data);
  };

  const handleReset = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setActiveRunId(null);
    setTestRun(null);
    form.reset({ contactId: "", track: "no_software", toEmail: user?.workEmail || user?.email || "" });
  };

  const sentCount = testRun?.steps.filter(s => s.status === "sent").length ?? 0;
  const failedCount = testRun?.steps.filter(s => s.status === "failed").length ?? 0;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FlaskConical className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Sequence Test Lab</h1>
              <p className="text-sm text-muted-foreground">Admin only — verify your email sequences are working</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pingMutation.mutate()}
            disabled={pingMutation.isPending}
            data-testid="button-sendgrid-ping"
            className="flex-shrink-0"
          >
            {pingMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
              : <><Wifi className="h-4 w-4 mr-2" /> Test Connection</>}
          </Button>
        </div>

        {/* Info banner */}
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-3">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                <p className="font-semibold">Test mode uses minutes instead of days</p>
                <p>Email 1 → now &nbsp;|&nbsp; Email 2 → +7 min &nbsp;|&nbsp; Email 3 → +7 min &nbsp;|&nbsp; Email 4 → +30 min &nbsp;|&nbsp; Email 5 → +30 min</p>
                <p className="text-amber-700 dark:text-amber-300">Total test duration: ~74 minutes. A results summary is emailed to you when done.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Form — hidden while a test is running */}
        {!testRun && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configure Test</CardTitle>
              <CardDescription>Choose a contact and the email address to receive the test emails</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="contactId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact (used for template variables)</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-test-contact">
                              <SelectValue placeholder={isLoadingContacts ? "Loading…" : "Select a contact"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {contacts.map(c => (
                              <SelectItem key={c.id} value={c.id} data-testid={`contact-option-${c.id}`}>
                                {c.firstName} {c.lastName} {c.company ? `— ${c.company}` : ""}
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
                    name="track"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sequence Track</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-test-track">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="no_software">No Software</SelectItem>
                            <SelectItem value="uses_competitor">Uses Competitor</SelectItem>
                          </SelectContent>
                        </Select>
                        {selectedContact && (
                          <div className="text-xs text-muted-foreground space-y-0.5 bg-muted/40 rounded p-2 border">
                            <p><span className="font-medium">Email:</span> {selectedContact.email || "—"}</p>
                            <p><span className="font-medium">Company:</span> {selectedContact.company || <span className="italic text-orange-500">No company set — [Business_Name] will show as "your business"</span>}</p>
                            <p><span className="font-medium">City:</span> {selectedContact.city || <span className="italic">(none)</span>}</p>
                            <p className="pt-1 text-muted-foreground">Track auto-detected from contact's "Uses Software" field</p>
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="toEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Send test emails to</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="your@email.com"
                            type="email"
                            data-testid="input-test-email"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          All 5 test emails will be sent to this address (not the contact)
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={startMutation.isPending}
                    data-testid="button-start-test"
                  >
                    {startMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
                    ) : (
                      <><FlaskConical className="h-4 w-4 mr-2" /> Start Sequence Test</>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* Test Run Progress */}
        {testRun && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {testRun.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {testRun.status === "completed" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {testRun.status === "failed" && <XCircle className="h-4 w-4 text-destructive" />}
                    Test {testRun.status === "running" ? "In Progress" : testRun.status === "completed" ? "Complete" : "Failed"}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Contact: <span className="font-medium">{testRun.contactName}</span>
                    &nbsp;·&nbsp;Track: <span className="font-medium">{testRun.track === "no_software" ? "No Software" : "Uses Competitor"}</span>
                    &nbsp;·&nbsp;To: <span className="font-medium">{testRun.toEmail}</span>
                  </CardDescription>
                </div>
                {(testRun.status === "completed" || testRun.status === "failed") && (
                  <Button variant="outline" size="sm" onClick={handleReset} data-testid="button-new-test">
                    New Test
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {testRun.status === "completed" && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 mb-4">
                  <Mail className="h-5 w-5 text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <span className="font-semibold">{sentCount}/5 emails sent.</span> A results summary has been sent to your admin email.
                  </p>
                </div>
              )}

              <Separator />

              {testRun.steps.map((step) => (
                <div key={step.sequenceNumber} className="flex items-start gap-4 py-3" data-testid={`step-${step.sequenceNumber}`}>
                  <StepStatusIcon status={step.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">Email {step.sequenceNumber}</span>
                      <StepStatusBadge status={step.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{WAIT_LABELS[step.sequenceNumber]}</p>
                    {step.status === "waiting" && step.scheduledAt && (
                      <p className="text-xs text-amber-600 mt-1">
                        Scheduled for {new Date(step.scheduledAt).toLocaleTimeString()}
                      </p>
                    )}
                    {step.status === "sent" && step.sentAt && (
                      <p className="text-xs text-green-600 mt-1">
                        Sent at {new Date(step.sentAt).toLocaleTimeString()}
                      </p>
                    )}
                    {step.status === "failed" && step.error && (
                      <p className="text-xs text-destructive mt-1">{step.error}</p>
                    )}
                  </div>
                </div>
              ))}

              {testRun.status === "running" && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Page updates every 10 seconds automatically
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
