import { useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, CheckCircle2, TrendingUp, Calendar } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Deal } from "@shared/schema";
import { calculateCommission } from "@shared/utils";
import { format } from "date-fns";

export default function Commissions() {
  const { data: approvedDeals, isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/commissions"],
  });

  // Calculate total commission
  const totalCommission = approvedDeals?.reduce((sum, deal) => {
    return sum + calculateCommission(deal.plan);
  }, 0) || 0;

  // Calculate this month's commission
  const thisMonthCommission = approvedDeals?.filter(deal => {
    if (!deal.createdAt) return false;
    const dealDate = new Date(deal.createdAt);
    const now = new Date();
    return dealDate.getMonth() === now.getMonth() && dealDate.getFullYear() === now.getFullYear();
  }).reduce((sum, deal) => sum + calculateCommission(deal.plan), 0) || 0;

  if (isLoading) {
    return (
      <>
        <Header title="My Commissions" showAddButton={false} />
        <main className="flex-1 overflow-y-auto p-6 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="h-4 bg-muted rounded w-24"></div>
                    <div className="h-8 bg-muted rounded w-16"></div>
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
      <Header title="My Commissions" showAddButton={false} />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="commissions-content">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card data-testid="total-commission-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Commission</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${totalCommission.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-full">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">All time earnings</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="month-commission-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">This Month</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${thisMonthCommission.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 bg-primary/10 rounded-full">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Current month earnings</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="approved-deals-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Approved Deals</p>
                  <p className="text-3xl font-bold text-foreground">
                    {approvedDeals?.length || 0}
                  </p>
                </div>
                <div className="p-3 bg-accent/10 rounded-full">
                  <CheckCircle2 className="h-6 w-6 text-accent" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Commission approved</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Commission Details Table */}
        {approvedDeals && approvedDeals.length > 0 ? (
          <Card data-testid="commission-details-table">
            <CardHeader>
              <CardTitle className="text-xl font-semibold flex items-center space-x-2">
                <TrendingUp className="h-6 w-6" />
                <span>Commission Details</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                All approved commissions from closed deals
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal Title</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Closed Date</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedDeals.map((deal) => {
                    const commission = calculateCommission(deal.plan);
                    return (
                      <TableRow key={deal.id} data-testid={`commission-row-${deal.id}`}>
                        <TableCell className="font-medium">{deal.title}</TableCell>
                        <TableCell>{deal.plan || "N/A"}</TableCell>
                        <TableCell>
                          {deal.createdAt ? format(new Date(deal.createdAt), "MMM d, yyyy") : "N/A"}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-green-600">
                          ${commission.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-2">No commissions yet</h3>
              <p className="text-muted-foreground">
                Close deals and wait for admin approval to see your commissions here.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
