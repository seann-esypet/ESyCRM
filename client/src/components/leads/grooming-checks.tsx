import { readGroomingChecks, type GroomingIdentity } from "@shared/groomingChecks";
import { Badge } from "@/components/ui/badge";

export function GroomingChecksPanel({ row }: { row: GroomingIdentity & { evidence?: any } }) {
  const result = readGroomingChecks(row.evidence?.groomingChecks, row);
  return <section aria-label="Grooming business checks" className="rounded-lg border-2 border-slate-400 dark:border-slate-600 p-3 space-y-3">
    <div><h4 className="font-medium">Grooming business checks</h4>
      <p className="text-xs text-muted-foreground">Evidence for this business and address—not automatic approval or exclusion.</p></div>
    {(["offersGrooming", "groomingShop"] as const).map(key => {
      const finding = result?.[key];
      return <div key={key} data-testid={`grooming-${key}`} className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{key === "offersGrooming" ? "Offers pet grooming services" : "Is a dedicated grooming shop"}</span>
          <Badge variant="outline" className={finding?.answer === "Yes" ? "border-green-700 text-green-800 bg-green-50 dark:text-green-200 dark:bg-green-950" :
            finding?.answer === "No" ? "border-red-700 text-red-800 bg-red-50 dark:text-red-200 dark:bg-red-950" : "border-amber-700 text-amber-900 bg-amber-50 dark:text-amber-200 dark:bg-amber-950"}>{finding?.answer || "Unknown"}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{finding?.reason || "Not checked for the current business and address. Run Full Research to collect evidence."}</p>
        {!!finding?.sources.length && <details><summary className="cursor-pointer text-sm">Supporting sources ({finding.sources.length})</summary>
          <ul className="mt-2 space-y-2">{finding.sources.map((source, index) => <li key={`${source.url}-${index}`} className="rounded border p-2 text-xs">
            <a className="underline break-all" href={source.url} target="_blank" rel="noopener noreferrer">View source · {source.answer}</a>
            <blockquote className="mt-1 whitespace-pre-wrap break-words text-foreground">{source.excerpt}</blockquote>
          </li>)}</ul>
        </details>}
      </div>;
    })}
    <div data-testid="grooming-ai-answers" className="rounded-md border-2 border-slate-300 dark:border-slate-600 bg-muted/30 p-2 text-xs space-y-2">
      <p className="font-semibold text-foreground">Google AI answers — unverified hints</p>
      <p>We look for AI Overviews returned by search and check their cited pages. AI text alone never decides these results. No direct Gemini API calls are enabled.</p>
      {result?.aiAnswers.length ? result.aiAnswers.map((answer, index) => <div key={index} className="space-y-1">
        <p className="font-semibold">{answer.question === "services" ? "Offers grooming services?" : "Is a grooming shop?"}</p>
        <blockquote className="whitespace-pre-wrap break-words text-foreground">{answer.text}</blockquote>
        <a href={answer.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">View Google AI search</a>
        {answer.citations.map(url => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">AI citation: {url}</a></p>)}
      </div>) : <p>No Google AI answer has been returned for these checks. Availability varies; this is not a No result.</p>}
    </div>
    {result && <div className="text-xs text-muted-foreground space-y-1">
      <p>Business type: {result.businessType} · Checked {new Date(result.checkedAt).toLocaleString()}</p>
      <p>{result.providerCalls} provider requests during this check · {result.pagesFetched} pages available for checking</p>
      {result.notes.map((note, index) => <p key={index}>{note}</p>)}
    </div>}
  </section>;
}
