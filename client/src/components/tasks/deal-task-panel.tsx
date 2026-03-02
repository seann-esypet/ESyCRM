import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format, isToday, isPast, startOfDay } from "date-fns";
import type { DealTask } from "@shared/schema";
import {
  CheckSquare, Square, ListTodo, Phone, Mail, Video, RefreshCw,
  Store, FileText, MoreHorizontal, Bell, AlertTriangle, Calendar,
  Clock, ChevronDown, ChevronUp, Plus, Pencil, Copy, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Task type config ─────────────────────────────────────────────────────────
const TASK_TYPES: { value: string; label: string; Icon: React.ElementType; color: string }[] = [
  { value: "call",       label: "Call",       Icon: Phone,     color: "text-green-600" },
  { value: "email",      label: "Email",      Icon: Mail,      color: "text-blue-600" },
  { value: "demo",       label: "Demo",       Icon: Video,     color: "text-purple-600" },
  { value: "follow_up",  label: "Follow-up",  Icon: RefreshCw, color: "text-orange-600" },
  { value: "site_visit", label: "Site Visit", Icon: Store,     color: "text-amber-600" },
  { value: "other",      label: "Other",      Icon: FileText,  color: "text-gray-500" },
];

const REMINDER_OPTIONS = [
  { value: "none",   label: "No reminder" },
  { value: "15min",  label: "15 minutes before" },
  { value: "1hour",  label: "1 hour before" },
  { value: "1day",   label: "1 day before" },
  { value: "custom", label: "Custom date & time" },
];

function taskTypeInfo(type: string) {
  return TASK_TYPES.find(t => t.value === type) ?? TASK_TYPES[TASK_TYPES.length - 1];
}

function calcReminderDatetime(dueDate: string, dueTime: string, timing: string): Date | null {
  if (!dueDate || timing === "none") return null;
  const base = new Date(`${dueDate}T${dueTime || "09:00"}:00`);
  if (isNaN(base.getTime())) return null;
  if (timing === "15min") return new Date(base.getTime() - 15 * 60 * 1000);
  if (timing === "1hour")  return new Date(base.getTime() - 60 * 60 * 1000);
  if (timing === "1day")   return new Date(base.getTime() - 24 * 60 * 60 * 1000);
  return null;
}

// ─── Priority badge ───────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`text-xs px-1.5 py-0 rounded-full font-medium ${
      priority === "high"   ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300" :
      priority === "medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
    }`}>
      {priority}
    </span>
  );
}

type AnyTask = DealTask & { _legacy?: boolean };

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onComplete,
  onEdit,
  onDuplicate,
  onDelete,
  isCompleting,
}: {
  task: AnyTask;
  onComplete: (completed: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  isCompleting: boolean;
}) {
  const typeInfo = taskTypeInfo(task.taskType);
  const isCompleted = task.completed === "true";
  const isOverdue = !isCompleted && task.dueDate && isPast(startOfDay(new Date(task.dueDate))) && !isToday(new Date(task.dueDate));
  const hasReminder = task.reminderTiming && task.reminderTiming !== "none";
  const isLegacy = !!(task as any)._legacy;

  const dueDateStr = task.dueDate
    ? isToday(new Date(task.dueDate))
      ? `Today${task.dueTime ? ` at ${task.dueTime}` : ""}`
      : `${format(new Date(task.dueDate), "MMM d")}${task.dueTime ? ` at ${task.dueTime}` : ""}`
    : null;

  return (
    <div
      className={`flex items-start gap-2 p-2.5 rounded-md border bg-background transition-colors group relative ${
        isOverdue ? "border-l-2 border-l-red-500 border-y-red-100 dark:border-y-red-900/40" :
        isCompleted ? "opacity-60 border-dashed" : "hover:bg-muted/40"
      }`}
      data-testid={`card-task-${task.id}`}
    >
      {/* Checkbox */}
      <button
        onClick={() => onComplete(!isCompleted)}
        disabled={isCompleting}
        className={`mt-0.5 shrink-0 ${isCompleted ? "text-green-600 dark:text-green-400" : "text-muted-foreground hover:text-primary"}`}
        data-testid={`button-toggle-task-${task.id}`}
      >
        {isCompleted ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <p className={`text-xs font-medium leading-snug ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
            {isOverdue && <span className="text-red-500 font-bold mr-1">OVERDUE</span>}
            {task.title}
          </p>
          {/* Dot menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 -mt-0.5"
                data-testid={`button-task-menu-${task.id}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {!isLegacy && (
                <DropdownMenuItem onClick={onEdit} data-testid={`menuitem-edit-task-${task.id}`}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onDuplicate} data-testid={`menuitem-duplicate-task-${task.id}`}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onComplete(!isCompleted)}
                data-testid={`menuitem-complete-task-${task.id}`}
              >
                <CheckSquare className="h-3.5 w-3.5 mr-2" />
                {isCompleted ? "Mark Pending" : "Mark Complete"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
                data-testid={`menuitem-delete-task-${task.id}`}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {/* Type */}
          <span className={`flex items-center gap-0.5 text-xs ${typeInfo.color}`}>
            <typeInfo.Icon className="h-3 w-3" />
            {typeInfo.label}
          </span>
          {/* Due date */}
          {dueDateStr && (
            <span className={`text-xs flex items-center gap-0.5 ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
              <Calendar className="h-3 w-3" />
              {dueDateStr}
            </span>
          )}
          {/* Priority */}
          <PriorityBadge priority={task.priority} />
          {/* Reminder */}
          {hasReminder && (
            <span className="text-xs text-amber-500 flex items-center gap-0.5" title="Reminder scheduled">
              <Bell className="h-3 w-3" />
            </span>
          )}
          {/* Legacy badge */}
          {isLegacy && (
            <span className="text-xs text-muted-foreground bg-muted px-1 rounded" title="Created from the Tasks page">
              from Tasks
            </span>
          )}
          {/* Completed timestamp */}
          {isCompleted && task.completedAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {format(new Date(task.completedAt), "MMM d, h:mm a")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionLabel({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className={`flex items-center gap-2 mt-3 mb-1.5`}>
      <span className={`text-xs font-semibold uppercase tracking-wide ${color}`}>{label}</span>
      <Badge variant="outline" className={`text-xs h-4 px-1.5 ${color}`}>{count}</Badge>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Blank form state ─────────────────────────────────────────────────────────
function blankForm(userId: string, userEmail: string) {
  return {
    title: "",
    taskType: "call",
    priority: "medium",
    dueDate: "",
    dueTime: "",
    assignedTo: userId,
    assignedEmail: userEmail,
    reminderTiming: "none",
    reminderDatetime: "",
    notes: "",
    autoFollowup: false,
    followupTitle: "",
    followupDaysOut: "1",
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  dealId: string;
  contactId: string | null;
}

export default function DealTaskPanel({ dealId, contactId }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [form, setForm] = useState(() =>
    blankForm(user?.id ?? "", user?.workEmail ?? user?.email ?? "")
  );

  // Fetch tasks
  const { data: tasks = [], isLoading } = useQuery<DealTask[]>({
    queryKey: ["/api/deal-tasks", dealId],
    queryFn: () => fetch(`/api/deal-tasks?dealId=${dealId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!dealId,
  });

  // Fetch users for "Assigned To" dropdown (admin endpoint, gracefully fails for non-admins)
  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 60000,
  });

  // Group tasks into sections
  const { overdue, dueToday, upcoming, completed } = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    return {
      overdue:   tasks.filter(t => t.completed !== "true" && t.dueDate && isPast(startOfDay(new Date(t.dueDate))) && !isToday(new Date(t.dueDate))),
      dueToday:  tasks.filter(t => t.completed !== "true" && t.dueDate && isToday(new Date(t.dueDate))),
      upcoming:  tasks.filter(t => t.completed !== "true" && (!t.dueDate || (!isPast(startOfDay(new Date(t.dueDate))) && !isToday(new Date(t.dueDate))))).sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }),
      completed: tasks.filter(t => t.completed === "true").sort((a, b) => {
        if (!a.completedAt && !b.completedAt) return 0;
        if (!a.completedAt) return 1;
        if (!b.completedAt) return -1;
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      }),
    };
  }, [tasks]);

  const openCount = overdue.length + dueToday.length + upcoming.length;

  // ── Mutations ───────────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/deal-tasks", dealId] });
    queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
  };

  const completeMutation = useMutation({
    mutationFn: ({ id, completed, isLegacy }: { id: string; completed: boolean; isLegacy?: boolean }) =>
      isLegacy
        ? apiRequest("PUT", `/api/tasks/${id}`, { status: completed ? "completed" : "pending" })
        : apiRequest("PATCH", `/api/deal-tasks/${id}`, { completed: completed ? "true" : "false" }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: () => toast({ title: "Failed to update task", variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: object) =>
      editingTask
        ? apiRequest("PATCH", `/api/deal-tasks/${editingTask.id}`, payload)
        : apiRequest("POST", "/api/deal-tasks", payload),
    onSuccess: () => {
      invalidate();
      closeModal();
      toast({ title: editingTask ? "Task updated" : "Task created" });
    },
    onError: () => toast({ title: "Failed to save task", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, isLegacy }: { id: string; isLegacy?: boolean }) =>
      isLegacy
        ? apiRequest("DELETE", `/api/tasks/${id}`)
        : apiRequest("DELETE", `/api/deal-tasks/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Task deleted" }); },
    onError: () => toast({ title: "Failed to delete task", variant: "destructive" }),
  });

  // ── Modal helpers ───────────────────────────────────────────────────────────
  function openAdd() {
    setEditingTask(null);
    setForm(blankForm(user?.id ?? "", user?.workEmail ?? user?.email ?? ""));
    setModalOpen(true);
  }

  function openEdit(task: DealTask) {
    setEditingTask(task);
    setForm({
      title: task.title,
      taskType: task.taskType,
      priority: task.priority,
      dueDate: task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : "",
      dueTime: task.dueTime ?? "",
      assignedTo: task.assignedTo ?? user?.id ?? "",
      assignedEmail: task.assignedEmail ?? "",
      reminderTiming: task.reminderTiming ?? "none",
      reminderDatetime: task.reminderDatetime ? format(new Date(task.reminderDatetime), "yyyy-MM-dd'T'HH:mm") : "",
      notes: task.notes ?? "",
      autoFollowup: task.autoFollowup === "true",
      followupTitle: task.followupTitle ?? "",
      followupDaysOut: String(task.followupDaysOut ?? "1"),
    });
    setModalOpen(true);
  }

  function openDuplicate(task: DealTask) {
    setEditingTask(null);
    setForm({
      title: `${task.title} (copy)`,
      taskType: task.taskType,
      priority: task.priority,
      dueDate: task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : "",
      dueTime: task.dueTime ?? "",
      assignedTo: task.assignedTo ?? user?.id ?? "",
      assignedEmail: task.assignedEmail ?? "",
      reminderTiming: task.reminderTiming ?? "none",
      reminderDatetime: "",
      notes: task.notes ?? "",
      autoFollowup: task.autoFollowup === "true",
      followupTitle: task.followupTitle ?? "",
      followupDaysOut: String(task.followupDaysOut ?? "1"),
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingTask(null);
  }

  function handleSave() {
    if (!form.title.trim()) return;

    let reminderDatetime: string | null = null;
    if (form.reminderTiming === "custom") {
      reminderDatetime = form.reminderDatetime || null;
    } else {
      const calc = calcReminderDatetime(form.dueDate, form.dueTime, form.reminderTiming);
      reminderDatetime = calc ? calc.toISOString() : null;
    }

    saveMutation.mutate({
      dealId,
      contactId: contactId ?? undefined,
      title: form.title.trim(),
      taskType: form.taskType,
      priority: form.priority,
      dueDate: form.dueDate || null,
      dueTime: form.dueTime || null,
      assignedTo: form.assignedTo || null,
      assignedEmail: form.assignedEmail || null,
      reminderTiming: form.reminderTiming,
      reminderDatetime,
      notes: form.notes || null,
      autoFollowup: form.autoFollowup ? "true" : "false",
      followupTitle: form.autoFollowup ? form.followupTitle || null : null,
      followupDaysOut: form.autoFollowup ? parseInt(form.followupDaysOut) || 1 : null,
    });
  }

  // When assigned-to changes, auto-fill email
  function handleAssignedToChange(userId: string) {
    const selectedUser = allUsers.find((u: any) => u.id === userId);
    setForm(f => ({
      ...f,
      assignedTo: userId,
      assignedEmail: selectedUser?.workEmail || selectedUser?.email || f.assignedEmail,
    }));
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          Tasks
        </h3>
        <div className="flex items-center gap-2">
          {/* Count badge */}
          {(openCount > 0 || overdue.length > 0) && (
            <span className="text-xs text-muted-foreground" data-testid="text-tasks-count">
              {openCount} open
              {overdue.length > 0 && (
                <span className="text-red-500 ml-1">· {overdue.length} overdue</span>
              )}
            </span>
          )}
          <Button
            variant="outline" size="sm"
            onClick={openAdd}
            className="flex items-center gap-1 text-xs h-7 px-2"
            data-testid="button-add-deal-task"
          >
            <Plus className="h-3.5 w-3.5" /> Add Task
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground text-center py-4">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-6">
          <ListTodo className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No tasks for this deal yet</p>
          <Button variant="ghost" size="sm" className="text-xs mt-2" onClick={openAdd} data-testid="button-add-first-task">
            Add the first task
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Overdue */}
          {overdue.length > 0 && (
            <>
              <SectionLabel color="text-red-500" label="Overdue" count={overdue.length} />
              {overdue.map(task => (
                <TaskCard key={task.id} task={task as AnyTask}
                  onComplete={c => completeMutation.mutate({ id: task.id, completed: c, isLegacy: !!(task as AnyTask)._legacy })}
                  onEdit={() => (task as AnyTask)._legacy ? toast({ title: "Edit this task in the Tasks page" }) : openEdit(task)}
                  onDuplicate={() => openDuplicate(task)}
                  onDelete={() => deleteMutation.mutate({ id: task.id, isLegacy: !!(task as AnyTask)._legacy })}
                  isCompleting={completeMutation.isPending}
                />
              ))}
            </>
          )}

          {/* Due Today */}
          {dueToday.length > 0 && (
            <>
              <SectionLabel color="text-amber-500" label="Due Today" count={dueToday.length} />
              {dueToday.map(task => (
                <TaskCard key={task.id} task={task as AnyTask}
                  onComplete={c => completeMutation.mutate({ id: task.id, completed: c, isLegacy: !!(task as AnyTask)._legacy })}
                  onEdit={() => (task as AnyTask)._legacy ? toast({ title: "Edit this task in the Tasks page" }) : openEdit(task)}
                  onDuplicate={() => openDuplicate(task)}
                  onDelete={() => deleteMutation.mutate({ id: task.id, isLegacy: !!(task as AnyTask)._legacy })}
                  isCompleting={completeMutation.isPending}
                />
              ))}
            </>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <>
              {(overdue.length > 0 || dueToday.length > 0) && (
                <SectionLabel color="text-muted-foreground" label="Upcoming" count={upcoming.length} />
              )}
              {upcoming.map(task => (
                <TaskCard key={task.id} task={task as AnyTask}
                  onComplete={c => completeMutation.mutate({ id: task.id, completed: c, isLegacy: !!(task as AnyTask)._legacy })}
                  onEdit={() => (task as AnyTask)._legacy ? toast({ title: "Edit this task in the Tasks page" }) : openEdit(task)}
                  onDuplicate={() => openDuplicate(task)}
                  onDelete={() => deleteMutation.mutate({ id: task.id, isLegacy: !!(task as AnyTask)._legacy })}
                  isCompleting={completeMutation.isPending}
                />
              ))}
            </>
          )}

          {/* Completed (collapsible) */}
          {completed.length > 0 && (
            <>
              <button
                onClick={() => setCompletedExpanded(e => !e)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/70 mt-3 hover:text-muted-foreground w-full"
                data-testid="button-toggle-completed"
              >
                {completedExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Completed ({completed.length})
              </button>
              {completedExpanded && (
                <div className="space-y-1 mt-1">
                  {completed.map(task => (
                    <TaskCard key={task.id} task={task as AnyTask}
                      onComplete={c => completeMutation.mutate({ id: task.id, completed: c, isLegacy: !!(task as AnyTask)._legacy })}
                      onEdit={() => (task as AnyTask)._legacy ? toast({ title: "Edit this task in the Tasks page" }) : openEdit(task)}
                      onDuplicate={() => openDuplicate(task)}
                      onDelete={() => deleteMutation.mutate({ id: task.id, isLegacy: !!(task as AnyTask)._legacy })}
                      isCompleting={completeMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Add / Edit Task Modal ──────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={open => { if (!open) closeModal(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit Task" : "Add Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Title */}
            <div className="space-y-1.5">
              <Label>Title <span className="text-muted-foreground text-xs">(required)</span></Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Follow-up call with Ted"
                data-testid="input-deal-task-title"
              />
            </div>

            {/* Type + Priority row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Task Type</Label>
                <Select value={form.taskType} onValueChange={v => setForm(f => ({ ...f, taskType: v }))}>
                  <SelectTrigger data-testid="select-task-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="flex items-center gap-1.5">
                          <t.Icon className={`h-3.5 w-3.5 ${t.color}`} />
                          {t.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger data-testid="select-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high"><span className="text-red-500 font-medium">High</span></SelectItem>
                    <SelectItem value="medium"><span className="text-yellow-600 font-medium">Medium</span></SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Due Date + Time row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  data-testid="input-task-due-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Due Time <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  type="time"
                  value={form.dueTime}
                  onChange={e => setForm(f => ({ ...f, dueTime: e.target.value }))}
                  data-testid="input-task-due-time"
                />
              </div>
            </div>

            {/* Assigned To */}
            {allUsers.length > 0 && (
              <div className="space-y-1.5">
                <Label>Assigned To</Label>
                <Select value={form.assignedTo} onValueChange={handleAssignedToChange}>
                  <SelectTrigger data-testid="select-task-assigned-to">
                    <SelectValue placeholder="Select rep…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Reminder */}
            <div className="space-y-1.5">
              <Label>Reminder</Label>
              <Select value={form.reminderTiming} onValueChange={v => setForm(f => ({ ...f, reminderTiming: v }))}>
                <SelectTrigger data-testid="select-task-reminder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom reminder datetime */}
            {form.reminderTiming === "custom" && (
              <div className="space-y-1.5">
                <Label>Reminder Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={form.reminderDatetime}
                  onChange={e => setForm(f => ({ ...f, reminderDatetime: e.target.value }))}
                  data-testid="input-task-reminder-datetime"
                />
              </div>
            )}

            {/* Reminder email */}
            {form.reminderTiming !== "none" && (
              <div className="space-y-1.5">
                <Label>Reminder Email</Label>
                <Input
                  type="email"
                  value={form.assignedEmail}
                  onChange={e => setForm(f => ({ ...f, assignedEmail: e.target.value }))}
                  placeholder="rep@company.com"
                  data-testid="input-task-reminder-email"
                />
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any context or details…"
                rows={3}
                data-testid="textarea-task-notes"
              />
            </div>

            {/* Auto follow-up */}
            <div className="space-y-2 rounded-md border p-3 bg-muted/30">
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={form.autoFollowup}
                  onCheckedChange={v => setForm(f => ({ ...f, autoFollowup: !!v }))}
                  data-testid="checkbox-auto-followup"
                />
                <div>
                  <p className="text-sm font-medium leading-none">Auto-create follow-up task</p>
                  <p className="text-xs text-muted-foreground mt-1">When this task is completed, automatically create a follow-up.</p>
                </div>
              </label>
              {form.autoFollowup && (
                <div className="space-y-2 pt-1 pl-6">
                  <Input
                    value={form.followupTitle}
                    onChange={e => setForm(f => ({ ...f, followupTitle: e.target.value }))}
                    placeholder="Follow-up task title…"
                    data-testid="input-followup-title"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={form.followupDaysOut}
                      onChange={e => setForm(f => ({ ...f, followupDaysOut: e.target.value }))}
                      className="w-20"
                      data-testid="input-followup-days"
                    />
                    <span className="text-sm text-muted-foreground">days after due date</span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={closeModal} disabled={saveMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending || !form.title.trim()}
                data-testid="button-save-deal-task"
              >
                {saveMutation.isPending ? "Saving…" : editingTask ? "Update Task" : "Create Task"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
