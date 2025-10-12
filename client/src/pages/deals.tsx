import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import DealForm from "@/components/deals/deal-form";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Calendar, DollarSign, Handshake, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, RotateCcw, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import type { Deal, Contact } from "@shared/schema";

type ViewType = "card" | "table";
type SortColumn = "title" | "value" | "expectedCloseDate" | "stage" | "contact" | "probability";
type SortDirection = "asc" | "desc";

export default function Deals() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | undefined>();
  const [viewType, setViewType] = useState<ViewType>("table");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const { data: deals, isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
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

  const getContactName = (contactId: string | null) => {
    if (!contactId || !contacts) return "No contact";
    const contact = contacts.find(c => c.id === contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : "Unknown contact";
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

  const isDateExpired = (date: string | Date | null) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const closeDate = new Date(date);
    closeDate.setHours(0, 0, 0, 0);
    return closeDate < today;
  };

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
        <Header title="Deals" onAddNew={() => setIsFormOpen(true)} />
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
        title="Deals" 
        onAddNew={() => setIsFormOpen(true)}
        customActions={
          <div className="flex gap-2">
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
                      <Badge className={getStageColor(deal.stage)}>
                        {deal.stage.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>

                    <div className="pt-2 border-t border-border">
                      <p className="text-sm text-muted-foreground">
                        Contact: {getContactName(deal.contactId)}
                      </p>
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
                      <TableCell className="font-medium">
                        {deal.title}
                      </TableCell>
                      <TableCell>{formatCurrency(deal.value)}</TableCell>
                      <TableCell>{formatDate(deal.expectedCloseDate)}</TableCell>
                      <TableCell>
                        <Badge className={getStageColor(deal.stage)}>
                          {deal.stage.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{getContactName(deal.contactId)}</TableCell>
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
    </>
  );
}
