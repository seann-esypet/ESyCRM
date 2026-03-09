import { useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, Calendar, RefreshCw, Award } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

type EnrichedCommission = {
  id: string;
  dealId: string;
  userId: string;
  planName: string;
  upfrontAmount: string;
  monthlyAmount: string;
  confirmedAt: string | null;
  dealTitle: string;
  salespersonName: string;
};

type MonthlyPayment = {
  id: string;
  commissionId: string;
  dealId: string;
  userId: string;
  amount: string;
  periodNumber: number;
  paidAt: string;
};

export default function Commissions() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";

  const { data: commissions, isLoading } = useQuery<EnrichedCommission[]>({
    queryKey: ["/api/commissions"],
  });

  const { data: monthlyPayments } = useQuery<MonthlyPayment[]>({
    queryKey: ["/api/commissions/monthly-payments"],
  });

  const totalUpfront = commissions?.reduce((sum, c) => sum + parseFloat(c.upfrontAmount || "0"), 0) || 0;
  const totalMonthlyRate = commissions?.reduce((sum, c) => sum + parseFloat(c.monthlyAmount || "0"), 0) || 0;
  const totalMonthlyAccumulated = monthlyPayments?.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0) || 0;
  const totalEarned = totalUpfront + totalMonthlyAccumulated;

  const now = new Date();
  const thisMonthPayments = monthlyPayments?.filter((p) => {
    const d = new Date(p.paidAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }) || [];
  const thisMonthUpfront = commissions?.filter((c) => {
    if (!c.confirmedAt) return false;
    const d = new Date(c.confirmedAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((sum, c) => sum + parseFloat(c.upfrontAmount || "0"), 0) || 0;
  const thisMonthTotal = thisMonthPayments.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0) + thisMonthUpfront;

  function getMonthlyCountForCommission(commissionId: string) {
    return monthlyPayments?.filter((p) => p.commissionId === commissionId).length || 0;
  }

  function getMonthlyEarnedForCommission(commissionId: string) {
    return monthlyPayments
      ?.filter((p) => p.commissionId === commissionId)
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0) || 0;
  }

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
      <Header title={isAdmin ? "All Commissions" : "My Commissions"} showAddButton={false} />

      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="commissions-content">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card data-testid="total-earned-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Earned to Date</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${totalEarned.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-full">
                  <Award className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Upfront (one-time 90%)</span>
                  <span className="font-medium">${totalUpfront.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Monthly accumulated (10%)</span>
                  <span className="font-medium text-blue-600">+${totalMonthlyAccumulated.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="monthly-rate-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Monthly Recurring Rate</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${totalMonthlyRate.toFixed(2)}<span className="text-base font-normal text-muted-foreground">/mo</span>
                  </p>
                </div>
                <div className="p-3 bg-blue-500/10 rounded-full">
                  <RefreshCw className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Added every 30 days per active deal (10%)</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="this-month-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">This Month</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${thisMonthTotal.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 bg-primary/10 rounded-full">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">{thisMonthPayments.length} recurring + new deals</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Commission Details Table */}
        {commissions && commissions.length > 0 ? (
          <Card data-testid="commission-details-table">
            <CardHeader>
              <CardTitle className="text-xl font-semibold flex items-center space-x-2">
                <TrendingUp className="h-6 w-6" />
                <span>Commission Details</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                Won deals — 90% upfront on close, then 10% added every 30 days
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    {isAdmin && <TableHead>Salesperson</TableHead>}
                    <TableHead>Plan</TableHead>
                    <TableHead>Won Date</TableHead>
                    <TableHead className="text-right">Upfront (90%)</TableHead>
                    <TableHead className="text-right">Rate/mo (10%)</TableHead>
                    <TableHead className="text-right">Months Paid</TableHead>
                    <TableHead className="text-right">Total Earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissions.map((c) => {
                    const monthsPaid = getMonthlyCountForCommission(c.id);
                    const monthlyEarned = getMonthlyEarnedForCommission(c.id);
                    const dealTotal = parseFloat(c.upfrontAmount) + monthlyEarned;
                    return (
                      <TableRow key={c.id} data-testid={`commission-row-${c.id}`}>
                        <TableCell className="font-medium">{c.dealTitle}</TableCell>
                        {isAdmin && <TableCell>{c.salespersonName}</TableCell>}
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            c.planName.includes("Solo") ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" :
                            c.planName.includes("Salon") ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                            "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                          }`}>
                            {c.planName}
                          </span>
                        </TableCell>
                        <TableCell>
                          {c.confirmedAt ? format(new Date(c.confirmedAt), "MMM d, yyyy") : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-green-600">
                          ${parseFloat(c.upfrontAmount).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-blue-600">
                          ${parseFloat(c.monthlyAmount).toFixed(2)}/mo
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {monthsPaid}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          ${dealTotal.toFixed(2)}
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
                Mark deals as Won and confirm the plan to see commissions here.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
