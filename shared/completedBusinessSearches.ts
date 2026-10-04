export type BusinessSearchJob = {
  id: string; name?: string; query?: string; title?: string; state?: string; status?: string;
  zipCodes?: string; nationalJobId?: string | null; targetStates?: string;
  totalBusinessesFound?: number; leadsFound?: number; statesTotal?: number;
  resultCount?: number; totalResults?: number; createdAt?: string;
};
export type CompletedSearch = {
  job: BusinessSearchJob; title: string; resultCount: number | null;
  kind: "ZIP search" | "Nationwide search"; children: CompletedSearch[];
};
const completed = (job: BusinessSearchJob) => /^(completed|complete|finished)$/i.test(job.status || "");
function count(...values: unknown[]): number | null {
  return values.find(value => typeof value === "number" && Number.isFinite(value) && value >= 0) as number | undefined ?? null;
}
function describe(job: BusinessSearchJob, national: boolean): CompletedSearch {
  const locations = (national ? job.targetStates : job.zipCodes)?.split(/[,\s]+/).filter(Boolean) || [];
  const area = national ? locations.length ? `${locations.length} states` : `${job.statesTotal ?? "all"} states`
    : [job.state, locations.length ? `ZIP ${locations.slice(0, 3).join(", ")}${locations.length > 3 ? ` +${locations.length - 3} more` : ""}` : ""].filter(Boolean).join(" · ");
  return {
    job, kind: national ? "Nationwide search" : "ZIP search",
    title: job.name || job.query || job.title || (national ? `Nationwide search · ${area}` : area || "Saved ZIP search"),
    resultCount: national ? count(job.leadsFound, job.resultCount, job.totalResults)
      : count(job.totalBusinessesFound, job.resultCount, job.totalResults),
    children: [],
  };
}
export function completedBusinessSearches(jobs: BusinessSearchJob[], nationalJobs: BusinessSearchJob[]): CompletedSearch[] {
  const groups = nationalJobs.filter(completed).map(job => describe(job, true));
  const parents = new Map(groups.map(group => [group.job.id, group]));
  for (const job of jobs.filter(completed)) {
    const entry = describe(job, false), parent = job.nationalJobId ? parents.get(job.nationalJobId) : undefined;
    if (parent) parent.children.push(entry);
    else groups.push(entry);
  }
  return groups.sort((a, b) => (b.job.createdAt || "").localeCompare(a.job.createdAt || ""));
}