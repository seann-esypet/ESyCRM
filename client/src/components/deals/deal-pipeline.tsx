import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PipelineStage {
  stage: string;
  count: number;
  value: number;
}

export default function DealPipeline() {
  const { data: pipeline, isLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/dashboard/pipeline"],
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "new_lead_unqualified":
        return "bg-blue-500";
      case "qualified_lead":
        return "bg-green-500";
      case "contacted_left_message":
        return "bg-cyan-500";
      case "contacted_spoke_to_decision_maker":
        return "bg-teal-500";
      case "onboarded_form_completed":
        return "bg-indigo-500";
      case "demo_scheduled":
        return "bg-purple-500";
      case "demo_completed":
        return "bg-yellow-500";
      case "decision_pending":
        return "bg-orange-500";
      case "won":
        return "bg-emerald-500";
      case "lost":
        return "bg-red-500";
      default:
        return "bg-muted";
    }
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
        return stage;
    }
  };

  return (
    <Card data-testid="deal-pipeline-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">Deal Pipeline</CardTitle>
        <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
          View All
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-muted rounded-lg"></div>
              </div>
            ))}
          </div>
        ) : !pipeline?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No pipeline data available</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pipeline.map((stage) => (
              <div
                key={stage.stage}
                className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                data-testid={`pipeline-stage-${stage.stage}`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 ${getStageColor(stage.stage)} rounded-full`}></div>
                  <span className="font-medium text-foreground">
                    {getStageLabel(stage.stage)}
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    {stage.count} deal{stage.count !== 1 ? 's' : ''}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(stage.value)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
