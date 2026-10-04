import { completedBusinessSearches, type BusinessSearchJob, type CompletedSearch } from "@shared/completedBusinessSearches";
import { Button } from "@/components/ui/button";

export function CompletedSearches({ jobs, nationalJobs, savingId, disabled, onSave }: {
  jobs: BusinessSearchJob[]; nationalJobs: BusinessSearchJob[];
  savingId?: string; disabled: boolean; onSave: (id: string) => void;
}) {
  const searches = completedBusinessSearches(jobs, nationalJobs);
  function item(search: CompletedSearch) {
    return <div className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div>
        <p className="font-medium">{search.title}</p>
        <p className="text-xs text-muted-foreground">
          {search.kind} · {search.resultCount === null ? "Result count not recorded" : `${search.resultCount} saved business${search.resultCount === 1 ? "" : "es"}`}
          {search.job.createdAt && ` · ${new Date(search.job.createdAt).toLocaleString()}`}
        </p>
        {search.resultCount === 0 && <p className="mt-1 text-xs text-muted-foreground">No businesses were found in this search.</p>}
      </div>
      <Button size="sm" variant="outline" disabled={disabled || search.resultCount === 0}
        onClick={() => onSave(search.job.id)}>{savingId === search.job.id ? "Saving…" : "Save in Leads"}</Button>
    </div>;
  }
  return <div className="space-y-2">
    {searches.length === 0 && <p className="text-sm text-muted-foreground">No completed searches yet.</p>}
    {searches.map(search => <div key={search.job.id} className="rounded-lg border bg-card">
      {item(search)}
      {search.children.length > 0 && <details className="border-t">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">View {search.children.length} state searches included in this nationwide run</summary>
        <div className="divide-y border-t">{search.children.map(child => <div key={child.job.id}>{item(child)}</div>)}</div>
      </details>}
    </div>)}
  </div>;
}