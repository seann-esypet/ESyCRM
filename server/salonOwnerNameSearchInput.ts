import { z } from "zod";

export const ownerNameRowsInput = z.object({
  rowIds: z.array(z.string().min(1)).min(1).max(5),
  searchesPerRow: z.union([z.literal(1), z.literal(3)]).default(1),
}).refine(input => new Set(input.rowIds).size === input.rowIds.length, {
  message: "rowIds must be unique",
});

export const ownerNameSearchInput = z.object({
  rowIds: z.array(z.string().min(1)).min(1).max(5),
  searchesPerRow: z.union([z.literal(1), z.literal(3)]).default(1),
  maxProviderCalls: z.number().int().min(0).max(15),
  confirmed: z.literal(true),
}).refine(input => new Set(input.rowIds).size === input.rowIds.length, {
  message: "rowIds must be unique",
}).refine(input => input.maxProviderCalls <= input.rowIds.length * input.searchesPerRow, {
  message: "The paid-search allowance exceeds the selected phrase limit",
});