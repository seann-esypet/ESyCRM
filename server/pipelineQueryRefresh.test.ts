import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { refreshPipelineQueries } from "../client/src/lib/pipeline-query-refresh";

test("returning to Pipeline clears every cached owner scope and fetches fresh status with infinite stale time", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  const roots = ["/api/deals", "/api/deals/email-summaries", "/api/contacts", "/api/deals/unread-replies"];
  try {
    for (const root of roots) {
      for (const owner of ["", "fixture-owner"]) client.setQueryData([root, owner], "stale");
    }
    client.setQueryData(["/api/deal-workspace", "fixture"], "keep workspace");
    client.setQueryData(["/api/auth/user"], "keep session");
    const reset = refreshPipelineQueries(client);
    for (const root of roots) {
      for (const owner of ["", "fixture-owner"]) assert.equal(client.getQueryData([root, owner]), undefined);
    }
    await reset;
    const fresh = await client.fetchQuery({
      queryKey: ["/api/deals/email-summaries", ""],
      queryFn: async () => ({ fixture: { sequenceStatus: "scheduled" } }),
    });
    assert.equal(fresh.fixture.sequenceStatus, "scheduled");
    assert.equal(client.getQueryData(["/api/deal-workspace", "fixture"]), "keep workspace");
    assert.equal(client.getQueryData(["/api/auth/user"]), "keep session");
  } finally { client.clear(); }
});

test("an older in-flight response cannot restore the stale status after returning to Pipeline", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  const key = ["/api/deals/email-summaries", "fixture-owner"];
  let finishOld!: (value: string) => void;
  try {
    const oldRequest = client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<string>(resolve => { finishOld = resolve; }),
    }).catch(() => undefined);
    await refreshPipelineQueries(client);
    await client.fetchQuery({ queryKey: key, queryFn: async () => "Scheduled" });
    finishOld("Not in a sequence");
    await oldRequest;
    assert.equal(client.getQueryData(key), "Scheduled");
  } finally { client.clear(); }
});