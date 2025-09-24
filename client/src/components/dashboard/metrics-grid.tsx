import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Handshake, DollarSign, CheckCircle } from "lucide-react";

interface DashboardMetrics {
  totalContacts: number;
  activeDeals: number;
  monthlyRevenue: number;
  tasksCompleted: number;
}

export default function MetricsGrid() {
  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const metricCards = [
    {
      title: "Total Contacts",
      value: metrics?.totalContacts || 0,
      icon: Users,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      change: "+12%",
      changeColor: "text-accent",
    },
    {
      title: "Active Deals",
      value: metrics?.activeDeals || 0,
      icon: Handshake,
      iconBg: "bg-accent/10",
      iconColor: "text-accent",
      change: "+5%",
      changeColor: "text-accent",
    },
    {
      title: "Monthly Revenue",
      value: formatCurrency(metrics?.monthlyRevenue || 0),
      icon: DollarSign,
      iconBg: "bg-accent/10",
      iconColor: "text-accent",
      change: "+18%",
      changeColor: "text-accent",
    },
    {
      title: "Tasks Completed",
      value: metrics?.tasksCompleted || 0,
      icon: CheckCircle,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      change: "-2%",
      changeColor: "text-destructive",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-24"></div>
                  <div className="h-8 bg-muted rounded w-16"></div>
                </div>
                <div className="w-12 h-12 bg-muted rounded-full"></div>
              </div>
              <div className="mt-4 flex items-center">
                <div className="h-4 bg-muted rounded w-20"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" data-testid="metrics-grid">
      {metricCards.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.title} data-testid={`metric-card-${index}`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {metric.title}
                  </p>
                  <p className="text-3xl font-bold text-foreground" data-testid={`metric-value-${index}`}>
                    {metric.value}
                  </p>
                </div>
                <div className={`p-3 ${metric.iconBg} rounded-full`}>
                  <Icon className={`${metric.iconColor} h-6 w-6`} />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className={`${metric.changeColor} mr-1`}>
                  {metric.change}
                </span>
                <span className="text-muted-foreground">from last month</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
