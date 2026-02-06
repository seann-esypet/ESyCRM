import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import DealForm from "@/components/deals/deal-form";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit, Trash2, Calendar, DollarSign, Handshake, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, RotateCcw, Download, Users, Mail, MessageSquare, Send, Clock, CheckCircle, XCircle, AlertCircle, CalendarClock, Play } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Deal, Contact, User, EmailSequenceLog, EmailSequence, InboxMessage } from "@shared/schema";

type ViewType = "card" | "table";
type SortColumn = "title" | "value" | "expectedCloseDate" | "stage" | "contact" | "probability";
type SortDirection = "asc" | "desc";

export default function Deals() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | undefined>();
  const [viewType, setViewType] = useState<ViewType>("table");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [emailHistoryContactId, setEmailHistoryContactId] = useState<string | null>(null);
  const [rescheduleLogId, setRescheduleLogId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [initiateDate, setInitiateDate] = useState("");
  const [initiateTime, setInitiateTime] = useState("09:00");
  const [showInitiateForm, setShowInitiateForm] = useState(false);

  const initialFilterUserId = isAdmin ? new URLSearchParams(window.location.search).get("filterUserId") || "" : "";
  const [filterUserId, setFilterUserId] = useState(initialFilterUserId);

  const handleFilterChange = (value: string) => {
    setFilterUserId(value === "all" ? "" : value);
  };

  const { data: adminUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: deals, isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const url = queryString ? `/api/deals?${queryString}` : "/api/deals";
      const response = await fetch(url);
      return response.json();
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const url = queryString ? `/api/contacts?${queryString}` : "/api/contacts";
      const response = await fetch(url);
      return response.json();
    },
  });

  const { data: sequenceLogs, isLoading: isLoadingLogs } = useQuery<EmailSequenceLog[]>({
    queryKey: ["/api/email-sequence-logs", emailHistoryContactId],
    queryFn: async () => {
      const response = await fetch(`/api/email-sequence-logs?contactId=${emailHistoryContactId}`);
      return response.json();
    },
    enabled: !!emailHistoryContactId,
  });

  const { data: sequences } = useQuery<EmailSequence[]>({
    queryKey: ["/api/email-sequences"],
    enabled: !!emailHistoryContactId,
  });

  const { data: inboxMessages, isLoading: isLoadingInbox } = useQuery<InboxMessage[]>({
    queryKey: ["/api/inbox", emailHistoryContactId],
    queryFn: async () => {
      const response = await fetch(`/api/inbox?contactId=${emailHistoryContactId}`);
      return response.json();
    },
    enabled: !!emailHistoryContactId,
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({ logId, scheduledSendAt }: { logId: string; scheduledSendAt: string }) => {
      return apiRequest("PATCH", `/api/email-sequence-logs/${logId}/reschedule`, { scheduledSendAt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      setRescheduleLogId(null);
      setRescheduleDate("");
      setRescheduleTime("09:00");
      toast({ title: "Rescheduled", description: "Email has been rescheduled successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reschedule email", variant: "destructive" });
    },
  });

  const initiateMutation = useMutation({
    mutationFn: async ({ contactId, scheduledSendAt }: { contactId: string; scheduledSendAt: string }) => {
      return apiRequest("POST", `/api/email-sequence-logs/initiate`, { contactId, scheduledSendAt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      setShowInitiateForm(false);
      setInitiateDate("");
      setInitiateTime("09:00");
      toast({ title: "Sequence Started", description: "Email Sequence 1 has been scheduled successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start email sequence", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/deals/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete deal");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    },
  });

  const stageChangeMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      return apiRequest("PATCH", `/api/deals/${id}`, { stage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Stage updated",
        description: "Deal stage has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update deal stage",
        variant: "destructive",
      });
    },
  });

  const getContactName = (contactId: string | null) => {
    if (!contactId || !contacts) return "No contact";
    const contact = contacts.find(c => c.id === contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : "Unknown contact";
  };

  const getContactAddress = (contactId: string | null) => {
    if (!contactId || !contacts) return "";
    const contact = contacts.find(c => c.id === contactId);
    return contact?.address || "";
  };

  const getStageLabel = (stage: string) => {
    switch (stage) {
      case "new_lead_unqualified":
        return "New Lead Unqualified";
      case "qualified_lead":
        return "Qualified Lead";
      case "contacted_left_message":
        return "Contacted (Left Message)";
      case "contacted_spoke_to_decision_maker":
        return "Contacted (Spoke to Owner/Decision Maker)";
      case "onboarded_form_completed":
        return "Onboarded Form Completed";
      case "demo_scheduled":
        return "Demo Scheduled";
      case "demo_completed":
        return "Demo Completed";
      case "decision_pending":
        return "Decision Pending";
      case "won":
        return "Won";
      case "lost":
        return "Lost";
      default:
        return stage.replace('_', ' ').toUpperCase();
    }
  };

  const handleStageChange = (dealId: string, newStage: string) => {
    stageChangeMutation.mutate({ id: dealId, stage: newStage });
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "new_lead_unqualified":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "qualified_lead":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "contacted_left_message":
        return "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300";
      case "contacted_spoke_to_decision_maker":
        return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300";
      case "onboarded_form_completed":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300";
      case "demo_scheduled":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "demo_completed":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "decision_pending":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "won":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300";
      case "lost":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "Not specified";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Not set";
    return new Date(date).toLocaleDateString();
  };

  const formatDateTime = (date: string | Date | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleString();
  };

  const isDateExpired = (date: string | Date | null) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const closeDate = new Date(date);
    closeDate.setHours(0, 0, 0, 0);
    return closeDate < today;
  };

  const handleContactClick = (contactId: string | null) => {
    if (contactId) {
      setEmailHistoryContactId(contactId);
    }
  };

  const getSequenceSubject = (sequenceId: string) => {
    if (!sequences) return "Unknown Sequence";
    const seq = sequences.find(s => s.id === sequenceId);
    return seq?.subject || "Unknown Sequence";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "sent":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "processing":
        return <Clock className="h-4 w-4 text-blue-500 animate-spin" />;
      case "replied":
        return <MessageSquare className="h-4 w-4 text-purple-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTrackLabel = (track: string) => {
    return track === "no_software" ? "No Software" : "Uses Competitor";
  };

  const emailHistoryContact = emailHistoryContactId
    ? contacts?.find(c => c.id === emailHistoryContactId)
    : null;

  const handleReschedule = (logId: string) => {
    const log = sequenceLogs?.find(l => l.id === logId);
    if (log?.scheduledSendAt) {
      const d = new Date(log.scheduledSendAt);
      setRescheduleDate(d.toISOString().split("T")[0]);
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      setRescheduleTime(`${h}:${m}`);
    } else {
      setRescheduleDate("");
      setRescheduleTime("09:00");
    }
    setRescheduleLogId(logId);
  };

  const submitReschedule = () => {
    if (!rescheduleLogId || !rescheduleDate || !rescheduleTime) return;
    const scheduledSendAt = new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString();
    rescheduleMutation.mutate({ logId: rescheduleLogId, scheduledSendAt });
  };

  const submitInitiate = () => {
    if (!emailHistoryContactId || !initiateDate || !initiateTime) return;
    const scheduledSendAt = new Date(`${initiateDate}T${initiateTime}:00`).toISOString();
    initiateMutation.mutate({ contactId: emailHistoryContactId, scheduledSendAt });
  };

  const hasAnySequenceLogs = (sequenceLogs?.length ?? 0) > 0;

  const handleEdit = (deal: Deal) => {
    setSelectedDeal(deal);
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this deal?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    window.open('/api/export/deals', '_blank');
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedDeal(undefined);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const isStageOpen = (stage: string) => {
    return !["won", "lost"].includes(stage);
  };

  const sortedDeals = useMemo(() => {
    if (!deals) return [];

    let sorted = [...deals];

    // Default sort: open deals first (by stage), then newest first (by createdAt)
    if (!sortColumn) {
      sorted.sort((a, b) => {
        const aIsOpen = isStageOpen(a.stage);
        const bIsOpen = isStageOpen(b.stage);
        
        if (aIsOpen !== bIsOpen) {
          return aIsOpen ? -1 : 1; // Open deals first
        }
        
        // Within the same category (open or closed), newest first
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      });
      return sorted;
    }

    // Custom column sorting
    sorted.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case "title":
          aValue = a.title?.toLowerCase() || "";
          bValue = b.title?.toLowerCase() || "";
          break;
        case "value":
          aValue = parseFloat(a.value || "0");
          bValue = parseFloat(b.value || "0");
          break;
        case "expectedCloseDate":
          aValue = a.expectedCloseDate ? new Date(a.expectedCloseDate).getTime() : 0;
          bValue = b.expectedCloseDate ? new Date(b.expectedCloseDate).getTime() : 0;
          break;
        case "stage":
          aValue = a.stage?.toLowerCase() || "";
          bValue = b.stage?.toLowerCase() || "";
          break;
        case "contact":
          aValue = getContactName(a.contactId).toLowerCase();
          bValue = getContactName(b.contactId).toLowerCase();
          break;
        case "probability":
          aValue = a.probability ?? 0;
          bValue = b.probability ?? 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [deals, sortColumn, sortDirection, contacts]);

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="ml-2 h-4 w-4" />
      : <ArrowDown className="ml-2 h-4 w-4" />;
  };

  if (isLoading) {
    return (
      <>
        <Header title="Pipeline" onAddNew={() => setIsFormOpen(true)} addButtonText="New Deal" />
        <main className="flex-1 overflow-y-auto p-6 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                    <div className="h-6 bg-muted rounded w-1/3"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header 
        title="Pipeline" 
        onAddNew={() => setIsFormOpen(true)}
        addButtonText="New Deal"
        customActions={
          <div className="flex gap-2 items-center">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Select value={filterUserId || "all"} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-[200px]" data-testid="select-filter-user-deals">
                    <SelectValue placeholder="All Salespeople" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Salespeople</SelectItem>
                    {adminUsers?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email || "Unknown"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                data-testid="button-export"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )}
            {sortColumn && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSortColumn(null);
                  setSortDirection("asc");
                }}
                data-testid="reset-sort"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Sort
              </Button>
            )}
            <div className="flex gap-1 border border-border rounded-md">
              <Button
                variant={viewType === "card" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewType("card")}
                data-testid="view-card"
                className="rounded-r-none"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewType === "table" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewType("table")}
                data-testid="view-table"
                className="rounded-l-none"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        }
      />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="deals-content">
        {!deals?.length ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Handshake className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-2">No deals found</h3>
              <p className="text-muted-foreground">
                Start tracking your sales pipeline by creating your first deal.
              </p>
            </CardContent>
          </Card>
        ) : viewType === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedDeals.map((deal) => (
              <Card 
                key={deal.id} 
                className="hover:shadow-md transition-shadow"
                data-testid={`deal-card-${deal.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-semibold text-lg text-foreground line-clamp-2">
                      {deal.title}
                    </h3>
                    <div className="flex space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(deal)}
                        data-testid={`edit-deal-${deal.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(deal.id)}
                        className="text-destructive hover:text-destructive"
                        data-testid={`delete-deal-${deal.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {formatCurrency(deal.value)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Expected: {formatDate(deal.expectedCloseDate)}
                      </span>
                    </div>

                    <div>
                      <Select
                        value={deal.stage}
                        onValueChange={(value) => handleStageChange(deal.id, value)}
                        disabled={stageChangeMutation.isPending}
                      >
                        <SelectTrigger 
                          className={`w-full ${getStageColor(deal.stage)}`}
                          data-testid={`select-stage-card-${deal.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
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
                    </div>

                    <div className="pt-2 border-t border-border">
                      <p className="text-sm text-muted-foreground">
                        Contact:{" "}
                        <button
                          className="text-primary hover:underline cursor-pointer font-medium"
                          onClick={(e) => { e.stopPropagation(); handleContactClick(deal.contactId); }}
                          data-testid={`contact-link-card-${deal.id}`}
                        >
                          {getContactName(deal.contactId)}
                        </button>
                      </p>
                      {getContactAddress(deal.contactId) && (
                        <p className="text-sm text-muted-foreground truncate" title={getContactAddress(deal.contactId)}>
                          Address: {getContactAddress(deal.contactId)}
                        </p>
                      )}
                      {deal.probability !== null && (
                        <p className="text-sm text-muted-foreground">
                          Probability: {deal.probability}%
                        </p>
                      )}
                    </div>

                    {deal.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {deal.description}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("contact")}
                      data-testid="sort-contact"
                    >
                      Contact
                      <SortIcon column="contact" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("title")}
                      data-testid="sort-title"
                    >
                      Deal Name
                      <SortIcon column="title" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("value")}
                      data-testid="sort-value"
                    >
                      Value
                      <SortIcon column="value" />
                    </Button>
                  </TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("expectedCloseDate")}
                      data-testid="sort-expectedCloseDate"
                    >
                      Expected Close
                      <SortIcon column="expectedCloseDate" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("stage")}
                      data-testid="sort-stage"
                    >
                      Stage
                      <SortIcon column="stage" />
                    </Button>
                  </TableHead>
                  <TableHead>Stage Changed</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("probability")}
                      data-testid="sort-probability"
                    >
                      Probability
                      <SortIcon column="probability" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDeals.map((deal) => {
                  const isExpired = isDateExpired(deal.expectedCloseDate) && !["closed_won", "closed_lost"].includes(deal.stage);
                  return (
                    <TableRow 
                      key={deal.id} 
                      data-testid={`deal-row-${deal.id}`}
                      className={isExpired ? "bg-[#E96161] hover:bg-[#E96161]/90" : ""}
                    >
                      <TableCell>
                        <button
                          className="text-primary hover:underline cursor-pointer font-medium"
                          onClick={() => handleContactClick(deal.contactId)}
                          data-testid={`contact-link-table-${deal.id}`}
                        >
                          {getContactName(deal.contactId)}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">
                        {deal.title}
                      </TableCell>
                      <TableCell>{formatCurrency(deal.value)}</TableCell>
                      <TableCell>{deal.plan || "—"}</TableCell>
                      <TableCell>{formatDate(deal.expectedCloseDate)}</TableCell>
                      <TableCell>
                        <Select
                          value={deal.stage}
                          onValueChange={(value) => handleStageChange(deal.id, value)}
                          disabled={stageChangeMutation.isPending}
                        >
                          <SelectTrigger 
                            className={`w-[200px] ${getStageColor(deal.stage)}`}
                            data-testid={`select-stage-${deal.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
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
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(deal.stageChangedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[150px] truncate" title={getContactAddress(deal.contactId)}>
                          {getContactAddress(deal.contactId) || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {deal.probability !== null ? `${deal.probability}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(deal)}
                            data-testid={`edit-deal-${deal.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(deal.id)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`delete-deal-${deal.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedDeal ? "Edit Deal" : "Add New Deal"}
            </DialogTitle>
          </DialogHeader>
          <DealForm
            deal={selectedDeal}
            onSuccess={handleFormSuccess}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailHistoryContactId} onOpenChange={(open) => { if (!open) { setEmailHistoryContactId(null); setRescheduleLogId(null); setShowInitiateForm(false); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh]" data-testid="email-history-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email History — {emailHistoryContact ? `${emailHistoryContact.firstName} ${emailHistoryContact.lastName}` : ""}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Email Sequences
                  </h3>
                  {!hasAnySequenceLogs && !isLoadingLogs && !showInitiateForm && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowInitiateForm(true)}
                      data-testid="button-initiate-sequence"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Start Sequence 1
                    </Button>
                  )}
                </div>

                {showInitiateForm && (
                  <Card className="mb-3 border-primary/50">
                    <CardContent className="p-4">
                      <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                        <Play className="h-4 w-4" />
                        Start Email Sequence 1
                      </h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Schedule when Sequence 1 should be sent to this contact. Time is in Eastern Time.
                      </p>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex-1 min-w-[140px]">
                          <Label htmlFor="initiate-date" className="text-xs">Date</Label>
                          <Input
                            id="initiate-date"
                            type="date"
                            value={initiateDate}
                            onChange={(e) => setInitiateDate(e.target.value)}
                            data-testid="input-initiate-date"
                          />
                        </div>
                        <div className="w-[120px]">
                          <Label htmlFor="initiate-time" className="text-xs">Time (ET)</Label>
                          <Input
                            id="initiate-time"
                            type="time"
                            value={initiateTime}
                            onChange={(e) => setInitiateTime(e.target.value)}
                            data-testid="input-initiate-time"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={submitInitiate}
                            disabled={!initiateDate || !initiateTime || initiateMutation.isPending}
                            data-testid="button-submit-initiate"
                          >
                            {initiateMutation.isPending ? "Scheduling..." : "Schedule"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setShowInitiateForm(false); setInitiateDate(""); setInitiateTime("09:00"); }}
                            data-testid="button-cancel-initiate"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {isLoadingLogs ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : !sequenceLogs?.length ? (
                  <Card>
                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                      No email sequences have been sent to this contact yet.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {sequenceLogs.map((log, index) => (
                      <Card key={log.id} className={index === 0 ? "border-primary/50 shadow-sm" : ""} data-testid={`sequence-log-${log.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              {getStatusIcon(log.status)}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {getSequenceSubject(log.sequenceId)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    Seq #{log.sequenceNumber}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">
                                    {getTrackLabel(log.sequenceTrack)}
                                  </Badge>
                                  <Badge
                                    variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
                                    className="text-xs"
                                  >
                                    {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                                  </Badge>
                                  {index === 0 && (
                                    <Badge variant="default" className="text-xs bg-primary">
                                      Latest
                                    </Badge>
                                  )}
                                </div>
                                {log.scheduledSendAt && log.status === "pending" && (
                                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                    <CalendarClock className="h-3 w-3" />
                                    Scheduled: {new Date(log.scheduledSendAt).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {log.sentAt ? new Date(log.sentAt).toLocaleString() : log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                              </span>
                              {log.status === "pending" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleReschedule(log.id)}
                                  data-testid={`button-reschedule-${log.id}`}
                                >
                                  <CalendarClock className="h-3 w-3 mr-1" />
                                  Reschedule
                                </Button>
                              )}
                            </div>
                          </div>

                          {rescheduleLogId === log.id && (
                            <div className="mt-3 pt-3 border-t border-border">
                              <p className="text-xs text-muted-foreground mb-2">Set new date and time (Eastern Time):</p>
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="flex-1 min-w-[130px]">
                                  <Label htmlFor={`reschedule-date-${log.id}`} className="text-xs">Date</Label>
                                  <Input
                                    id={`reschedule-date-${log.id}`}
                                    type="date"
                                    value={rescheduleDate}
                                    onChange={(e) => setRescheduleDate(e.target.value)}
                                    data-testid={`input-reschedule-date-${log.id}`}
                                  />
                                </div>
                                <div className="w-[110px]">
                                  <Label htmlFor={`reschedule-time-${log.id}`} className="text-xs">Time (ET)</Label>
                                  <Input
                                    id={`reschedule-time-${log.id}`}
                                    type="time"
                                    value={rescheduleTime}
                                    onChange={(e) => setRescheduleTime(e.target.value)}
                                    data-testid={`input-reschedule-time-${log.id}`}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="h-8"
                                    onClick={submitReschedule}
                                    disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}
                                    data-testid={`button-submit-reschedule-${log.id}`}
                                  >
                                    {rescheduleMutation.isPending ? "Saving..." : "Save"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => { setRescheduleLogId(null); setRescheduleDate(""); setRescheduleTime("09:00"); }}
                                    data-testid={`button-cancel-reschedule-${log.id}`}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4" />
                  Replies
                </h3>
                {isLoadingInbox ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => (
                      <div key={i} className="h-20 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : !inboxMessages?.length ? (
                  <Card>
                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                      No replies received from this contact yet.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {inboxMessages.map((msg) => (
                      <Card key={msg.id} data-testid={`inbox-msg-${msg.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                              <p className="text-sm font-medium text-foreground truncate">
                                {msg.subject}
                              </p>
                              {msg.isRead === "false" && (
                                <Badge variant="default" className="text-xs bg-blue-500 shrink-0">
                                  New
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {msg.receivedAt ? new Date(msg.receivedAt).toLocaleString() : "—"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-1">From: {msg.from}</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4">
                            {msg.bodyText || "(No text content)"}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
