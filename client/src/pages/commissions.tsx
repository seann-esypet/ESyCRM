import { useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, CheckCircle2, TrendingUp, Calendar, RefreshCw } from "lucide-react";
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

export default function Commissions() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";

  const { data: commissions, isLoading } = useQuery<EnrichedCommission[]>({
    queryKey: ["/api/commissions"],
  });

  const totalUpfront = commissions?.reduce((sum, c) => sum + parseFloat(c.upfrontAmount || "0"), 0) || 0;
  const totalMonthly = commissions?.reduce((sum, c) => sum + parseFloat(c.monthlyAmount || "0"), 0) || 0;

  const thisMonthCommissions = commissions?.filter(c => {
    if (!c.confirmedAt) return false;
    const d = new Date(c.confirmedAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }) || [];
  const thisMonthTotal = thisMonthCommissions.reduce((sum, c) => sum + parseFloat(c.upfrontAmount || "0"), 0);

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
          <Card data-testid="total-commission-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Upfront Earned</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${totalUpfront.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-full">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">One-time upfront payments (90%)</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="monthly-commission-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Monthly Recurring</p>
                  <p className="text-3xl font-bold text-foreground">
                    ${totalMonthly.toFixed(2)}<span className="text-base font-normal text-muted-foreground">/mo</span>
                  </p>
                </div>
                <div className="p-3 bg-blue-500/10 rounded-full">
                  <RefreshCw className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className="text-muted-foreground">Recurring monthly (10% per deal)</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="month-commission-card">
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
                <span className="text-muted-foreground">{thisMonthCommissions.length} deal{thisMonthCommissions.length !== 1 ? "s" : ""} this month</span>
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
                All won deals with commission breakdown
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
                    <TableHead className="text-right">Monthly (10%)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissions.map((c) => (
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
                      <TableCell className="text-right font-semibold text-blue-600">
                        ${parseFloat(c.monthlyAmount).toFixed(2)}/mo
                      </TableCell>
                    </TableRow>
                  ))}
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
