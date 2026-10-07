import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage, SalonOwnerNameStorageConflict, type IStorage } from "./storage";
import { estimateSalonOwnerNameSearch, getSalonOwnerNameResult, lookupSalonOwnerNameBatch } from "./salonOwnerNames";
import { EMPTY_OWNER_NAME_RESULT } from "@shared/salonOwnerName";
import { contactOwnerLookupMatches } from "@shared/contactOwnerLookup";
import { renderLeadSequencePreview } from "./leadSequencePreview";

type Repository = Pick<IStorage, "getContact" | "getContactOwnerNameRow" | "ensureContactOwnerNameRow" |
  "reviewSalonOwnerName" | "applySalonOwnerName" | "getEmailSequence" | "getUser">;
const phraseInput = z.object({ searchesPerRow: z.union([z.literal(1), z.literal(3)]).default(3) });
const searchInput = phraseInput.extend({
  confirmed: z.literal(true), maxProviderCalls: z.number().int().min(0).max(3),
}).refine(input => input.maxProviderCalls <= input.searchesPerRow, "Allowance exceeds the phrase limit");
class LookupError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Legacy CRM Contacts use the same bounded lookup and evidence approval as Leads.
 * Internal evidence rows are never placed in the uploaded-list/research queue.
 */
export function registerContactOwnerNameRoutes(
  app: Express, authenticated: RequestHandler,
  deps: { repository: Repository; estimate: typeof estimateSalonOwnerNameSearch; search: typeof lookupSalonOwnerNameBatch } = {
    repository: storage, estimate: estimateSalonOwnerNameSearch, search: lookupSalonOwnerNameBatch,
  },
) {
  const inFlight = new Set<string>();
  const root = "/api/contacts/:id/owner-name";
  const route = (method: "get" | "post" | "patch", path: string, action: (req: any) => Promise<unknown>) => {
    app[method](path, authenticated, async (req, res) => {
      try { res.json(await action(req)); }
      catch (error) {
        const status = error instanceof LookupError ? error.status :
          error instanceof SalonOwnerNameStorageConflict ? 409 : error instanceof z.ZodError ? 400 : 500;
        res.status(status).json({ message: error instanceof Error ? error.message : "Contact name lookup failed" });
      }
    });
  };
  const ownedContact = async (req: any) => {
    const contact = await deps.repository.getContact(req.params.id,
      req.user.role === "admin" ? null : req.user.claims.sub);
    if (!contact || contact.archivedAt) throw new LookupError(404, "Contact unavailable or not owned by you");
    return contact;
  };
  const context = async (req: any, prepare = false) => {
    const contact = await ownedContact(req);
    if (prepare && !contact.company?.trim()) {
      throw new LookupError(400, "Add the business name to this Contact before searching for its owner.");
    }
    const row = prepare
      ? await deps.repository.ensureContactOwnerNameRow(contact.id, contact.userId)
      : await deps.repository.getContactOwnerNameRow(contact.id, contact.userId);
    if (prepare && !row) throw new LookupError(404, "Contact unavailable");
    return { contact, row };
  };
  route("get", root, async req => {
    const { contact, row } = await context(req);
    return {
      rowId: row?.id ?? null,
      ownerName: row && contactOwnerLookupMatches(row, contact)
        ? getSalonOwnerNameResult(row) : { ...EMPTY_OWNER_NAME_RESULT },
    };
  });
  route("post", `${root}/estimate`, async req => {
    const input = phraseInput.parse(req.body);
    const { row } = await context(req, true);
    return deps.estimate([row!], input.searchesPerRow);
  });
  route("post", `${root}/search`, async req => {
    const input = searchInput.parse(req.body);
    const contact = await ownedContact(req);
    if (inFlight.has(contact.id)) throw new LookupError(409, "A name search is already running for this Contact.");
    inFlight.add(contact.id);
    try {
      const { row } = await context(req, true);
      const estimate = await deps.estimate([row!], input.searchesPerRow);
      if (!estimate.allowed || input.maxProviderCalls > estimate.maxProviderCalls) {
        throw new LookupError(409, estimate.reason || "The search allowance changed. Request a fresh estimate.");
      }
      // Always run as the Contact's actual owner after authorizing the actor;
      // administrators may manage another salesperson's Contact safely.
      return await deps.search([row!], contact.userId, input.maxProviderCalls, input.searchesPerRow);
    } finally { inFlight.delete(contact.id); }
  });
  route("patch", `${root}/review`, async req => {
    const input = z.object({
      candidateId: z.string().min(1), decision: z.enum(["approved", "rejected"]), usePersonalName: z.boolean(),
    }).parse(req.body);
    const { contact, row } = await context(req);
    if (!row) throw new LookupError(404, "Search for a name before reviewing it.");
    if (!contactOwnerLookupMatches(row, contact)) throw new LookupError(409, "Business details changed. Search again before saving a name.");
    const result = await deps.repository.reviewSalonOwnerName(row.id, contact.userId, input);
    if (result.error) throw new LookupError(result.error.status, result.error.message);
    return { ownerName: result.row && getSalonOwnerNameResult(result.row) };
  });
  route("post", `${root}/apply`, async req => {
    const input = z.object({ overwriteExisting: z.boolean(), usePersonalName: z.boolean() }).parse(req.body);
    const { contact, row } = await context(req);
    if (!row) throw new LookupError(404, "Search and approve a name before applying it.");
    if (!contactOwnerLookupMatches(row, contact)) throw new LookupError(409, "Business details changed. Search again before saving a name.");
    const result = await deps.repository.applySalonOwnerName(row.id, contact.userId, input);
    if (result.error) throw new LookupError(result.error.status, result.error.message);
    return { contact: result.contact, ownerName: result.row && getSalonOwnerNameResult(result.row) };
  });
  route("post", `${root}/preview`, async req => {
    const input = z.object({
      sequenceId: z.string().min(1), customSubject: z.string().max(1000).optional(),
      customBody: z.string().max(100000).optional(),
    }).parse(req.body);
    const contact = await ownedContact(req);
    const sequence = await deps.repository.getEmailSequence(input.sequenceId,
      req.user.role === "admin" ? null : req.user.claims.sub);
    if (!sequence) throw new LookupError(404, "Sequence unavailable or not owned by you");
    const sender = await deps.repository.getUser(req.user.claims.sub);
    if (!sender) throw new LookupError(404, "Your sender profile is unavailable");
    const previewSequence = sequence.sequenceTrack === "custom" ? {
      ...sequence, subject: input.customSubject ?? sequence.subject, body: input.customBody ?? sequence.body,
    } : sequence;
    return renderLeadSequencePreview(previewSequence, contact, sender);
  });
}
