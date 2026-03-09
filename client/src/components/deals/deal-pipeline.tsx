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
      case "new_lead_unqualified": return "bg-gray-400";
      case "qualified_lead": return "bg-blue-500";
      case "contacted_emailed": return "bg-sky-500";
      case "contacted_phone_spoke_decision_maker": return "bg-teal-500";
      case "contacted_phone_spoke_non_decision_maker": return "bg-cyan-500";
      case "contacted_phone_left_message": return "bg-yellow-500";
      case "trial_period_started": return "bg-indigo-500";
      case "pending_commitment": return "bg-purple-500";
      case "in_negotiation": return "bg-orange-500";
      case "won": return "bg-emerald-500";
      case "lost": return "bg-red-500";
      default: return "bg-muted";
    }
  };

  const getStageLabel = (stage: string) => {
    switch (stage) {
      case "new_lead_unqualified": return "New Lead Unqualified";
      case "qualified_lead": return "Qualified Lead";
      case "contacted_emailed": return "Contacted - Emailed";
      case "contacted_phone_spoke_decision_maker": return "Contacted - Phone Spoke To Decision Maker";
      case "contacted_phone_spoke_non_decision_maker": return "Contacted - Phone Spoke To Non-Decision Maker";
      case "contacted_phone_left_message": return "Contacted - Phone Left Message";
      case "trial_period_started": return "Trial Period Started";
      case "pending_commitment": return "Pending Commitment";
      case "in_negotiation": return "In Negotiation";
      case "won": return "Won";
      case "lost": return "Lost";
      default: return stage;
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
