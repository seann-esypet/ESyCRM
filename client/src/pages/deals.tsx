import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import DealForm from "@/components/deals/deal-form";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Calendar, DollarSign, Handshake } from "lucide-react";
import type { Deal, Contact } from "@shared/schema";

export default function Deals() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | undefined>();

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
      case "lead":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "qualified":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "proposal":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "negotiation":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "closed_won":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300";
      case "closed_lost":
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

  const handleEdit = (deal: Deal) => {
    setSelectedDeal(deal);
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this deal?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedDeal(undefined);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {deals.map((deal) => (
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
