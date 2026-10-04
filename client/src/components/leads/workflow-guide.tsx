import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  { title: "Add Leads", description: "Search for businesses or stage a source list." },
  { title: "Find Contact Details", description: "Start research only after reviewing its bounded estimate." },
  { title: "Review", description: "Inspect evidence and confirm email and identity separately." },
  { title: "Add to CRM", description: "Move an approved contact into Contacts, then Pipeline when ready." },
];

export function LeadWorkflowGuide() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">A clear path from lead to customer</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-3 text-sm">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
              <span><b>{step.title}</b><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{step.description}</span></span>
            </li>
          ))}
        </ol>
        <div className="mt-4 border-t pt-3">
          <p className="text-xs text-muted-foreground">Contacts are records. Pipeline tracks sales progress. Outreach handles separate scheduling; no email is sent from this review.</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/contacts" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Contacts <ArrowRight className="h-3 w-3" /></Link>
            <Link href="/deals" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Pipeline <ArrowRight className="h-3 w-3" /></Link>
            <Link href="/email-sequences" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Outreach <ArrowRight className="h-3 w-3" /></Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}