import { z } from "zod";

const answerSchema = z.enum(["Yes", "No", "Unknown"]);
const sourceSchema = z.object({
  url: z.string().url().refine(url => /^https?:\/\//i.test(url)),
  excerpt: z.string().max(1200),
  answer: z.enum(["Yes", "No"]),
});
const findingSchema = z.object({
  answer: answerSchema,
  reason: z.string(),
  sources: z.array(sourceSchema).max(8),
});
export const groomingChecksSchema = z.object({
  version: z.literal(1),
  identity: z.object({ businessName: z.string(), address: z.string(), state: z.string() }),
  checkedAt: z.string().datetime(),
  offersGrooming: findingSchema,
  groomingShop: findingSchema,
  businessType: z.string(),
  providerCalls: z.number().int().nonnegative(),
  pagesFetched: z.number().int().nonnegative(),
  notes: z.array(z.string()).max(12),
  aiAnswers: z.array(z.object({
    question: z.enum(["services", "shop"]),
    text: z.string().max(4000),
    sourceUrl: z.string().url().refine(url => /^https?:\/\//i.test(url)),
    citations: z.array(z.string().url().refine(url => /^https?:\/\//i.test(url))).max(6),
  })).max(4).default([]),
});
export type GroomingChecks = z.infer<typeof groomingChecksSchema>;
export type GroomingFinding = GroomingChecks["offersGrooming"];
export type GroomingIdentity = { businessName: string; address?: string | null; state?: string | null };
export function groomingIdentity(row: GroomingIdentity) {
  return { businessName: row.businessName, address: row.address || "", state: row.state || "" };
}
export function readGroomingChecks(value: unknown, row: GroomingIdentity): GroomingChecks | null {
  const parsed = groomingChecksSchema.safeParse(value);
  if (!parsed.success) return null;
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  const identity = groomingIdentity(row);
  if (Object.keys(identity).some(key =>
    normalize(identity[key as keyof typeof identity]) !== normalize(parsed.data.identity[key as keyof typeof identity]))) return null;
  return parsed.data;
}
