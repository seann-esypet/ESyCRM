import type { QueryClient } from "@tanstack/react-query";

// Clear cached list data before returning so navigation fetches fresh results,
// even with the app's infinite stale time. Reset also cancels older requests.
export function refreshPipelineQueries(client: QueryClient) {
  return Promise.all([
    "/api/deals",
    "/api/deals/email-summaries",
    "/api/contacts",
    "/api/deals/unread-replies",
  ].map(key => client.resetQueries({ queryKey: [key] })));
}