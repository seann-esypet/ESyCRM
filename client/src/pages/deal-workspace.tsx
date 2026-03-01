import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft, Phone, Mail, Globe, MapPin, Building2, Users, Monitor,
  Pencil, CheckSquare, Square, ChevronDown, ChevronLeft, ChevronRight, PhoneCall, FileText,
  StickyNote, Home, ListTodo, Calendar, DollarSign, TrendingUp, Send,
  AlertCircle, User, ExternalLink, Facebook, Instagram, Link2, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as UiSelect,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from "@/components/ui/select";
import type { Deal, Contact, Task } from "@shared/schema";
import ContactForm from "@/components/contacts/contact-form";

// ─── Stage helpers ────────────────────────────────────────────────────────────
const STAGES: { value: string; label: string; color: string; bg: string }[] = [
  { value: "new_lead_unqualified",              label: "New Lead",         color: "text-gray-700 dark:text-gray-300",   bg: "bg-gray-100 dark:bg-gray-800" },
  { value: "qualified_lead",                   label: "Qualified Lead",   color: "text-blue-700 dark:text-blue-300",   bg: "bg-blue-100 dark:bg-blue-900" },
  { value: "contacted_left_message",           label: "Left Message",     color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-900" },
  { value: "contacted_spoke_to_decision_maker",label: "Spoke to DM",     color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-900" },
  { value: "onboarded_form_completed",         label: "Form Completed",   color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-900" },
  { value: "demo_scheduled",                   label: "Demo Scheduled",   color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-100 dark:bg-indigo-900" },
  { value: "demo_completed",                   label: "Demo Completed",   color: "text-cyan-700 dark:text-cyan-300",   bg: "bg-cyan-100 dark:bg-cyan-900" },
  { value: "decision_pending",                 label: "Decision Pending", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-100 dark:bg-amber-900" },
  { value: "won",                              label: "Won",              color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-900" },
  { value: "lost",                             label: "Lost",             color: "text-red-700 dark:text-red-300",     bg: "bg-red-100 dark:bg-red-900" },
];

function stageInfo(value: string) {
  return STAGES.find(s => s.value === value) ?? STAGES[0];
}

function StagePill({ stage }: { stage: string }) {
  const s = stageInfo(stage);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.color}`}>
      {s.label}
    </span>
  );
}

// ─── Plan helpers ─────────────────────────────────────────────────────────────
const PLAN_COLORS: Record<string, string> = {
  "Plan 1 - $2/appoint": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  "Plan 2 - $99/mo":     "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "Plan 3 - $150/mo + credit card": "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

// ─── Contact info row ─────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, link }: { icon: React.ReactNode; label: string; value?: string | null; link?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 break-all">
            {value} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <p className="text-sm break-words">{value}</p>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Activity type config ─────────────────────────────────────────────────────
type LogType = "call" | "email_note" | "note" | "site_visit";

const ACTIVITY_CONFIG: Record<string, { label: string; Icon: React.ElementType; color: string; bg: string }> = {
  call:         { label: "Call",       Icon: PhoneCall,   color: "text-green-700 dark:text-green-300",   bg: "bg-green-100 dark:bg-green-900" },
  email_note:   { label: "Email Note", Icon: Mail,        color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-100 dark:bg-indigo-900" },
  note:         { label: "Note",       Icon: StickyNote,  color: "text-blue-700 dark:text-blue-300",     bg: "bg-blue-100 dark:bg-blue-900" },
  site_visit:   { label: "Site Visit", Icon: Home,        color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-900" },
  stage_change: { label: "Stage",      Icon: TrendingUp,  color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-900" },
};

const CALL_OUTCOMES = ["Answered", "Left Voicemail", "No Answer", "Busy", "Wrong Number", "Callback Requested"];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DealWorkspace() {
  const [, params] = useRoute("/deal/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const dealId = params?.id ?? "";
  const [activeTab, setActiveTab] = useState("activity");
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Log activity form state
  const [logType, setLogType] = useState<LogType | null>(null);
  const [logNotes, setLogNotes] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [callDuration, setCallDuration] = useState("");
  const [visitDate, setVisitDate] = useState("");

  // Add task form state
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskPriority, setTaskPriority] = useState<"low" | "medium" | "high">("medium");

  function resetLogForm() {
    setLogNotes(""); setCallOutcome(""); setCallDuration(""); setVisitDate("");
  }
  function resetTaskForm() {
    setTaskTitle(""); setTaskDueDate(""); setTaskPriority("medium");
  }

  // Fetch workspace data (deal + contact + tasks + activities)
  const { data, isLoading, error } = useQuery<{ deal: Deal; contact: Contact | null; tasks: Task[]; activities: any[] }>({
    queryKey: ["/api/deal-workspace", dealId],
    queryFn: () => fetch(`/api/deal-workspace/${dealId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!dealId,
  });

  // Email sequence logs for this contact (loaded lazily when tab is active)
  const contactId = data?.contact?.id;
  const { data: emailLogs } = useQuery<any[]>({
    queryKey: ["/api/email-sequence-logs", contactId],
    queryFn: () => fetch(`/api/email-sequence-logs?contactId=${contactId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!contactId && activeTab === "email-history",
  });

  // Move stage mutation
  const stageMutation = useMutation({
    mutationFn: (newStage: string) =>
      apiRequest("PATCH", `/api/deals/${dealId}`, { stage: newStage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Stage updated" });
    },
    onError: () => toast({ title: "Failed to update stage", variant: "destructive" }),
  });

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) =>
      apiRequest("PATCH", `/api/tasks/${taskId}`, { status: completed ? "completed" : "pending" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  // Log activity mutation
  const logActivityMutation = useMutation({
    mutationFn: (payload: { activityType: string; contactId: string; notes?: string; metadata?: string }) =>
      apiRequest("POST", `/api/deal-activities/${dealId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      setLogType(null);
      resetLogForm();
      toast({ title: "Activity logged" });
    },
    onError: () => toast({ title: "Failed to log activity", variant: "destructive" }),
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: (payload: object) => apiRequest("POST", "/api/tasks", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setAddTaskOpen(false);
      resetTaskForm();
      toast({ title: "Task created" });
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  function handleSubmitLog() {
    if (!logType || !data?.contact) return;
    const meta: Record<string, string> = {};
    if (logType === "call") {
      if (callOutcome) meta.callOutcome = callOutcome;
      if (callDuration) meta.callDuration = callDuration;
    }
    if (logType === "site_visit" && visitDate) meta.visitDate = visitDate;
    logActivityMutation.mutate({
      activityType: logType,
      contactId: data.contact.id,
      notes: logNotes || undefined,
      metadata: Object.keys(meta).length ? JSON.stringify(meta) : undefined,
    });
  }

  function handleSubmitTask() {
    if (!taskTitle.trim()) return;
    createTaskMutation.mutate({
      title: taskTitle.trim(),
      dealId,
      contactId: data?.contact?.id ?? null,
      dueDate: taskDueDate || null,
      priority: taskPriority,
      status: "pending",
    });
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading deal workspace…</div>
      </div>
    );
  }

  if (error || !data?.deal) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">Deal not found</p>
        <Button variant="outline" onClick={() => setLocation("/deals")}>Back to Pipeline</Button>
      </div>
    );
  }

  const { deal, contact, tasks } = data;
  const stage = stageInfo(deal.stage);
  const openTasks = tasks.filter(t => t.status === "pending");
  const completedTasks = tasks.filter(t => t.status === "completed");

  const contactInitials = contact
    ? `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase()
    : "?";

  const probabilityColor =
    (deal.probability ?? 0) >= 70 ? "text-green-600 dark:text-green-400" :
    (deal.probability ?? 0) >= 40 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-600 dark:text-red-400";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* ─── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-card">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/deals")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="button-back-pipeline"
        >
          <ArrowLeft className="h-4 w-4" />
          Pipeline
        </Button>

        <Separator orientation="vertical" className="h-5" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-muted-foreground truncate hidden sm:block">
            {stage.label}
          </span>
          <span className="text-muted-foreground hidden sm:block">›</span>
          <span className="text-sm font-medium truncate">
            {deal.title}
            {contact && (
              <span className="text-muted-foreground font-normal"> — {contact.firstName} {contact.lastName}</span>
            )}
          </span>
        </div>

        {/* Stage pill */}
        <StagePill stage={deal.stage} />

        {/* Probability */}
        {deal.probability != null && (
          <span className={`text-sm font-semibold ${probabilityColor} shrink-0`} data-testid="text-probability">
            {deal.probability}%
          </span>
        )}

        {/* Move Stage dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="shrink-0" data-testid="button-move-stage">
              Move Stage <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {STAGES.map(s => (
              <DropdownMenuItem
                key={s.value}
                onClick={() => stageMutation.mutate(s.value)}
                disabled={s.value === deal.stage || stageMutation.isPending}
                className={s.value === deal.stage ? "opacity-50 cursor-default" : ""}
                data-testid={`menu-stage-${s.value}`}
              >
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${s.bg.replace("bg-", "bg-")}`} />
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ─── 3-Panel body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Contact Info ──────────────────────────────────────────────── */}
        <div className={`shrink-0 border-r flex flex-col bg-card transition-all duration-200 ${leftCollapsed ? "w-10 overflow-hidden" : "w-72 overflow-y-auto"}`}>
          {/* Collapse / expand toggle bar */}
          <div className={`shrink-0 flex items-center border-b ${leftCollapsed ? "justify-center py-2" : "justify-end px-2 py-1.5"}`}>
            {leftCollapsed ? (
              <button
                onClick={() => setLeftCollapsed(false)}
                className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Expand contact panel"
                data-testid="button-expand-left"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => setLeftCollapsed(true)}
                className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Collapse contact panel"
                data-testid="button-collapse-left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="p-4 flex-1" style={{ display: leftCollapsed ? "none" : undefined }}>
            {contact ? (
              <>
                {/* Avatar + Name */}
                <div className="flex flex-col items-center text-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center text-white text-xl font-bold mb-2">
                    {contactInitials}
                  </div>
                  <h2 className="text-base font-semibold leading-tight" data-testid="text-contact-name">
                    {contact.firstName} {contact.lastName}
                  </h2>
                  {contact.company && (
                    <p className="text-sm text-muted-foreground" data-testid="text-contact-company">{contact.company}</p>
                  )}
                  {/* Uses Software badge */}
                  {contact.usesSoftware === "Yes" && (
                    <Badge className="mt-1.5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">
                      Uses Software
                    </Badge>
                  )}
                  {contact.usesSoftware === "No" && (
                    <Badge className="mt-1.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                      No Software
                    </Badge>
                  )}
                  {contact.usesSoftware === "Unknown" && (
                    <Badge className="mt-1.5 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 text-xs">
                      Software Unknown
                    </Badge>
                  )}
                  {/* Interest Level */}
                  {contact.interestLevel && (
                    <Badge className={`mt-1 text-xs ${
                      contact.interestLevel === "High"   ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                      contact.interestLevel === "Medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}>
                      {contact.interestLevel} Interest
                    </Badge>
                  )}
                </div>

                {/* Primary Contact */}
                <SectionHeader>Primary Contact</SectionHeader>
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Cell Phone" value={contact.phoneCell ?? contact.phone} link={(contact.phoneCell ?? contact.phone) ? `tel:${contact.phoneCell ?? contact.phone}` : undefined} />
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Work Phone" value={contact.phoneWork} link={contact.phoneWork ? `tel:${contact.phoneWork}` : undefined} />
                <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contact.email} link={contact.email ? `mailto:${contact.email}` : undefined} />
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Job Title" value={contact.jobTitle} />

                {/* Location */}
                <SectionHeader>Location</SectionHeader>
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={contact.address} />
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="City" value={contact.city} />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="# of Locations" value={contact.numberOfLocations?.toString()} />
                <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="# of Employees" value={contact.numberOfEmployees?.toString()} />

                {/* Software Info */}
                <SectionHeader>Software</SectionHeader>
                <div className="py-1.5">
                  <p className="text-xs text-muted-foreground mb-1">Uses Software</p>
                  <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                    contact.usesSoftware === "Yes"     ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                    contact.usesSoftware === "No"      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  }`}>
                    {contact.usesSoftware ?? "Unknown"}
                  </span>
                </div>
                <InfoRow icon={<Monitor className="h-3.5 w-3.5" />} label="Current Software" value={contact.currentSoftware} />
                <InfoRow icon={<Link2 className="h-3.5 w-3.5" />} label="Booking URL" value={contact.bookingSoftwareUrl} link={contact.bookingSoftwareUrl ?? undefined} />

                {/* Digital Presence */}
                <SectionHeader>Digital Presence</SectionHeader>
                <InfoRow icon={<Globe className="h-3.5 w-3.5" />} label="Website" value={contact.websiteUrl} link={contact.websiteUrl ?? undefined} />
                <InfoRow icon={<Link2 className="h-3.5 w-3.5" />} label="Contact Form URL" value={contact.contactRequestFormUrl} link={contact.contactRequestFormUrl ?? undefined} />
                <InfoRow icon={<Facebook className="h-3.5 w-3.5" />} label="Facebook" value={contact.facebookUrl} link={contact.facebookUrl ?? undefined} />
                <InfoRow icon={<Instagram className="h-3.5 w-3.5" />} label="Instagram" value={contact.instagramHandle} />

                {/* Secondary Contact */}
                {(contact.secondaryFirstName || contact.secondaryLastName) && (
                  <>
                    <SectionHeader>Secondary Contact</SectionHeader>
                    <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Name" value={[contact.secondaryFirstName, contact.secondaryLastName].filter(Boolean).join(" ")} />
                  </>
                )}

                {/* Pain Points */}
                {contact.painPoints && (
                  <>
                    <SectionHeader>Pain Points</SectionHeader>
                    <p className="text-sm text-foreground py-1 whitespace-pre-line">{contact.painPoints}</p>
                  </>
                )}

                {/* Notes */}
                {contact.notes && (
                  <>
                    <SectionHeader>Notes</SectionHeader>
                    <p className="text-sm text-foreground py-1 whitespace-pre-line">{contact.notes}</p>
                  </>
                )}

                {/* Lead Info */}
                <SectionHeader>Lead Info</SectionHeader>
                <InfoRow icon={<TrendingUp className="h-3.5 w-3.5" />} label="Lead Source" value={contact.leadSource} />
                <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label="Status" value={contact.status} />
                {contact.lastContactDate && (
                  <div className="flex items-start gap-2 py-1.5">
                    <span className="text-muted-foreground mt-0.5 shrink-0"><Calendar className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Last Contact</p>
                      <p className="text-sm">{format(new Date(contact.lastContactDate), "MMM d, yyyy")}</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <User className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No contact linked to this deal</p>
              </div>
            )}
          </div>

          {/* Edit Contact button */}
          {contact && !leftCollapsed && (
            <div className="p-4 border-t shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setEditContactOpen(true)}
                data-testid="button-edit-contact"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit Contact
              </Button>
            </div>
          )}
        </div>

        {/* ── CENTER: Activity Feed ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
            <div className="shrink-0 border-b px-4 pt-3">
              <TabsList className="h-8">
                <TabsTrigger value="activity" className="text-xs" data-testid="tab-activity">Activity Feed</TabsTrigger>
                <TabsTrigger value="email-history" className="text-xs" data-testid="tab-email-history">Email History</TabsTrigger>
                <TabsTrigger value="sequences" className="text-xs" data-testid="tab-sequences">Sequences</TabsTrigger>
                <TabsTrigger value="notes" className="text-xs" data-testid="tab-notes">Notes</TabsTrigger>
              </TabsList>
            </div>

            {/* Feed area */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Activity Feed ───────────────────────────────────────── */}
              <TabsContent value="activity" className="m-0 p-4 min-h-full">
                {data?.activities && data.activities.length > 0 ? (
                  <div className="space-y-3">
                    {data.activities.map((act: any) => {
                      const cfg = ACTIVITY_CONFIG[act.activityType] ?? ACTIVITY_CONFIG.note;
                      let meta: Record<string, string> = {};
                      try { if (act.metadata) meta = JSON.parse(act.metadata); } catch {}
                      return (
                        <div key={act.id} className="flex gap-3" data-testid={`activity-${act.id}`}>
                          <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${cfg.bg} ${cfg.color}`}>
                            <cfg.Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                              {meta.callOutcome && (
                                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{meta.callOutcome}</span>
                              )}
                              {meta.callDuration && (
                                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />{meta.callDuration}
                                </span>
                              )}
                              {meta.visitDate && (
                                <span className="text-xs text-muted-foreground">on {format(new Date(meta.visitDate), "MMM d, yyyy")}</span>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatDistanceToNow(new Date(act.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            {act.notes && (
                              <p className="text-sm text-foreground whitespace-pre-wrap">{act.notes}</p>
                            )}
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              {act.createdBy === (user as any)?.id ? "You" : "Teammate"} · {format(new Date(act.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <PhoneCall className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">No activities logged yet</p>
                    <p className="text-xs text-muted-foreground/60 max-w-xs">
                      Log your first call, email note, or site visit using the buttons below.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* ── Email History ───────────────────────────────────────── */}
              <TabsContent value="email-history" className="m-0 p-4 min-h-full">
                {emailLogs && emailLogs.length > 0 ? (
                  <div className="space-y-2">
                    {emailLogs.map((log: any) => {
                      const statusColor =
                        log.status === "sent"    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        log.status === "replied" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                        log.status === "failed"  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                        "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
                      const trackLabel = log.sequenceTrack === "uses_competitor" ? "Competitor Track" : "No Software Track";
                      return (
                        <div key={log.id} className="flex items-start gap-3 p-3 rounded-md border bg-card" data-testid={`email-log-${log.id}`}>
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center shrink-0 mt-0.5">
                            <Send className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <span className="text-xs font-semibold">Sequence #{log.sequenceNumber}</span>
                              <span className="text-xs text-muted-foreground">{trackLabel}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ml-auto ${statusColor}`}>
                                {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {log.sentAt
                                ? `Sent ${format(new Date(log.sentAt), "MMM d, yyyy 'at' h:mm a")}`
                                : log.scheduledSendAt
                                ? `Scheduled ${format(new Date(log.scheduledSendAt), "MMM d, yyyy 'at' h:mm a")}`
                                : "Pending"}
                            </p>
                            {log.emailResponseReceived === "true" && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 font-medium">Reply received</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Mail className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">No emails sent yet</p>
                    <p className="text-xs text-muted-foreground/60 max-w-xs">
                      Email sequence history for this contact will appear here once sequences are started.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="sequences" className="m-0 p-4 min-h-full">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">Sequence management</p>
                  <p className="text-xs text-muted-foreground/60 max-w-xs">
                    Manage this contact's email sequences from the Pipeline page.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="m-0 p-4 min-h-full">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <StickyNote className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">No notes yet</p>
                  <p className="text-xs text-muted-foreground/60 max-w-xs">
                    Use the Note button below to pin important info about this deal.
                  </p>
                </div>
              </TabsContent>
            </div>

            {/* Log action bar */}
            <div className="shrink-0 border-t p-3 flex gap-2 flex-wrap bg-card">
              <Button variant="outline" size="sm" onClick={() => { setLogType("call"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-call">
                <PhoneCall className="h-3.5 w-3.5" /> Log Call
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setLogType("email_note"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-email-note">
                <Mail className="h-3.5 w-3.5" /> Email Note
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setLogType("note"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-note">
                <StickyNote className="h-3.5 w-3.5" /> Note
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setLogType("site_visit"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-site-visit">
                <Home className="h-3.5 w-3.5" /> Site Visit
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddTaskOpen(true)} className="flex items-center gap-1.5 text-xs" data-testid="button-add-task">
                <ListTodo className="h-3.5 w-3.5" /> Add Task
              </Button>
            </div>
          </Tabs>
        </div>

        {/* ── RIGHT: Deal Info + Tasks ──────────────────────────────────────────── */}
        <div className="w-80 shrink-0 overflow-y-auto bg-card">
          <div className="p-4">

            {/* Deal Info */}
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Deal Info
            </h3>

            <div className="space-y-2.5">
              {/* Title */}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Title</p>
                <p className="text-sm font-medium" data-testid="text-deal-title">{deal.title}</p>
              </div>

              {/* Plan */}
              {deal.plan && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Plan</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PLAN_COLORS[deal.plan] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`} data-testid="text-deal-plan">
                    {deal.plan}
                  </span>
                </div>
              )}

              {/* Value */}
              {deal.value && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Value</p>
                  <p className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="text-deal-value">
                    ${parseFloat(deal.value).toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </p>
                </div>
              )}

              {/* Stage */}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Stage</p>
                <StagePill stage={deal.stage} />
              </div>

              {/* Probability */}
              {deal.probability != null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Probability</p>
                  <p className={`text-sm font-semibold ${probabilityColor}`} data-testid="text-deal-probability">
                    {deal.probability}%
                  </p>
                </div>
              )}

              {/* Expected Close */}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Expected Close</p>
                <p className="text-sm" data-testid="text-deal-close-date">
                  {deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), "MMM d, yyyy") : "Not set"}
                </p>
              </div>

              {/* Demo Scheduled */}
              {deal.demoScheduledDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Demo Scheduled</p>
                  <p className="text-sm">{format(new Date(deal.demoScheduledDate), "MMM d, yyyy")}</p>
                </div>
              )}

              {/* Demo Completed */}
              {deal.demoCompletedDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Demo Completed</p>
                  <p className="text-sm">{format(new Date(deal.demoCompletedDate), "MMM d, yyyy")}</p>
                </div>
              )}

              {/* Won Date */}
              {deal.wonDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Won Date</p>
                  <p className="text-sm">{format(new Date(deal.wonDate), "MMM d, yyyy")}</p>
                </div>
              )}

              {/* Commission */}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Commission</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  deal.approved === "approved" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                  deal.approved === "rejected"  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                }`}>
                  {deal.approved === "approved" ? "Approved" : deal.approved === "rejected" ? "Rejected" : "Pending"}
                </span>
              </div>

              {/* Description */}
              {deal.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{deal.description}</p>
                </div>
              )}
            </div>

            <Separator className="my-4" />

            {/* Tasks */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                Tasks
              </h3>
              {openTasks.length > 0 && (
                <Badge variant="secondary" className="text-xs" data-testid="text-open-tasks-count">
                  {openTasks.length} open
                </Badge>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-6">
                <ListTodo className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No tasks for this deal yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Open tasks first */}
                {openTasks.map(task => (
                  <div key={task.id} className="flex items-start gap-2 p-2 rounded-md border bg-background hover:bg-muted/40 transition-colors" data-testid={`card-task-${task.id}`}>
                    <button
                      onClick={() => completeTaskMutation.mutate({ taskId: task.id, completed: true })}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                      data-testid={`button-complete-task-${task.id}`}
                    >
                      <Square className="h-4 w-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-snug">{task.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {task.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(task.dueDate), "MMM d")}
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0 rounded-full font-medium ${
                          task.priority === "high"   ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300" :
                          task.priority === "medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                          "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}>
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Completed tasks (collapsed/dimmed) */}
                {completedTasks.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground/60 mt-3 mb-1">Completed ({completedTasks.length})</p>
                    {completedTasks.map(task => (
                      <div key={task.id} className="flex items-start gap-2 p-2 rounded-md border border-dashed opacity-50" data-testid={`card-task-completed-${task.id}`}>
                        <button
                          onClick={() => completeTaskMutation.mutate({ taskId: task.id, completed: false })}
                          className="mt-0.5 shrink-0 text-green-600 dark:text-green-400"
                          data-testid={`button-uncomplete-task-${task.id}`}
                        >
                          <CheckSquare className="h-4 w-4" />
                        </button>
                        <p className="text-xs line-through text-muted-foreground leading-snug">{task.title}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Log Activity dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!logType} onOpenChange={(open) => { if (!open) { setLogType(null); resetLogForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {logType && ACTIVITY_CONFIG[logType] && (() => {
                const cfg = ACTIVITY_CONFIG[logType];
                return (
                  <span className={`inline-flex items-center gap-1.5 ${cfg.color}`}>
                    <cfg.Icon className="h-4 w-4" />
                    {cfg.label}
                  </span>
                );
              })()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Call-specific fields */}
            {logType === "call" && (
              <>
                <div className="space-y-1.5">
                  <Label>Call Outcome</Label>
                  <UiSelect value={callOutcome} onValueChange={setCallOutcome}>
                    <UiSelectTrigger data-testid="select-call-outcome">
                      <UiSelectValue placeholder="Select outcome…" />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      {CALL_OUTCOMES.map(o => (
                        <UiSelectItem key={o} value={o}>{o}</UiSelectItem>
                      ))}
                    </UiSelectContent>
                  </UiSelect>
                </div>
                <div className="space-y-1.5">
                  <Label>Duration <span className="text-muted-foreground text-xs">(optional, e.g. "5 min")</span></Label>
                  <Input
                    value={callDuration}
                    onChange={e => setCallDuration(e.target.value)}
                    placeholder="e.g. 5 min"
                    data-testid="input-call-duration"
                  />
                </div>
              </>
            )}
            {/* Site visit date */}
            {logType === "site_visit" && (
              <div className="space-y-1.5">
                <Label>Visit Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  type="date"
                  value={visitDate}
                  onChange={e => setVisitDate(e.target.value)}
                  data-testid="input-visit-date"
                />
              </div>
            )}
            {/* Notes */}
            <div className="space-y-1.5">
              <Label>
                Notes
                {logType !== "call" && <span className="text-muted-foreground text-xs ml-1">(required)</span>}
              </Label>
              <Textarea
                value={logNotes}
                onChange={e => setLogNotes(e.target.value)}
                placeholder={
                  logType === "call"       ? "What was discussed?" :
                  logType === "email_note" ? "Describe the email you sent or received…" :
                  logType === "site_visit" ? "Notes from the visit…" :
                  "Add your note…"
                }
                rows={4}
                data-testid="textarea-log-notes"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setLogType(null); resetLogForm(); }}>Cancel</Button>
              <Button
                onClick={handleSubmitLog}
                disabled={logActivityMutation.isPending || (!logNotes.trim() && logType !== "call")}
                data-testid="button-submit-log"
              >
                {logActivityMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Task dialog ───────────────────────────────────────────────────── */}
      <Dialog open={addTaskOpen} onOpenChange={(open) => { if (!open) { setAddTaskOpen(false); resetTaskForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Title <span className="text-muted-foreground text-xs">(required)</span></Label>
              <Input
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                placeholder="e.g. Follow up call"
                data-testid="input-task-title"
                onKeyDown={e => { if (e.key === "Enter") handleSubmitTask(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="date"
                value={taskDueDate}
                onChange={e => setTaskDueDate(e.target.value)}
                data-testid="input-task-due-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <UiSelect value={taskPriority} onValueChange={(v: any) => setTaskPriority(v)}>
                <UiSelectTrigger data-testid="select-task-priority">
                  <UiSelectValue />
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem value="low">Low</UiSelectItem>
                  <UiSelectItem value="medium">Medium</UiSelectItem>
                  <UiSelectItem value="high">High</UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setAddTaskOpen(false); resetTaskForm(); }}>Cancel</Button>
              <Button
                onClick={handleSubmitTask}
                disabled={createTaskMutation.isPending || !taskTitle.trim()}
                data-testid="button-submit-task"
              >
                {createTaskMutation.isPending ? "Creating…" : "Create Task"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Contact modal */}
      <Dialog open={editContactOpen} onOpenChange={setEditContactOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
          </DialogHeader>
          {contact && (
            <ContactForm
              contact={contact}
              onSuccess={() => {
                setEditContactOpen(false);
                queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
              }}
              onCancel={() => setEditContactOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
