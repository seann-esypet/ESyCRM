// From Replit Auth blueprint
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { insertContactSchema, insertContactGroupSchema, insertDealSchema, insertTaskSchema, insertEmailSequenceSchema, insertLeadDiscoveryJobSchema, insertCommissionSchema, type InsertContact } from "@shared/schema";
import { getCommissionAmounts } from "@shared/utils";
import { z } from "zod";
import Papa from "papaparse";
import { runLeadDiscoveryJob, importResultsToCRM, runNationalSearchJob } from "./lead-discovery";
import * as XLSX from "xlsx";
import { sendDailyReport } from "./dailyReportScheduler";
import { sendReplyNotificationEmail, sendEmail, replaceTemplateVariables } from "./sendgrid";
import { format as fmtDate } from "date-fns";

// ─── Sequence Test Runner (in-memory) ────────────────────────────────────────
interface TestStepResult {
  sequenceNumber: number;
  status: "pending" | "waiting" | "sending" | "sent" | "failed";
  scheduledAt?: Date;
  sentAt?: Date;
  error?: string;
}

interface TestRun {
  id: string;
  adminUserId: string;
  adminEmail: string;
  contactId: string;
  contactName: string;
  track: string;
  toEmail: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  steps: TestStepResult[];
}

const testRuns = new Map<string, TestRun>();

// Minute delays between sequences in test mode
const TEST_WAIT_MINUTES_BEFORE: Record<number, number> = { 2: 7, 3: 7, 4: 30, 5: 30 };

async function runSequenceTest(run: TestRun): Promise<void> {
  try {
    const contact = await storage.getContact(run.contactId, null);
    if (!contact) { run.status = "failed"; return; }
    console.log(`[TEST] Contact fetched: ${contact.firstName} ${contact.lastName} | company="${contact.company}" | email="${contact.email}"`);

    const salesperson = await storage.getUser(run.adminUserId);
    if (!salesperson) { run.status = "failed"; return; }

    const sequences = await storage.getEmailSequencesByTrack(run.adminUserId, run.track as any);

    for (let seqNum = 1; seqNum <= 5; seqNum++) {
      const step = run.steps.find(s => s.sequenceNumber === seqNum);
      if (!step) continue;

      // Wait the required minutes before this sequence (except seq 1)
      const waitMin = TEST_WAIT_MINUTES_BEFORE[seqNum];
      if (waitMin) {
        step.status = "waiting";
        step.scheduledAt = new Date(Date.now() + waitMin * 60 * 1000);
        await new Promise(resolve => setTimeout(resolve, waitMin * 60 * 1000));
      }

      step.status = "sending";
      const seq = sequences.find(s => s.sequenceNumber === seqNum);
      if (!seq) {
        step.status = "failed";
        step.error = `No Sequence ${seqNum} template found for track "${run.track}"`;
        continue;
      }

      const subject = `[TEST Seq ${seqNum}] ` + replaceTemplateVariables(seq.subject, contact, salesperson);
      const body = replaceTemplateVariables(seq.body, contact, salesperson);

      const result = await sendEmail({
        to: run.toEmail,
        subject,
        body,
        fromName: `[TEST] ${salesperson.firstName || "EsyPet"}`,
      });

      if (result.success) {
        step.status = "sent";
        step.sentAt = new Date();
      } else {
        step.status = "failed";
        step.error = result.error;
      }
    }

    run.status = "completed";
    run.completedAt = new Date();

    // Send summary email to admin
    const sent = run.steps.filter(s => s.status === "sent").length;
    const failed = run.steps.filter(s => s.status === "failed").length;
    const summaryLines = run.steps.map(s => {
      if (s.status === "sent") return `  ✓ Email ${s.sequenceNumber}: Sent at ${s.sentAt?.toLocaleString()}`;
      if (s.status === "failed") return `  ✗ Email ${s.sequenceNumber}: FAILED – ${s.error}`;
      return `  - Email ${s.sequenceNumber}: ${s.status}`;
    });

    const summaryBody = [
      `Sequence Test Results`,
      `═══════════════════`,
      `Contact: ${run.contactName}`,
      `Track: ${run.track.includes("salon") ? "Salon" : "Mobile"} - ${run.track.includes("no_software") ? "No Software" : run.track.includes("uses_competitor") ? "Uses Competitor" : "General"}`,
      `Test email sent to: ${run.toEmail}`,
      `Started: ${run.startedAt.toLocaleString()}`,
      `Completed: ${run.completedAt?.toLocaleString()}`,
      ``,
      `Results: ${sent} sent, ${failed} failed`,
      ``,
      ...summaryLines,
      ``,
      `https://EsyPet-CRM.replit.app`,
    ].join("\n");

    await sendEmail({
      to: run.adminEmail,
      subject: `EsyPet Sequence Test Complete – ${sent}/5 sent`,
      body: summaryBody,
    });
  } catch (err) {
    run.status = "failed";
    run.completedAt = new Date();
    console.error("Sequence test runner error:", err);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup auth middleware - From Replit Auth blueprint
  await setupAuth(app);

  // Helper function to get user ID or null for admin (admin sees all data)
  const getUserIdForQuery = (user: any): string | null => {
    return user.role === "admin" ? null : user.claims.sub;
  };

  // Auth routes - From Replit Auth blueprint
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      // Include role from session in response
      const userWithRole = {
        ...user,
        role: req.user.role || user?.role || "salesperson"
      };
      res.json(userWithRole);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch('/api/user/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profileSchema = z.object({
        workEmail: z.string().email().optional().or(z.literal("")),
        replyToEmail: z.string().email().optional().or(z.literal("")),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
      });
      const profileData = profileSchema.parse(req.body);
      const updatedUser = await storage.updateUserProfile(userId, profileData);
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updatedUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Admin: trigger daily report immediately (test)
  app.post('/api/admin/send-daily-report', isAdmin, async (req: any, res) => {
    try {
      const { to } = req.body ?? {};
      const overrideRecipients = to ? [to] : undefined;
      sendDailyReport({ overrideRecipients }).catch(err => console.error("[DailyReport] Test send error:", err));
      res.json({ message: "Daily report queued — check email in a few seconds." });
    } catch (err) {
      res.status(500).json({ message: "Failed to trigger report" });
    }
  });

  // Admin User Management routes - Protected with isAdmin
  app.get('/api/admin/users', isAdmin, async (req: any, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch('/api/admin/users/:id/role', isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const currentUserId = req.user.claims.sub;
      
      if (id === currentUserId) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      
      const roleSchema = z.object({
        role: z.enum(["salesperson", "admin"]),
      });
      const { role } = roleSchema.parse(req.body);
      
      const updatedUser = await storage.updateUserRole(id, role);
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updatedUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid role data", errors: error.errors });
      }
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.post('/api/admin/users', isAdmin, async (req: any, res) => {
    try {
      const createUserSchema = z.object({
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        workEmail: z.string().email().optional().or(z.literal("")),
        replyToEmail: z.string().email().optional().or(z.literal("")),
        role: z.enum(["salesperson", "admin"]).optional(),
      });
      const userData = createUserSchema.parse(req.body);
      
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ message: "A user with this email already exists" });
      }
      
      const newUser = await storage.createUser(userData);

      // Copy all email sequences from the creating admin to the new user
      try {
        const adminId = req.user.claims.sub as string;
        const templateSequences = await storage.getEmailSequences(adminId);
        if (templateSequences.length > 0) {
          for (const seq of templateSequences) {
            await storage.createEmailSequence({
              sequenceTrack: seq.sequenceTrack,
              sequenceNumber: seq.sequenceNumber,
              subject: seq.subject,
              body: seq.body,
              scheduledDate: null, // Reset: new salesperson sets their own send date
              scheduledTime: seq.scheduledTime,
              daysAfterNoReply: seq.daysAfterNoReply,
              isActive: seq.isActive,
            }, newUser.id);
          }
          console.log(`[UserCreate] Copied ${templateSequences.length} email sequences to new user ${newUser.id}`);
        }
      } catch (seqErr) {
        // Non-fatal: log but don't fail the user creation
        console.error("[UserCreate] Failed to copy sequences:", seqErr);
      }

      res.status(201).json(newUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.patch('/api/admin/users/:id', isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const updateUserSchema = z.object({
        email: z.string().email().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        workEmail: z.string().email().optional().nullable(),
        replyToEmail: z.string().email().optional().nullable(),
        role: z.enum(["salesperson", "admin"]).optional(),
      });
      const userData = updateUserSchema.parse(req.body);
      
      // Check if email is being changed and if it conflicts with another user
      if (userData.email) {
        const existingUser = await storage.getUserByEmail(userData.email);
        if (existingUser && existingUser.id !== id) {
          return res.status(400).json({ message: "A user with this email already exists" });
        }
      }
      
      const updatedUser = await storage.updateUserAdmin(id, {
        ...userData,
        workEmail: userData.workEmail === null ? undefined : userData.workEmail,
        replyToEmail: userData.replyToEmail === null ? undefined : userData.replyToEmail,
      });
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updatedUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete('/api/admin/users/:id', isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const force = req.query.force === "true";
      const currentUserId = req.user.claims.sub;
      if (id === currentUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      const deleted = force
        ? await storage.forceDeleteUser(id)
        : await storage.deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      if (error?.code === "23503") {
        return res.status(409).json({
          message: "This user has linked data. Use force delete to remove them and all their data.",
          canForce: true,
        });
      }
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Contacts routes - All protected with isAuthenticated
  app.get("/api/contacts", isAuthenticated, async (req: any, res) => {
    try {
      let userId = getUserIdForQuery(req.user); // null for admin, user ID for salesperson
      const { search, filterUserId, showArchived } = req.query;
      if (filterUserId && req.user.role === "admin") {
        userId = filterUserId as string;
      }
      const archived = showArchived === "true";
      const contacts = search 
        ? await storage.searchContacts(search as string, userId)
        : await storage.getContacts(userId, archived);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.get("/api/contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const contact = await storage.getContact(req.params.id, userId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact" });
    }
  });

  app.post("/api/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const contactData = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(contactData, userId);
      res.status(201).json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid contact data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create contact" });
    }
  });

  app.put("/api/contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const contactData = insertContactSchema.partial().parse(req.body);
      const contact = await storage.updateContact(req.params.id, contactData, userId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid contact data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  app.patch("/api/contacts/:id/assign", isAdmin, async (req: any, res) => {
    try {
      const schema = z.object({ userId: z.string().min(1) });
      const { userId: newUserId } = schema.parse(req.body);
      const updated = await storage.assignContact(req.params.id, newUserId);
      if (!updated) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "userId is required", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to reassign contact" });
    }
  });

  app.patch("/api/contacts/:id/archive", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const updated = await storage.archiveContact(req.params.id, userId);
      if (!updated) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to archive contact" });
    }
  });

  app.patch("/api/contacts/:id/unarchive", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const updated = await storage.unarchiveContact(req.params.id, userId);
      if (!updated) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to unarchive contact" });
    }
  });

  app.patch("/api/contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const contactData = insertContactSchema.partial().parse(req.body);
      const contact = await storage.updateContact(req.params.id, contactData, userId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid contact data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  // Owner name discovery — waterfall: SerpAPI web search → website about-page scrape
  app.post("/api/contacts/:id/discover-owner", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const contact = await storage.getContact(req.params.id, userId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const businessName = contact.company || `${contact.firstName} ${contact.lastName}`.trim();
      if (!businessName) return res.json({ found: false, reason: "No business name on record", steps: [] });

      const city = (contact as any).city || "";
      const serpKey = process.env.SERPAPI_API_KEY;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;

      console.log(`[OwnerDiscovery] Starting search for "${businessName}"${city ? ` in ${city}` : ""}`);
      console.log(`[OwnerDiscovery] SerpAPI: ${serpKey ? "configured" : "NOT configured"} | Claude: ${anthropicKey ? "configured" : "NOT configured"} | Website: ${contact.websiteUrl || "none"} | Email: ${contact.email || "none"}`);

      // Track every step for the response
      const steps: { label: string; result: string }[] = [];

      // ── Helpers ───────────────────────────────────────────────────────────
      const SKIP_WORDS = new Set([
        "The","Our","Your","All","For","With","From","After","When","This","That","Here","We","My","His","Her","Its","Are","Was","Has","Had","Did","And","But","Not","Any","One","Two",
        "Information","About","Business","Details","Location","Hours","Photos","Reviews","Services","Menu","Overview","Contact","Home","Welcome","Please","Thank","Write","Share","Edit","Report","Directions","Website","Address","Email","Phone","Map","More","View","Read","See","Learn","Click","Call","Visit","Come","Find","Open","Book","Check","Get","Now","Today","New","Top","Back","Next","Prev","Skip","Save","Send","Submit","Cancel","Close","Show","Hide","Sign","Log","Join","Follow","Like","Add","Remove","Update","Delete","Search","Filter","Sort","Print","Download","Upload","Copy",
        "Best","Bay","Dog","Cat","Pet","Pup","Salon","Grooming","Resort","Boarding","Daycare","Spa","Studio","Groomer","Appointment","Booking","Schedule","Available","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","January","February","March","April","June","July","August","September","October","November","December",
        "Google","Yelp","Facebook","Instagram","Twitter","Bing","Yahoo","Nextdoor","Angi","Thumbtack",
        "Meet","Owner","Founder","Manager","Staff","Team","Principal","President","Director","Certified","Licensed","Professional","Experienced",
      ]);

      function extractFirstName(text: string): string | null {
        const patterns = [
          // "owned and operated by Name" / "owned by Name" / "founded by Name" etc.
          /(?:owned and operated by|owned by|founded by|opened by|started by|run by|operated by)\s+([A-Z][a-z]{2,})/i,
          // "Name is the owner" / "Name owns and operates"
          /([A-Z][a-z]{2,})\s+(?:is the owner|is the founder|is the proprietor|owns and operates)/i,
          // Em-dash attribution: "— Name, owner"
          /—\s*([A-Z][a-z]{2,}),?\s*(?:owner|founder|groomer|proprietor)/i,
          // Website bio phrases: "Hi, I'm Name" / "My name is Name" / "I'm Name"
          /(?:hi[,\s]+i'?m|i'?m\s+|my name is)\s+([A-Z][a-z]{2,})\b/i,
          // BBB "Principal Contacts" section
          /Principal\s+Contacts?\s+(?:Mr\.|Ms\.|Mrs\.|Dr\.)?\s*([A-Z][a-z]{2,})/i,
          // Title before name with owner role after (BBB / formal listings)
          /(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+([A-Z][a-z]{2,})\s+\w+,?\s*(?:owner|president|ceo|founder|proprietor)/i,
          // "Owner: Name" — requires explicit colon, not just any word following "owner"
          /\bowner:\s*([A-Z][a-z]{2,})\b/i,
          // Yelp "Meet the Business Owner: Name" — requires explicit colon
          /Meet the (?:Business )?Owner:\s*([A-Z][a-z]{2,})\b/i,
          // Facebook / social page title: "Holly Dean Grooms" — first name before last name + Grooms
          /^([A-Z][a-z]{2,})\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Grooms?|Grooming|Groomers?)\b/i,
          // Page title "FirstName LastName | Pet/Dog Groomer" — profile/listing style
          /^([A-Z][a-z]{2,})\s+[A-Z][a-z]+\s*\|\s*(?:(?:Pet|Dog|Mobile|Cat|Animal)\s+)?(?:Groomer|Grooming|Owner|Proprietor|Stylist)/i,
          // "ask for Name" / "contact Name" — used on some listing pages
          /\b(?:ask for|contact)\s+([A-Z][a-z]{2,})\b/i,
          // The Daily Groomer style: "Business by FirstName LastName"
          /\bby\s+([A-Z][a-z]{2,})\s+[A-Z][a-z]{2,}\b/,
        ];
        for (const p of patterns) {
          const m = text.match(p);
          if (!m?.[1]) continue;
          const captured = m[1];
          const normalized = captured.charAt(0).toUpperCase() + captured.slice(1).toLowerCase();
          if (!SKIP_WORDS.has(normalized)) return normalized;
        }
        return null;
      }

      function stripHtml(html: string): string {
        return html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function extractMeta(html: string): string {
        const ogA = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
        const ogB = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
        const descA = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
        const descB = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        return [ogA?.[1], ogB?.[1], descA?.[1], descB?.[1]].filter(Boolean).join(" ");
      }

      // ── Claude extraction ─────────────────────────────────────────────────
      async function askClaude(textBlob: string, source: string): Promise<{ firstName: string; source: string; confidence: string } | null> {
        if (!anthropicKey || !textBlob || textBlob.length < 40) return null;
        console.log(`[OwnerDiscovery] Asking Claude to extract name from ${source} (${textBlob.length} chars)`);
        try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 30,
              messages: [{
                role: "user",
                content: `Extract the first name of the OWNER of the pet grooming business named "${businessName}" from the text below.\n\nRules:\n- Return ONLY the owner's first name as a single word, nothing else\n- If no owner name is clearly stated, return: null\n- Ignore customer names, employee names, or reviewers — only the owner/founder/proprietor\n\nText:\n"""\n${textBlob.slice(0, 2500)}\n"""`,
              }],
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) {
            const errText = await r.text();
            console.log(`[OwnerDiscovery] Claude API error ${r.status}: ${errText}`);
            return null;
          }
          const data = await r.json() as any;
          const raw = data?.content?.[0]?.text?.trim();
          console.log(`[OwnerDiscovery] Claude raw response: "${raw}"`);
          if (!raw || raw.toLowerCase() === "null" || !/^[A-Za-z]{2,20}$/.test(raw)) return null;
          const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
          if (SKIP_WORDS.has(name)) {
            console.log(`[OwnerDiscovery] Claude returned "${name}" but it's in the skip list`);
            return null;
          }
          // Reject if the name is a word from the business name itself
          const bizTokens = businessName.toLowerCase().split(/\s+/).map((w: string) => w.replace(/[^a-z]/g, ""));
          if (bizTokens.includes(name.toLowerCase())) {
            console.log(`[OwnerDiscovery] Claude returned "${name}" but it's part of the business name — rejecting`);
            return null;
          }
          console.log(`[OwnerDiscovery] Claude found name: "${name}"`);
          return { firstName: name, source, confidence: "medium" };
        } catch (e: any) {
          console.log(`[OwnerDiscovery] Claude exception: ${e.message}`);
          return null;
        }
      }

      // ── Step 1 (parallel): Google search + website scrape ─────────────────
      type DiscoveryChunk = { text: string; source: string; priority: number };
      const chunks: DiscoveryChunk[] = [];

      async function collectGoogle(): Promise<void> {
        if (!serpKey) {
          console.log("[OwnerDiscovery] Google: skipped — no SERPAPI_API_KEY");
          return;
        }
        const queries = [
          `"${businessName}" owner grooming`,
          `"${businessName}"${city ? ` "${city}"` : ""} "owned by"`,
          `"${businessName}" grooming founder`,
          `"${businessName}" "my name is" grooming`,
        ];
        console.log(`[OwnerDiscovery] Google: running ${queries.length} queries`);
        let totalSnippets = 0;
        for (const q of queries) {
          try {
            const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "5" });
            const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
            if (!r.ok) {
              console.log(`[OwnerDiscovery] Google query failed HTTP ${r.status}: ${q}`);
              continue;
            }
            const data = await r.json() as any;
            const parts: string[] = [];
            if (data.answer_box?.answer) parts.push(data.answer_box.answer);
            if (data.answer_box?.snippet) parts.push(data.answer_box.snippet);
            if (data.knowledge_graph?.description) parts.push(data.knowledge_graph.description);
            for (const result of (data.organic_results || []).slice(0, 5)) {
              if (result.snippet) parts.push(result.snippet);
            }
            const combined = parts.join(" ");
            totalSnippets += parts.length;
            if (combined.trim()) chunks.push({ text: combined, source: "Google Search", priority: 1 });
            console.log(`[OwnerDiscovery] Google query "${q}" → ${parts.length} snippets`);
          } catch (e: any) {
            console.log(`[OwnerDiscovery] Google query exception: ${e.message}`);
          }
        }
        console.log(`[OwnerDiscovery] Google: collected ${totalSnippets} total snippets across all queries`);
      }

      async function collectWebsite(): Promise<void> {
        const websiteUrl = contact.websiteUrl;
        if (!websiteUrl) {
          console.log("[OwnerDiscovery] Website: skipped — no website URL on contact");
          return;
        }
        let base: URL;
        try { base = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`); }
        catch { console.log(`[OwnerDiscovery] Website: invalid URL "${websiteUrl}"`); return; }

        const paths = ["/about", "/about-us", "/our-team", "/meet-us", "/our-story", "/contact", ""];
        console.log(`[OwnerDiscovery] Website: scraping ${base.origin} — checking ${paths.length} pages`);
        let pagesFound = 0;
        for (const path of paths) {
          try {
            const r = await fetch(`${base.origin}${path}`, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; EsyCRM/1.0)" },
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) {
              console.log(`[OwnerDiscovery] Website ${path || "/"}: HTTP ${r.status}`);
              continue;
            }
            const html = await r.text();
            const meta = extractMeta(html);
            const body = stripHtml(html);
            const combined = `${meta} ${body}`;
            const label = path ? `Website (${path})` : "Website (Homepage)";
            const priority = path && path !== "/contact" ? 0 : 2;
            if (combined.trim().length > 30) {
              chunks.push({ text: combined, source: label, priority });
              pagesFound++;
              console.log(`[OwnerDiscovery] Website ${path || "/"}: fetched OK, ${combined.length} chars`);
            }
          } catch (e: any) {
            console.log(`[OwnerDiscovery] Website ${path || "/"}: ${e.message}`);
          }
        }
        console.log(`[OwnerDiscovery] Website: successfully scraped ${pagesFound} pages`);
      }

      async function collectBBB(): Promise<void> {
        if (!serpKey) {
          console.log("[OwnerDiscovery] BBB: skipped — no SERPAPI_API_KEY");
          return;
        }
        let bbbUrl: string | null = null;
        try {
          const q = `site:bbb.org/us "${businessName}"${city ? ` "${city}"` : ""}`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const bbbResult = (data.organic_results || []).find((res: any) =>
              res.link?.includes("bbb.org") && res.link?.includes("/profile/")
            );
            if (bbbResult?.link) {
              bbbUrl = bbbResult.link;
              console.log(`[OwnerDiscovery] BBB: found listing at ${bbbUrl}`);
            } else {
              console.log("[OwnerDiscovery] BBB: no /profile/ URL in search results");
            }
          }
        } catch (e: any) {
          console.log(`[OwnerDiscovery] BBB search exception: ${e.message}`);
        }
        if (!bbbUrl) return;
        try {
          const r = await fetch(bbbUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] BBB: HTTP ${r.status}`); return; }
          const html = await r.text();
          const text = stripHtml(html);
          if (text.length > 30) {
            chunks.push({ text, source: "BBB Listing", priority: 0 });
            console.log(`[OwnerDiscovery] BBB: scraped ${text.length} chars`);
          }
        } catch (e: any) {
          console.log(`[OwnerDiscovery] BBB scrape exception: ${e.message}`);
        }
      }

      async function collectYelp(): Promise<void> {
        if (!serpKey) {
          console.log("[OwnerDiscovery] Yelp: skipped — no SERPAPI_API_KEY");
          return;
        }
        let yelpUrl: string | null = null;
        try {
          const q = `site:yelp.com/biz "${businessName}"${city ? ` "${city}"` : ""}`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const yelpResult = (data.organic_results || []).find((res: any) =>
              res.link?.includes("yelp.com/biz/")
            );
            if (yelpResult?.link) {
              yelpUrl = yelpResult.link;
              console.log(`[OwnerDiscovery] Yelp: found listing at ${yelpUrl}`);
            } else {
              console.log("[OwnerDiscovery] Yelp: no /biz/ URL in search results");
            }
          }
        } catch (e: any) {
          console.log(`[OwnerDiscovery] Yelp search exception: ${e.message}`);
        }
        if (!yelpUrl) return;
        try {
          const r = await fetch(yelpUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] Yelp: HTTP ${r.status}`); return; }
          const html = await r.text();
          const text = stripHtml(html);
          if (text.length > 30) {
            chunks.push({ text, source: "Yelp Listing", priority: 0 });
            console.log(`[OwnerDiscovery] Yelp: scraped ${text.length} chars`);
          }
        } catch (e: any) {
          console.log(`[OwnerDiscovery] Yelp scrape exception: ${e.message}`);
        }
      }

      async function collectFacebook(): Promise<void> {
        if (!serpKey) { console.log("[OwnerDiscovery] Facebook: skipped — no SERPAPI_API_KEY"); return; }
        let fbUrl: string | null = null;
        try {
          const q = `site:facebook.com "${businessName}"${city ? ` "${city}"` : ""} grooming`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const fbResult = (data.organic_results || []).find((res: any) =>
              res.link?.includes("facebook.com/") && !res.link?.includes("/search") && !res.link?.includes("/events")
            );
            if (fbResult) {
              fbUrl = fbResult.link;
              const snippet = [fbResult.title, fbResult.snippet].filter(Boolean).join(" ");
              if (snippet.trim()) chunks.push({ text: snippet, source: "Facebook (search snippet)", priority: 1 });
              console.log(`[OwnerDiscovery] Facebook: found page at ${fbUrl}`);
            } else {
              console.log("[OwnerDiscovery] Facebook: no page found in search results");
            }
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Facebook search exception: ${e.message}`); }
        if (!fbUrl) return;
        try {
          const r = await fetch(fbUrl, {
            headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] Facebook: HTTP ${r.status}`); return; }
          const html = await r.text();
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || "";
          const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
          const combined = `${ogTitle} ${pageTitle} ${extractMeta(html)} ${stripHtml(html).slice(0, 2000)}`.trim();
          if (combined.length > 30) {
            chunks.push({ text: combined, source: "Facebook Page", priority: 0 });
            console.log(`[OwnerDiscovery] Facebook: scraped ${combined.length} chars (ogTitle: "${ogTitle}")`);
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Facebook scrape exception: ${e.message}`); }
      }

      async function collectNextdoor(): Promise<void> {
        if (!serpKey) { console.log("[OwnerDiscovery] Nextdoor: skipped — no SERPAPI_API_KEY"); return; }
        let ndUrl: string | null = null;
        try {
          const q = `site:nextdoor.com "${businessName}"${city ? ` "${city}"` : ""}`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const ndResult = (data.organic_results || []).find((res: any) => res.link?.includes("nextdoor.com/"));
            if (ndResult) {
              ndUrl = ndResult.link;
              const snippet = [ndResult.title, ndResult.snippet].filter(Boolean).join(" ");
              if (snippet.trim()) chunks.push({ text: snippet, source: "Nextdoor (search snippet)", priority: 1 });
              console.log(`[OwnerDiscovery] Nextdoor: found page at ${ndUrl}`);
            } else { console.log("[OwnerDiscovery] Nextdoor: no page found"); }
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Nextdoor search exception: ${e.message}`); }
        if (!ndUrl) return;
        try {
          const r = await fetch(ndUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] Nextdoor: HTTP ${r.status}`); return; }
          const html = await r.text();
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || "";
          const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
          const combined = `${ogTitle} ${pageTitle} ${extractMeta(html)} ${stripHtml(html).slice(0, 2000)}`.trim();
          if (combined.length > 30) {
            chunks.push({ text: combined, source: "Nextdoor Page", priority: 0 });
            console.log(`[OwnerDiscovery] Nextdoor: scraped ${combined.length} chars`);
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Nextdoor scrape exception: ${e.message}`); }
      }

      async function collectDailyGroomer(): Promise<void> {
        if (!serpKey) { console.log("[OwnerDiscovery] Daily Groomer: skipped — no SERPAPI_API_KEY"); return; }
        let dgUrl: string | null = null;
        try {
          const q = `site:thedailygroomer.com "${businessName}"`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const dgResult = (data.organic_results || []).find((res: any) => res.link?.includes("thedailygroomer.com/"));
            if (dgResult) {
              dgUrl = dgResult.link;
              const snippet = [dgResult.title, dgResult.snippet].filter(Boolean).join(" ");
              if (snippet.trim()) chunks.push({ text: snippet, source: "Daily Groomer (search snippet)", priority: 1 });
              console.log(`[OwnerDiscovery] Daily Groomer: found listing at ${dgUrl}`);
            } else { console.log("[OwnerDiscovery] Daily Groomer: no listing found"); }
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Daily Groomer search exception: ${e.message}`); }
        if (!dgUrl) return;
        try {
          const r = await fetch(dgUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] Daily Groomer: HTTP ${r.status}`); return; }
          const html = await r.text();
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || "";
          const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
          const combined = `${ogTitle} ${pageTitle} ${extractMeta(html)} ${stripHtml(html).slice(0, 3000)}`.trim();
          if (combined.length > 30) {
            chunks.push({ text: combined, source: "The Daily Groomer", priority: 0 });
            console.log(`[OwnerDiscovery] Daily Groomer: scraped ${combined.length} chars`);
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Daily Groomer scrape exception: ${e.message}`); }
      }

      async function collectThumbTack(): Promise<void> {
        if (!serpKey) { console.log("[OwnerDiscovery] Thumbtack: skipped — no SERPAPI_API_KEY"); return; }
        let ttUrl: string | null = null;
        try {
          const q = `site:thumbtack.com "${businessName}"${city ? ` "${city}"` : ""} grooming`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const ttResult = (data.organic_results || []).find((res: any) => res.link?.includes("thumbtack.com/"));
            if (ttResult) {
              ttUrl = ttResult.link;
              const snippet = [ttResult.title, ttResult.snippet].filter(Boolean).join(" ");
              if (snippet.trim()) chunks.push({ text: snippet, source: "Thumbtack (search snippet)", priority: 1 });
              console.log(`[OwnerDiscovery] Thumbtack: found listing at ${ttUrl}`);
            } else { console.log("[OwnerDiscovery] Thumbtack: no listing found"); }
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Thumbtack search exception: ${e.message}`); }
        if (!ttUrl) return;
        try {
          const r = await fetch(ttUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] Thumbtack: HTTP ${r.status}`); return; }
          const html = await r.text();
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || "";
          const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
          const combined = `${ogTitle} ${pageTitle} ${extractMeta(html)} ${stripHtml(html).slice(0, 2500)}`.trim();
          if (combined.length > 30) {
            chunks.push({ text: combined, source: "Thumbtack Listing", priority: 0 });
            console.log(`[OwnerDiscovery] Thumbtack: scraped ${combined.length} chars`);
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Thumbtack scrape exception: ${e.message}`); }
      }

      async function collectAngi(): Promise<void> {
        if (!serpKey) { console.log("[OwnerDiscovery] Angi: skipped — no SERPAPI_API_KEY"); return; }
        let angiUrl: string | null = null;
        try {
          const q = `site:angi.com "${businessName}"${city ? ` "${city}"` : ""} grooming`;
          const params = new URLSearchParams({ api_key: serpKey, engine: "google", q, num: "3" });
          const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) {
            const data = await r.json() as any;
            const angiResult = (data.organic_results || []).find((res: any) => res.link?.includes("angi.com/"));
            if (angiResult) {
              angiUrl = angiResult.link;
              const snippet = [angiResult.title, angiResult.snippet].filter(Boolean).join(" ");
              if (snippet.trim()) chunks.push({ text: snippet, source: "Angi (search snippet)", priority: 1 });
              console.log(`[OwnerDiscovery] Angi: found listing at ${angiUrl}`);
            } else { console.log("[OwnerDiscovery] Angi: no listing found"); }
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Angi search exception: ${e.message}`); }
        if (!angiUrl) return;
        try {
          const r = await fetch(angiUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(12000),
          });
          if (!r.ok) { console.log(`[OwnerDiscovery] Angi: HTTP ${r.status}`); return; }
          const html = await r.text();
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || "";
          const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
          const combined = `${ogTitle} ${pageTitle} ${extractMeta(html)} ${stripHtml(html).slice(0, 2500)}`.trim();
          if (combined.length > 30) {
            chunks.push({ text: combined, source: "Angi Listing", priority: 0 });
            console.log(`[OwnerDiscovery] Angi: scraped ${combined.length} chars`);
          }
        } catch (e: any) { console.log(`[OwnerDiscovery] Angi scrape exception: ${e.message}`); }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // OWNER NAME SOURCES — all run in parallel, results are tallied by votes.
      // To add a new source: write a collectXxx() function above and add it here.
      //   1. Google Search        6. Nextdoor
      //   2. Business Website     7. The Daily Groomer
      //   3. BBB Listing          8. Thumbtack
      //   4. Yelp Listing         9. Angi
      //   5. Facebook Page
      // ─────────────────────────────────────────────────────────────────────────
      await Promise.allSettled([
        collectGoogle(), collectWebsite(), collectBBB(), collectYelp(),
        collectFacebook(), collectNextdoor(), collectDailyGroomer(),
        collectThumbTack(), collectAngi(),
      ]);
      console.log(`[OwnerDiscovery] All sources collected — ${chunks.length} total chunks`);

      // ── Step 2: Collect all name candidates from every chunk (regex + Claude) ─
      const allCandidates: { name: string; source: string }[] = [];

      // Regex on all chunks
      for (const chunk of chunks) {
        const name = extractFirstName(chunk.text);
        if (name) {
          console.log(`[OwnerDiscovery] Regex HIT: "${name}" from ${chunk.source}`);
          allCandidates.push({ name, source: chunk.source });
        }
      }

      // Claude on all chunks in parallel
      if (anthropicKey && chunks.length > 0) {
        console.log(`[OwnerDiscovery] Running Claude on ${chunks.length} chunks in parallel...`);
        const claudeResults = await Promise.all(chunks.map(c => askClaude(c.text, c.source)));
        for (const result of claudeResults) {
          if (result) {
            console.log(`[OwnerDiscovery] Claude HIT: "${result.firstName}" from ${result.source}`);
            allCandidates.push({ name: result.firstName, source: result.source });
          }
        }
      }

      // ── Step 3: Tally votes — pick the name confirmed by the most sources ──
      const votes = new Map<string, { count: number; uniqueSources: Set<string> }>();
      for (const { name, source } of allCandidates) {
        if (!votes.has(name)) votes.set(name, { count: 0, uniqueSources: new Set() });
        const v = votes.get(name)!;
        v.count++;
        v.uniqueSources.add(source);
      }

      // Sort by unique source count first, total mentions second
      const sortedVotes = [...votes.entries()].sort((a, b) => {
        const srcDiff = b[1].uniqueSources.size - a[1].uniqueSources.size;
        return srcDiff !== 0 ? srcDiff : b[1].count - a[1].count;
      });

      console.log(`[OwnerDiscovery] Candidates: ${[...votes.entries()].map(([n, v]) => `"${n}"(${v.uniqueSources.size} src, ${v.count} mentions)`).join(", ") || "none"}`);

      // Build source steps
      const SOURCE_DEFS = [
        { key: "Google Search", label: "Google Search", needsSerp: true },
        { key: "Website", label: "Website scrape", needsSerp: false, checkWebsite: true },
        { key: "BBB Listing", label: "BBB listing", needsSerp: true },
        { key: "Yelp Listing", label: "Yelp listing", needsSerp: true },
        { key: "Facebook", label: "Facebook page", needsSerp: true },
        { key: "Nextdoor", label: "Nextdoor page", needsSerp: true },
        { key: "The Daily Groomer", label: "The Daily Groomer", needsSerp: true },
      ];
      for (const { key, label, needsSerp, checkWebsite } of SOURCE_DEFS) {
        const found = chunks.some(c => c.source.includes(key));
        if (needsSerp && !serpKey) {
          steps.push({ label, result: "Skipped — API not configured" });
        } else if (checkWebsite && !contact.websiteUrl) {
          steps.push({ label, result: found ? `Scraped ${chunks.filter(c => c.source.startsWith("Website")).length} page(s)` : "Skipped — no website on record" });
        } else {
          steps.push({ label, result: found ? `Scraped` : "Not found" });
        }
      }

      if (sortedVotes.length > 0) {
        const [winner, { count, uniqueSources }] = sortedVotes[0];
        const srcList = [...uniqueSources].join(", ");
        const confidence = uniqueSources.size >= 3 ? "high" : uniqueSources.size >= 2 ? "medium" : "low";
        const voteNote = uniqueSources.size >= 2
          ? `"${winner}" confirmed by ${uniqueSources.size} sources: ${srcList}`
          : `"${winner}" found via ${srcList}`;
        steps.push({ label: anthropicKey ? "Pattern match + AI voting" : "Pattern matching", result: voteNote });
        console.log(`[OwnerDiscovery] Winner: "${winner}" (${count} mention(s) across ${uniqueSources.size} source(s): ${srcList})`);
        return res.json({ found: true, firstName: winner, source: srcList, confidence, votes: count, steps });
      }

      steps.push({ label: anthropicKey ? "Pattern match + AI voting" : "Pattern matching", result: "No owner name found across any source" });

      // ── Step 4: Email prefix heuristic (last resort) ───────────────────────
      const email = contact.email || "";
      if (email) {
        const prefix = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
        const generic = new Set(["info","hello","contact","admin","support","hi","mail","office","team","grooming","salon","help","noreply","booking","appointments","care","spa","studio","paws"]);
        const bizWords = businessName.toLowerCase().split(/\s+/).map((w: string) => w.replace(/[^a-z]/g, "")).filter((w: string) => w.length > 3);
        const overlapsWithBiz = bizWords.some((w: string) => prefix.includes(w.slice(0, 4)) || w.includes(prefix.slice(0, 4)));
        console.log(`[OwnerDiscovery] Email heuristic: prefix="${prefix}" generic=${generic.has(prefix)} overlaps=${overlapsWithBiz}`);
        if (prefix.length >= 3 && prefix.length <= 12 && !generic.has(prefix) && !overlapsWithBiz) {
          const name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
          if (!SKIP_WORDS.has(name)) {
            steps.push({ label: "Email prefix", result: `Suggested "${name}" from email address` });
            console.log(`[OwnerDiscovery] Email heuristic: suggested "${name}"`);
            return res.json({ found: true, firstName: name, source: "Email prefix", confidence: "low", steps });
          }
        }
        steps.push({ label: "Email prefix", result: `"${prefix}@..." looks generic or matches business name — skipped` });
      } else {
        steps.push({ label: "Email prefix", result: "Skipped — no email on record" });
      }

      console.log("[OwnerDiscovery] All methods exhausted — no name found");
      return res.json({ found: false, reason: "No owner name found", steps });
    } catch (error) {
      console.error("Owner discovery error:", error);
      res.status(500).json({ message: "Discovery failed" });
    }
  });

  app.delete("/api/contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteContact(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  app.post("/api/contacts/check-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const contactData = insertContactSchema.parse(req.body.contact);
      const excludeId = req.body.excludeId as string | undefined;
      
      const duplicates = await storage.findDuplicateContacts(contactData, userId, excludeId);
      res.json({ duplicates });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid contact data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to check duplicates" });
    }
  });

  app.post("/api/contacts/check-bulk-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { contacts: contactsData } = req.body;
      
      if (!Array.isArray(contactsData) || contactsData.length === 0) {
        return res.status(400).json({ message: "Invalid data. Expected an array of contacts." });
      }
      
      const duplicateResults = [];
      
      for (let i = 0; i < contactsData.length; i++) {
        try {
          const validated = insertContactSchema.parse(contactsData[i]);
          const duplicates = await storage.findDuplicateContacts(validated, userId);
          
          if (duplicates.length > 0) {
            duplicateResults.push({
              row: i + 1,
              contact: validated,
              duplicates
            });
          }
        } catch (error) {
          // Skip invalid contacts, they'll be handled in the actual import
        }
      }
      
      res.json({ duplicates: duplicateResults });
    } catch (error) {
      res.status(500).json({ message: "Failed to check duplicates" });
    }
  });

  app.post("/api/contacts/import", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { contacts: contactsData, groupId, newGroupName } = req.body;
      
      if (!Array.isArray(contactsData) || contactsData.length === 0) {
        return res.status(400).json({ message: "Invalid import data. Expected an array of contacts." });
      }
      
      // Handle group assignment: either use existing groupId or create a new group
      let assignedGroupId: string | null = null;
      
      if (newGroupName !== undefined) {
        // newGroupName was provided, validate and create group
        if (typeof newGroupName !== 'string' || !newGroupName.trim()) {
          return res.status(400).json({ message: "Invalid newGroupName. Must be a non-empty string." });
        }
        
        try {
          const newGroup = await storage.createContactGroup({ name: newGroupName.trim() }, userId);
          assignedGroupId = newGroup.id;
        } catch (error) {
          return res.status(400).json({ message: "Failed to create new group", error: error instanceof Error ? error.message : "Unknown error" });
        }
      } else if (groupId !== undefined) {
        // groupId was provided, validate it
        if (typeof groupId !== 'string' || !groupId.trim()) {
          return res.status(400).json({ message: "Invalid groupId. Must be a valid group identifier." });
        }
        
        // Verify the group exists and belongs to the user
        const group = await storage.getContactGroup(groupId, userId);
        if (!group) {
          return res.status(404).json({ message: "Group not found or you don't have access to it" });
        }
        assignedGroupId = groupId;
      }
      
      // Validate each contact and preserve original row numbers
      const validatedContacts: Array<{ row: number, data: InsertContact }> = [];
      const validationErrors = [];
      
      for (let i = 0; i < contactsData.length; i++) {
        try {
          // Add groupId to contact data if provided
          const contactWithGroup = assignedGroupId 
            ? { ...contactsData[i], groupId: assignedGroupId }
            : contactsData[i];
          
          const validated = insertContactSchema.parse(contactWithGroup);
          validatedContacts.push({ row: i + 1, data: validated });
        } catch (error) {
          if (error instanceof z.ZodError) {
            validationErrors.push({
              row: i + 1,
              errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
              data: contactsData[i]
            });
          }
        }
      }
      
      // Import validated contacts with original row numbers
      const result = await storage.bulkCreateContacts(validatedContacts, userId);
      
      res.status(200).json({
        total: contactsData.length,
        successful: result.successful.length,
        failed: result.failed.length + validationErrors.length,
        contacts: result.successful,
        errors: [...validationErrors, ...result.failed],
        groupId: assignedGroupId // Return the assigned groupId
      });
    } catch (error) {
      console.error("Error importing contacts:", error);
      res.status(500).json({ message: "Failed to import contacts" });
    }
  });

  // Contact Groups routes - All protected with isAuthenticated
  app.get("/api/contact-groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const groups = await storage.getContactGroups(userId);
      res.json(groups);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact groups" });
    }
  });

  app.get("/api/contact-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const group = await storage.getContactGroup(req.params.id, userId);
      if (!group) {
        return res.status(404).json({ message: "Contact group not found" });
      }
      res.json(group);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact group" });
    }
  });

  app.post("/api/contact-groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const groupData = insertContactGroupSchema.parse(req.body);
      const group = await storage.createContactGroup(groupData, userId);
      res.status(201).json(group);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid group data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create contact group" });
    }
  });

  app.put("/api/contact-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const groupData = insertContactGroupSchema.partial().parse(req.body);
      const group = await storage.updateContactGroup(req.params.id, groupData, userId);
      if (!group) {
        return res.status(404).json({ message: "Contact group not found" });
      }
      res.json(group);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid group data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update contact group" });
    }
  });

  app.post("/api/contact-groups/:id/assign-contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ message: "contactIds must be a non-empty array" });
      }
      const group = await storage.getContactGroup(req.params.id, userId);
      if (!group) return res.status(404).json({ message: "Contact group not found" });
      const results = await Promise.allSettled(
        contactIds.map((id: string) => storage.updateContact(id, { groupId: req.params.id }, userId))
      );
      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;
      res.json({ successful, failed, groupId: req.params.id });
    } catch (error) {
      res.status(500).json({ message: "Failed to assign contacts to group" });
    }
  });

  app.delete("/api/contact-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteContactGroup(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Contact group not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contact group" });
    }
  });

  // Deals routes - All protected with isAuthenticated
  app.get("/api/deals", isAuthenticated, async (req: any, res) => {
    try {
      let userId = getUserIdForQuery(req.user);
      const { stage, filterUserId } = req.query;
      if (filterUserId && req.user.role === "admin") {
        userId = filterUserId as string;
      }
      const deals = stage 
        ? await storage.getDealsByStage(stage as string, userId)
        : await storage.getDeals(userId);
      res.json(deals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch deals" });
    }
  });

  // Must be before /api/deals/:id to prevent route collision
  app.get("/api/deals/unread-replies", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const dealIds = await storage.getDealsWithUnreadReplies(userId);
      res.json(dealIds);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch unread reply deals" });
    }
  });

  app.post("/api/deals/:dealId/mark-replies-read", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      await storage.markRepliesReadForDeal(req.params.dealId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark replies as read" });
    }
  });

  app.get("/api/deals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deal = await storage.getDeal(req.params.id, userId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      res.json(deal);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch deal" });
    }
  });

  // Deal Workspace: single endpoint returning deal + contact + tasks + activities
  app.get("/api/deal-workspace/:dealId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { dealId } = req.params;
      const deal = await storage.getDeal(dealId, userId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      const contact = deal.contactId ? await storage.getContact(deal.contactId, userId) : null;
      const tasks = await storage.getTasksByDealId(dealId, userId);
      const activities = await storage.getDealActivities(dealId, userId);
      res.json({ deal, contact, tasks, activities });
    } catch (error) {
      console.error("Error fetching deal workspace:", error);
      res.status(500).json({ message: "Failed to fetch deal workspace" });
    }
  });

  app.post("/api/deal-activities/:dealId", isAuthenticated, async (req: any, res) => {
    try {
      const createdBy = req.user.claims.sub;
      const userId = getUserIdForQuery(req.user);
      const { dealId } = req.params;
      const deal = await storage.getDeal(dealId, userId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const activity = await storage.createDealActivity({ ...req.body, dealId }, createdBy);
      res.status(201).json(activity);
    } catch (error) {
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  app.post("/api/deals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const dealData = insertDealSchema.parse(req.body);
      const deal = await storage.createDeal(dealData, userId);
      res.status(201).json(deal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid deal data", errors: error.errors });
      }
      console.error("Error creating deal:", error);
      res.status(500).json({ message: "Failed to create deal" });
    }
  });

  app.put("/api/deals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const dealData = insertDealSchema.partial().parse(req.body);
      const deal = await storage.updateDeal(req.params.id, dealData, userId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      // When deal is moved to "qualified_lead" stage, assign sequence track to contact
      if (dealData.stage === "qualified_lead" && deal.contactId) {
        const contact = await storage.getContact(deal.contactId, userId);
        if (contact) {
          const bType = contact.businessType || "salon";
          let sequenceTrack: string;
          if (contact.usesSoftware === "Yes") {
            // Check if we know the specific competitor — assign a targeted track when possible
            const software = (contact.currentSoftware || "").toLowerCase();
            if (software.includes("moego") || software.includes("moe go")) {
              sequenceTrack = `${bType}_competitor_moego`;
            } else if (software.includes("groomer.io") || software.includes("groomerio")) {
              sequenceTrack = `${bType}_competitor_groomerio`;
            } else {
              sequenceTrack = `${bType}_uses_competitor`;
            }
          } else {
            sequenceTrack = `${bType}_no_software`;
          }
          await storage.updateContact(deal.contactId, { sequenceTrack }, userId);
        }
      }
      
      res.json(deal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid deal data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update deal" });
    }
  });

  app.patch("/api/deals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const dealData = insertDealSchema.partial().parse(req.body);

      // Fetch the deal before update so we know the previous stage
      const beforeDeal = await storage.getDeal(req.params.id, userId);

      const deal = await storage.updateDeal(req.params.id, dealData, userId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      // When deal is moved to "qualified_lead" stage, assign sequence track to contact
      if (dealData.stage === "qualified_lead" && deal.contactId) {
        const contact = await storage.getContact(deal.contactId, userId);
        if (contact) {
          const bType2 = contact.businessType || "salon";
          const softwareStatus2 = contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software";
          const sequenceTrack = `${bType2}_${softwareStatus2}`;
          await storage.updateContact(deal.contactId, { sequenceTrack }, userId);
        }
      }

      // Send admin notification when stage changes (never for new_lead_unqualified)
      if (
        dealData.stage &&
        dealData.stage !== "new_lead_unqualified" &&
        beforeDeal &&
        dealData.stage !== beforeDeal.stage
      ) {
        const actorId = req.user.claims.sub;
        const actor = await storage.getUser(actorId);
        const actorName = actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || actor.email || actorId : actorId;
        const contact = deal.contactId ? await storage.getContact(deal.contactId, null) : null;
        const contactName = contact ? `${contact.firstName} ${contact.lastName}` : "N/A";
        const stageLabelMap: Record<string, string> = {
          qualified_lead: "Qualified Lead",
          contacted_emailed: "Contacted - Emailed",
          contacted_phone_spoke_decision_maker: "Contacted - Phone Spoke To Decision Maker",
          contacted_phone_spoke_non_decision_maker: "Contacted - Phone Spoke To Non-Decision Maker",
          contacted_phone_left_message: "Contacted - Phone Left Message",
          trial_period_started: "Trial Period Started",
          pending_commitment: "Pending Commitment",
          in_negotiation: "In Negotiation",
          won: "Won",
          lost: "Lost",
        };
        const newLabel = stageLabelMap[dealData.stage] ?? dealData.stage;
        const oldLabel = stageLabelMap[beforeDeal.stage] ?? beforeDeal.stage;
        const adminEmails = ["seann@esypet.com", "ravin@esypet.com", "srinath@esyntaxis.com"];
        const subject = `EsyPet CRM — Deal Stage Updated: ${deal.title}`;
        const textBody = [
          `Deal Stage Change Notification`,
          ``,
          `Deal: ${deal.title}`,
          `Contact: ${contactName}`,
          `Salesperson: ${actorName}`,
          `Previous Stage: ${oldLabel}`,
          `New Stage: ${newLabel}`,
          deal.plan ? `Plan: ${deal.plan}` : "",
        ].filter(Boolean).join("\n");
        for (const adminEmail of adminEmails) {
          try {
            await sendEmail({ to: adminEmail, subject, body: textBody });
          } catch (e) {
            console.error(`[StageNotify] Failed to email ${adminEmail}:`, e);
          }
        }
      }

      res.json(deal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid deal data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update deal" });
    }
  });

  app.delete("/api/deals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteDeal(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Deal not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete deal" });
    }
  });

  // Tasks routes - All protected with isAuthenticated
  app.get("/api/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { status, upcoming } = req.query;
      let tasks;
      if (upcoming === "true") {
        tasks = await storage.getUpcomingTasks(userId);
      } else if (status) {
        tasks = await storage.getTasksByStatus(status as string, userId);
      } else {
        tasks = await storage.getTasks(userId);
      }
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const task = await storage.getTask(req.params.id, userId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const taskData = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(taskData, userId);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.put("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const taskData = insertTaskSchema.partial().parse(req.body);
      const task = await storage.updateTask(req.params.id, taskData, userId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteTask(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // ─── Deal Tasks routes ──────────────────────────────────────────────────────
  app.get("/api/deal-tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { dealId } = req.query;
      if (!dealId) return res.status(400).json({ message: "dealId required" });

      // New deal_tasks table
      const newTasks = await storage.getDealTasks(dealId as string);

      // Legacy tasks from old tasks table that are linked to this deal
      const legacyRaw = await storage.getTasksByDealId(dealId as string, userId);
      const legacyIds = new Set(newTasks.map((t: any) => t.id));
      const legacy = legacyRaw
        .filter(t => !legacyIds.has(t.id))
        .map(t => ({
          id: t.id,
          dealId: t.dealId,
          contactId: t.contactId ?? null,
          createdBy: t.userId,
          title: t.title,
          taskType: "other",
          priority: t.priority ?? "medium",
          dueDate: t.dueDate ?? null,
          dueTime: null,
          assignedTo: null,
          assignedEmail: null,
          reminderTiming: "none",
          reminderDatetime: null,
          reminderSent: "false",
          notes: t.description ?? null,
          autoFollowup: "false",
          followupTitle: null,
          followupDaysOut: null,
          completed: t.status === "completed" ? "true" : "false",
          completedAt: null,
          createdAt: t.createdAt,
          _legacy: true,
        }));

      res.json([...newTasks, ...legacy]);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch deal tasks" });
    }
  });

  app.post("/api/deal-tasks", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const body = req.body;
      const dueDate = body.dueDate ? new Date(String(body.dueDate).slice(0, 10) + "T12:00:00.000Z") : null;
      const reminderDatetime = body.reminderDatetime ? new Date(body.reminderDatetime) : null;
      const task = await storage.createDealTask({
        ...body,
        dueDate,
        reminderDatetime,
        createdBy: userId,
        completed: "false",
        reminderSent: "false",
      });
      // Log task_created activity
      if (task.dealId && task.contactId) {
        await storage.createDealActivity({
          dealId: task.dealId,
          contactId: task.contactId,
          activityType: "task_created",
          notes: task.title,
          metadata: JSON.stringify({ taskId: task.id, taskType: task.taskType }),
        }, userId);
      }
      res.status(201).json(task);
    } catch (error) {
      console.error("Create deal task error:", error);
      res.status(500).json({ message: "Failed to create deal task" });
    }
  });

  app.patch("/api/deal-tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      const body = { ...req.body };
      if (body.dueDate) body.dueDate = new Date(String(body.dueDate).slice(0, 10) + "T12:00:00.000Z");
      if (body.reminderDatetime) body.reminderDatetime = new Date(body.reminderDatetime);
      const existing = await storage.getDealTask(id);
      if (!existing) return res.status(404).json({ message: "Task not found" });
      // Handle completion
      if (body.completed === "true" && existing.completed !== "true") {
        body.completedAt = new Date();
        // Log task_completed activity
        if (existing.dealId && existing.contactId) {
          await storage.createDealActivity({
            dealId: existing.dealId,
            contactId: existing.contactId,
            activityType: "task_completed",
            notes: existing.title,
            metadata: JSON.stringify({ taskId: id, completedAt: new Date().toISOString() }),
          }, userId);
        }
        // Auto-create follow-up if configured
        if (existing.autoFollowup === "true" && existing.followupTitle && existing.followupDaysOut) {
          const followupDate = existing.dueDate ? new Date(existing.dueDate) : new Date();
          followupDate.setDate(followupDate.getDate() + existing.followupDaysOut);
          await storage.createDealTask({
            dealId: existing.dealId,
            contactId: existing.contactId,
            title: existing.followupTitle,
            taskType: "follow_up",
            priority: existing.priority,
            dueDate: followupDate,
            assignedTo: existing.assignedTo,
            assignedEmail: existing.assignedEmail,
            reminderTiming: "none",
            completed: "false",
            autoFollowup: "false",
            createdBy: userId,
          });
        }
      } else if (body.completed === "false") {
        body.completedAt = null;
      }
      const updated = await storage.updateDealTask(id, body);
      res.json(updated);
    } catch (error) {
      console.error("Update deal task error:", error);
      res.status(500).json({ message: "Failed to update deal task" });
    }
  });

  app.delete("/api/deal-tasks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteDealTask(id);
      if (!deleted) return res.status(404).json({ message: "Task not found" });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete deal task" });
    }
  });

  // Activities routes - Protected with isAuthenticated
  app.get("/api/activities", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { limit } = req.query;
      const activities = await storage.getRecentActivities(
        limit ? parseInt(limit as string) : 10,
        userId
      );
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // Dashboard metrics - Protected with isAuthenticated
  app.get("/api/dashboard/metrics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const contacts = await storage.getContacts(userId);
      const deals = await storage.getDeals(userId);
      const tasks = await storage.getTasks(userId);
      
      const activeDeals = deals.filter(deal => 
        !["won", "lost"].includes(deal.stage)
      );
      
      const completedTasks = tasks.filter(task => task.status === "completed");
      const monthlyRevenue = deals
        .filter(deal => deal.stage === "won")
        .reduce((sum, deal) => sum + parseFloat(deal.value || "0"), 0);

      const metrics = {
        totalContacts: contacts.length,
        activeDeals: activeDeals.length,
        monthlyRevenue,
        tasksCompleted: completedTasks.length,
      };

      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  // Deal pipeline summary - Protected with isAuthenticated
  app.get("/api/dashboard/pipeline", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deals = await storage.getDeals(userId);
      const stages = ["new_lead_unqualified", "qualified_lead", "contacted_emailed", "contacted_phone_spoke_decision_maker", "contacted_phone_spoke_non_decision_maker", "contacted_phone_left_message", "trial_period_started", "pending_commitment", "in_negotiation", "won", "lost"];
      
      const pipeline = stages.map(stage => {
        const stageDeals = deals.filter(deal => deal.stage === stage);
        const totalValue = stageDeals.reduce((sum, deal) => 
          sum + parseFloat(deal.value || "0"), 0
        );
        
        return {
          stage,
          count: stageDeals.length,
          value: totalValue,
        };
      });

      res.json(pipeline);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pipeline data" });
    }
  });

  // Commission endpoints
  // Admin: Approve/reject deal for commission
  app.patch("/api/deals/:id/approve", isAdmin, async (req: any, res) => {
    try {
      const { approved } = req.body; // "approved" or "rejected"
      const deal = await storage.updateDeal(req.params.id, { approved }, null);
      
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      res.json(deal);
    } catch (error) {
      console.error("Error updating deal approval:", error);
      res.status(500).json({ message: "Failed to update deal approval" });
    }
  });

  // Get commissions for authenticated user (salesperson sees own, admin sees all)
  // Returns enriched commission objects with dealTitle and salespersonName
  app.get("/api/commissions", isAuthenticated, async (req: any, res) => {
    try {
      const isAdminUser = (req.user as any)?.role === "admin";
      const userId = isAdminUser ? null : req.user.claims.sub;
      const commissionData = await storage.getCommissions(userId);
      const enriched = await Promise.all(commissionData.map(async (c) => {
        const deal = await storage.getDeal(c.dealId, null);
        const salesperson = await storage.getUser(c.userId);
        const salespersonName = salesperson
          ? `${salesperson.firstName ?? ""} ${salesperson.lastName ?? ""}`.trim() || salesperson.email || c.userId
          : c.userId;
        return { ...c, dealTitle: deal?.title ?? "Unknown Deal", salespersonName };
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching commissions:", error);
      res.status(500).json({ message: "Failed to fetch commissions" });
    }
  });

  // Create commission when deal is confirmed as Won
  app.post("/api/commissions", isAuthenticated, async (req: any, res) => {
    try {
      const actorId = req.user.claims.sub;
      const isAdminUser = (req.user as any)?.role === "admin";
      const { dealId, planName } = req.body;
      if (!dealId || !planName) {
        return res.status(400).json({ message: "dealId and planName are required" });
      }
      const { upfront, monthly } = getCommissionAmounts(planName);
      // Fetch deal to get the salesperson's userId
      const deal = await storage.getDeal(dealId, isAdminUser ? null : actorId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const commission = await storage.createCommission({
        dealId,
        userId: deal.userId,
        planName,
        upfrontAmount: upfront.toFixed(2),
        monthlyAmount: monthly.toFixed(2),
      });
      // Update the deal stage to won and set the plan
      await storage.updateDeal(dealId, { stage: "won", wonDate: new Date(), plan: planName }, isAdminUser ? null : actorId);

      // Send admin notification for Won stage change
      if (deal.stage !== "won") {
        const actor = await storage.getUser(actorId);
        const actorName = actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || actor.email || actorId : actorId;
        const contact = deal.contactId ? await storage.getContact(deal.contactId, null) : null;
        const contactName = contact ? `${contact.firstName} ${contact.lastName}` : "N/A";
        const adminEmails = ["seann@esypet.com", "ravin@esypet.com", "srinath@esyntaxis.com"];
        const subject = `EsyPet CRM — Deal Won: ${deal.title}`;
        const textBody = [
          `Deal Won Notification`,
          ``,
          `Deal: ${deal.title}`,
          `Contact: ${contactName}`,
          `Salesperson: ${actorName}`,
          `Plan: ${planName}`,
          `Upfront Commission: $${upfront.toFixed(2)}`,
          `Monthly Commission: $${monthly.toFixed(2)}/mo`,
        ].join("\n");
        for (const adminEmail of adminEmails) {
          try {
            await sendEmail({ to: adminEmail, subject, body: textBody });
          } catch (e) {
            console.error(`[WonNotify] Failed to email ${adminEmail}:`, e);
          }
        }
      }

      res.status(201).json(commission);
    } catch (error) {
      console.error("Error creating commission:", error);
      res.status(500).json({ message: "Failed to create commission" });
    }
  });

  // Get monthly recurring commission payments
  app.get("/api/commissions/monthly-payments", isAuthenticated, async (req: any, res) => {
    try {
      const isAdminUser = (req.user as any)?.role === "admin";
      const userId = isAdminUser ? null : req.user.claims.sub;
      const payments = await storage.getMonthlyPayments(userId);
      res.json(payments);
    } catch (error) {
      console.error("Error fetching monthly commission payments:", error);
      res.status(500).json({ message: "Failed to fetch monthly payments" });
    }
  });

  // ─── Payroll Routes ────────────────────────────────────────────────────────

  // Preview payroll line items for a date range (no save)
  app.get("/api/payroll/preview", isAuthenticated, async (req: any, res) => {
    try {
      const isAdminUser = (req.user as any)?.role === "admin";
      const { userId, startDate, endDate } = req.query;
      if (!userId || !startDate || !endDate) {
        return res.status(400).json({ message: "userId, startDate, and endDate are required" });
      }
      if (!isAdminUser && userId !== req.user.claims.sub) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const items = await storage.previewPayroll(userId as string, new Date(startDate as string), new Date(endDate as string));
      res.json(items);
    } catch (error) {
      console.error("Error previewing payroll:", error);
      res.status(500).json({ message: "Failed to preview payroll" });
    }
  });

  // List payroll periods
  app.get("/api/payroll", isAuthenticated, async (req: any, res) => {
    try {
      const isAdminUser = (req.user as any)?.role === "admin";
      const { userId } = req.query;
      const filterUserId = isAdminUser ? ((userId as string) || null) : req.user.claims.sub;
      const periods = await storage.getPayrollPeriods(filterUserId);
      res.json(periods);
    } catch (error) {
      console.error("Error fetching payroll periods:", error);
      res.status(500).json({ message: "Failed to fetch payroll periods" });
    }
  });

  // Get single payroll period with line items
  app.get("/api/payroll/:id", isAuthenticated, async (req: any, res) => {
    try {
      const isAdminUser = (req.user as any)?.role === "admin";
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ message: "Payroll period not found" });
      if (!isAdminUser && period.userId !== req.user.claims.sub) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(period);
    } catch (error) {
      console.error("Error fetching payroll period:", error);
      res.status(500).json({ message: "Failed to fetch payroll period" });
    }
  });

  // Create (save) a payroll period with line items
  app.post("/api/payroll", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const adminId = req.user.claims.sub;
      const { userId, startDate, endDate, notes, lineItems } = req.body;
      if (!userId || !startDate || !endDate || !Array.isArray(lineItems)) {
        return res.status(400).json({ message: "userId, startDate, endDate, and lineItems are required" });
      }
      const result = await storage.createPayrollPeriod(
        { userId, createdByAdminId: adminId, startDate: new Date(startDate), endDate: new Date(endDate), status: "draft", notes: notes || null, sentAt: null, sentToEmails: null },
        lineItems.map((item: any) => ({
          commissionId: item.commissionId || null,
          monthlyPaymentId: item.monthlyPaymentId || null,
          type: item.type,
          contactName: item.contactName || "",
          dealTitle: item.dealTitle,
          planName: item.planName,
          originalAmount: item.originalAmount,
          adjustedAmount: item.adjustedAmount,
          date: new Date(item.date),
          notes: item.notes || null,
        })),
      );
      res.status(201).json(result);
    } catch (error) {
      console.error("Error creating payroll period:", error);
      res.status(500).json({ message: "Failed to create payroll period" });
    }
  });

  // Update payroll period (notes/status)
  app.patch("/api/payroll/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { notes, status, totalAmount } = req.body;
      const updated = await storage.updatePayrollPeriod(req.params.id, { ...(notes !== undefined && { notes }), ...(status !== undefined && { status }), ...(totalAmount !== undefined && { totalAmount }) });
      res.json(updated);
    } catch (error) {
      console.error("Error updating payroll period:", error);
      res.status(500).json({ message: "Failed to update payroll period" });
    }
  });

  // Update a single payroll line item's adjusted amount
  app.patch("/api/payroll/:periodId/items/:itemId", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { adjustedAmount, notes } = req.body;
      const updated = await storage.updatePayrollLineItem(req.params.itemId, adjustedAmount, notes);
      res.json(updated);
    } catch (error) {
      console.error("Error updating payroll line item:", error);
      res.status(500).json({ message: "Failed to update payroll line item" });
    }
  });

  // Send payroll email to salesperson + optional additional recipients
  app.post("/api/payroll/:id/send", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { additionalEmails = [] } = req.body;
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ message: "Payroll period not found" });

      const startFmt = fmtDate(new Date(period.startDate), "MMM d, yyyy");
      const endFmt = fmtDate(new Date(period.endDate), "MMM d, yyyy");
      const periodLabel = `${startFmt} – ${endFmt}`;

      const lineRows = period.items.map((item) => {
        const typeLabel = item.type === "upfront" ? "New Sale (90%)" : "Recurring (10%)";
        const typeBg = item.type === "upfront" ? "#dcfce7" : "#dbeafe";
        const typeColor = item.type === "upfront" ? "#166534" : "#1d4ed8";
        const adj = parseFloat(item.adjustedAmount).toFixed(2);
        const orig = parseFloat(item.originalAmount).toFixed(2);
        const adjNote = adj !== orig ? ` <em style="color:#6b7280;">(orig $${orig})</em>` : "";
        return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px;">${fmtDate(new Date(item.date), "MMM d, yyyy")}</td><td style="padding:8px 12px;">${item.contactName}</td><td style="padding:8px 12px;">${item.dealTitle}</td><td style="padding:8px 12px;">${item.planName}</td><td style="padding:8px 12px;"><span style="background:${typeBg};color:${typeColor};padding:2px 8px;border-radius:9999px;font-size:12px;">${typeLabel}</span></td><td style="padding:8px 12px;text-align:right;font-weight:600;">$${adj}${adjNote}</td><td style="padding:8px 12px;color:#9ca3af;font-size:12px;">${item.notes || ""}</td></tr>`;
      }).join("");

      const notesSection = period.notes ? `<div style="margin-top:20px;padding:12px;background:#f9fafb;border-radius:6px;"><strong>Notes:</strong> ${period.notes}</div>` : "";

      const html = `<div style="font-family:Arial,sans-serif;max-width:820px;margin:0 auto;background:#fff;padding:32px;"><h1 style="color:#111827;font-size:22px;margin-bottom:4px;">Commission Pay Statement</h1><p style="color:#6b7280;margin-bottom:24px;">${period.salespersonName} &bull; ${periodLabel}</p><table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;"><thead><tr style="background:#f9fafb;"><th style="padding:10px 12px;text-align:left;font-size:13px;color:#374151;">Date</th><th style="padding:10px 12px;text-align:left;font-size:13px;color:#374151;">Contact</th><th style="padding:10px 12px;text-align:left;font-size:13px;color:#374151;">Deal</th><th style="padding:10px 12px;text-align:left;font-size:13px;color:#374151;">Plan</th><th style="padding:10px 12px;text-align:left;font-size:13px;color:#374151;">Type</th><th style="padding:10px 12px;text-align:right;font-size:13px;color:#374151;">Amount</th><th style="padding:10px 12px;text-align:left;font-size:13px;color:#374151;">Notes</th></tr></thead><tbody>${lineRows}</tbody><tfoot><tr style="background:#f0fdf4;"><td colspan="5" style="padding:12px;font-weight:700;color:#111827;">Total Pay for Period</td><td style="padding:12px;text-align:right;font-weight:700;font-size:16px;color:#16a34a;">$${parseFloat(period.totalAmount).toFixed(2)}</td><td></td></tr></tfoot></table>${notesSection}<p style="margin-top:24px;color:#9ca3af;font-size:11px;">Generated by ESyCRM on ${fmtDate(new Date(), "MMMM d, yyyy")}.</p></div>`;

      const allRecipients = [period.salespersonEmail, ...additionalEmails].filter(Boolean);
      for (const email of allRecipients) {
        await sendEmail({ to: email, subject: `Commission Pay Statement: ${period.salespersonName} — ${periodLabel}`, body: html });
      }

      await storage.updatePayrollPeriod(req.params.id, { status: "sent", sentAt: new Date(), sentToEmails: allRecipients.join(", ") });
      res.json({ success: true, sentTo: allRecipients.join(", ") });
    } catch (error) {
      console.error("Error sending payroll email:", error);
      res.status(500).json({ message: "Failed to send payroll email" });
    }
  });

  // Email Sequences routes - All protected with isAuthenticated
  app.get("/api/email-sequences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const track = req.query.track as string | undefined;
      
      let sequences;
      if (track) {
        sequences = await storage.getEmailSequencesByTrack(userId, track);
      } else {
        sequences = await storage.getEmailSequences(userId);
      }
      res.json(sequences);
    } catch (error) {
      console.error("Error fetching email sequences:", error);
      res.status(500).json({ message: "Failed to fetch email sequences" });
    }
  });

  app.get("/api/email-sequences/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const sequence = await storage.getEmailSequence(req.params.id, userId);
      if (!sequence) {
        return res.status(404).json({ message: "Email sequence not found" });
      }
      res.json(sequence);
    } catch (error) {
      console.error("Error fetching email sequence:", error);
      res.status(500).json({ message: "Failed to fetch email sequence" });
    }
  });

  app.post("/api/email-sequences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sequenceData = insertEmailSequenceSchema.parse(req.body);
      const sequence = await storage.createEmailSequence(sequenceData, userId);
      res.status(201).json(sequence);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid email sequence data", errors: error.errors });
      }
      console.error("Error creating email sequence:", error);
      res.status(500).json({ message: "Failed to create email sequence" });
    }
  });

  app.patch("/api/email-sequences/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const sequenceData = insertEmailSequenceSchema.partial().parse(req.body);
      const sequence = await storage.updateEmailSequence(req.params.id, sequenceData, userId);
      if (!sequence) {
        return res.status(404).json({ message: "Email sequence not found" });
      }
      res.json(sequence);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid email sequence data", errors: error.errors });
      }
      console.error("Error updating email sequence:", error);
      res.status(500).json({ message: "Failed to update email sequence" });
    }
  });

  app.delete("/api/email-sequences/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteEmailSequence(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Email sequence not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting email sequence:", error);
      res.status(500).json({ message: "Failed to delete email sequence" });
    }
  });

  // Email Sequence Logs routes
  app.get("/api/email-sequence-logs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { contactId } = req.query;
      const logs = await storage.getEmailSequenceLogs(userId, contactId as string | undefined);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching email sequence logs:", error);
      res.status(500).json({ message: "Failed to fetch email sequence logs" });
    }
  });

  app.post("/api/email-sequence-logs/bulk", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user); // null for admin, user ID for salesperson
      const { sequenceId, contactIds, scheduledSendAt, customSubject, customBody } = req.body;
      
      if (!sequenceId || typeof sequenceId !== 'string') {
        return res.status(400).json({ message: "Invalid sequenceId" });
      }
      
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ message: "Invalid contactIds. Expected a non-empty array." });
      }

      const scheduledDate = scheduledSendAt ? new Date(scheduledSendAt) : null;
      
      const result = await storage.bulkCreateEmailSequenceLogs(
        sequenceId, contactIds, userId, scheduledDate,
        customSubject || undefined, customBody || undefined
      );
      
      res.status(201).json({
        total: contactIds.length,
        successful: result.successful.length,
        failed: result.failed.length,
        logs: result.successful,
        errors: result.failed
      });
    } catch (error) {
      console.error("Error adding contacts to email sequence:", error);
      res.status(500).json({ message: "Failed to add contacts to email sequence" });
    }
  });

  app.delete("/api/email-sequence-logs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const log = await storage.getEmailSequenceLogById(req.params.id, userId);
      if (!log) {
        return res.status(404).json({ message: "Email sequence log not found" });
      }
      if (log.status !== "pending") {
        return res.status(400).json({ message: "Only pending emails can be cancelled" });
      }
      await storage.deleteEmailSequenceLog(req.params.id, userId);
      res.json({ message: "Email cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling email sequence log:", error);
      res.status(500).json({ message: "Failed to cancel email" });
    }
  });

  app.patch("/api/email-sequence-logs/:id/reschedule", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const schema = z.object({
        scheduledSendAt: z.string().min(1).refine((val) => !isNaN(Date.parse(val)), { message: "Invalid date format" }),
        customSubject: z.string().optional(),
        customBody: z.string().optional(),
      });
      const { scheduledSendAt, customSubject, customBody } = schema.parse(req.body);

      const log = await storage.getEmailSequenceLogById(req.params.id, userId);
      if (!log) {
        return res.status(404).json({ message: "Email sequence log not found" });
      }
      if (log.status !== "pending") {
        return res.status(400).json({ message: "Only pending emails can be updated" });
      }

      const updateFields: Record<string, unknown> = { scheduledSendAt: new Date(scheduledSendAt) };
      if (customSubject !== undefined) updateFields.customSubject = customSubject || null;
      if (customBody !== undefined) updateFields.customBody = customBody || null;

      const updated = await storage.updateEmailSequenceLog(req.params.id, updateFields as any, userId);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "scheduledSendAt is required", errors: error.errors });
      }
      console.error("Error updating email sequence log:", error);
      res.status(500).json({ message: "Failed to update email" });
    }
  });

  // Sync open/click analytics from Brevo for a single log entry
  app.post("/api/email-sequence-logs/:id/sync-analytics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const log = await storage.getEmailSequenceLogById(req.params.id, userId);
      if (!log) return res.status(404).json({ message: "Log not found" });
      if (!log.brevoMessageId) return res.json({ ...log, _syncNote: "No Brevo message ID stored for this email" });

      const BREVO_API_KEY = process.env.BREVO_API_KEY;
      if (!BREVO_API_KEY) return res.status(500).json({ message: "Brevo API key not configured" });

      const mid = encodeURIComponent(log.brevoMessageId);
      const [openRes, clickRes] = await Promise.all([
        fetch(`https://api.brevo.com/v3/smtp/statistics/events?messageId=${mid}&event=opened&limit=10`, { headers: { "api-key": BREVO_API_KEY } }),
        fetch(`https://api.brevo.com/v3/smtp/statistics/events?messageId=${mid}&event=clicks&limit=10`, { headers: { "api-key": BREVO_API_KEY } }),
      ]);

      const [openData, clickData] = await Promise.all([
        openRes.ok ? openRes.json() as any : { events: [] },
        clickRes.ok ? clickRes.json() as any : { events: [] },
      ]);

      const openEvents: any[] = openData?.events ?? [];
      const clickEvents: any[] = clickData?.events ?? [];
      const updates: Record<string, unknown> = {};
      if (openEvents.length > 0 && !log.openedAt) {
        updates.openedAt = new Date(openEvents[0].date);
      }
      if (clickEvents.length > 0 && !log.clickedAt) {
        updates.clickedAt = new Date(clickEvents[0].date);
      }

      if (Object.keys(updates).length > 0) {
        await storage.updateEmailSequenceLog(log.id, updates as any, null);
      }
      const updated = await storage.getEmailSequenceLogById(req.params.id, userId);
      res.json(updated);
    } catch (error) {
      console.error("Error syncing analytics:", error);
      res.status(500).json({ message: "Failed to sync analytics" });
    }
  });

  // Bulk sync: refresh analytics for all sent sequence emails that have a brevoMessageId
  app.post("/api/email-analytics/sync-all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const BREVO_API_KEY = process.env.BREVO_API_KEY;
      if (!BREVO_API_KEY) return res.status(500).json({ message: "Brevo API key not configured" });

      const logs = await storage.getEmailSequenceLogs(userId);
      const sentWithId = logs.filter(l => l.status === "sent" && l.brevoMessageId && (!l.openedAt || !l.clickedAt));

      let updated = 0;
      for (const log of sentWithId) {
        try {
          const mid = encodeURIComponent(log.brevoMessageId!);
          const [openRes, clickRes] = await Promise.all([
            fetch(`https://api.brevo.com/v3/smtp/statistics/events?messageId=${mid}&event=opened&limit=10`, { headers: { "api-key": BREVO_API_KEY } }),
            fetch(`https://api.brevo.com/v3/smtp/statistics/events?messageId=${mid}&event=clicks&limit=10`, { headers: { "api-key": BREVO_API_KEY } }),
          ]);
          const [openData, clickData] = await Promise.all([
            openRes.ok ? openRes.json() as any : { events: [] },
            clickRes.ok ? clickRes.json() as any : { events: [] },
          ]);
          const openEvents: any[] = openData?.events ?? [];
          const clickEvents: any[] = clickData?.events ?? [];
          const updates: Record<string, unknown> = {};
          if (openEvents.length > 0 && !log.openedAt) updates.openedAt = new Date(openEvents[0].date);
          if (clickEvents.length > 0 && !log.clickedAt) updates.clickedAt = new Date(clickEvents[0].date);
          if (Object.keys(updates).length > 0) {
            await storage.updateEmailSequenceLog(log.id, updates as any, null);
            updated++;
          }
        } catch (e) {
          console.error(`[Analytics] Failed for log ${log.id}:`, e);
        }
      }
      res.json({ checked: sentWithId.length, updated });
    } catch (error) {
      console.error("Error in bulk analytics sync:", error);
      res.status(500).json({ message: "Failed to sync analytics" });
    }
  });

  app.post("/api/email-sequence-logs/initiate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userIdForQuery = getUserIdForQuery(req.user);
      const schema = z.object({
        contactId: z.string().min(1),
        scheduledSendAt: z.string().min(1).refine((val) => !isNaN(Date.parse(val)), { message: "Invalid date format" }),
      });
      const { contactId, scheduledSendAt } = schema.parse(req.body);

      const contact = await storage.getContact(contactId, userIdForQuery);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      const bTypeSeq = contact.businessType || "salon";
      const softwareStatusSeq = contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software";
      const sequenceTrack = `${bTypeSeq}_${softwareStatusSeq}`;

      const ownerId = contact.userId;
      const ownerSequences = await storage.getEmailSequencesByTrack(ownerId, sequenceTrack);
      const sequence1 = ownerSequences.find(s => s.sequenceNumber === 1);
      if (!sequence1) {
        const trackLabel = sequenceTrack.replace("salon_", "Salon - ").replace("mobile_", "Mobile - ").replace("_", " ").replace("no software", "No Software").replace("uses competitor", "Uses Competitor");
        return res.status(400).json({ message: `No Sequence 1 template found for the "${trackLabel}" track. Please create one first in Email Sequences.` });
      }

      const existingLogs = await storage.getEmailSequenceLogs(userIdForQuery, contactId);
      const hasSequence1 = existingLogs.some(l => l.sequenceNumber === 1 && l.sequenceTrack === sequenceTrack);
      if (hasSequence1) {
        return res.status(400).json({ message: "Sequence 1 has already been started for this contact" });
      }

      const log = await storage.createEmailSequenceLog(
        {
          contactId,
          sequenceId: sequence1.id,
          sequenceTrack,
          sequenceNumber: 1,
          status: "pending",
          scheduledSendAt: new Date(scheduledSendAt),
        },
        ownerId
      );

      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "contactId and scheduledSendAt are required", errors: error.errors });
      }
      console.error("Error initiating email sequence:", error);
      res.status(500).json({ message: "Failed to initiate email sequence" });
    }
  });

  // Admin reports - Salesperson rankings
  app.get("/api/admin/salesperson-rankings", isAdmin, async (req: any, res) => {
    try {
      // Get all users (salespeople and admins)
      const allDeals = await storage.getDeals(null); // Get all deals
      const allUsers = await storage.getAllUsers(); // Need to add this method
      
      // Calculate metrics per salesperson
      const rankings = allUsers
        .filter(user => user.role === "salesperson") // Only rank salespeople
        .map(user => {
          const userDeals = allDeals.filter(deal => deal.userId === user.id);
          const wonDeals = userDeals.filter(deal => deal.stage === "won");
          const totalDeals = userDeals.length;
          const totalValue = wonDeals.reduce((sum, deal) => sum + parseFloat(deal.value || "0"), 0);
          const winRate = totalDeals > 0 ? (wonDeals.length / totalDeals) * 100 : 0;
          const avgDealValue = wonDeals.length > 0 ? totalValue / wonDeals.length : 0;
          
          return {
            userId: user.id,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown',
            dealsWon: wonDeals.length,
            totalValue,
            totalDeals,
            winRate,
            avgDealValue,
          };
        })
        .sort((a, b) => b.dealsWon - a.dealsWon); // Sort by deals won (descending)
      
      res.json(rankings);
    } catch (error) {
      console.error("Error fetching salesperson rankings:", error);
      res.status(500).json({ message: "Failed to fetch salesperson rankings" });
    }
  });

  // Export endpoints - Admin only
  app.get("/api/export/contacts", isAdmin, async (req: any, res) => {
    try {
      const contacts = await storage.getContacts(null); // null = get all data (admin)
      // Transform data to use desired column headers
      const transformedContacts = contacts.map((contact: any) => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        jobTitle: contact.jobTitle,
        "Currently uses software": contact.usesSoftware,
        "Software Used": contact.currentSoftware,
        "Booking Software URL": contact.bookingSoftwareUrl,
        "Has Web Site": contact.hasWebsite,
        "Web Site Address": contact.websiteUrl,
        "Contact Request Form URL": contact.contactRequestFormUrl,
        source: contact.leadSource,
        notes: contact.notes,
        userId: contact.userId,
      }));
      const csv = Papa.unparse(transformedContacts, { header: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
      res.send(csv);
    } catch (error) {
      console.error("Error exporting contacts:", error);
      res.status(500).json({ message: "Failed to export contacts" });
    }
  });

  app.get("/api/export/deals", isAdmin, async (req: any, res) => {
    try {
      const deals = await storage.getDeals(null); // null = get all data (admin)
      // Use explicit fields to ensure consistent CSV format even with empty data
      const fields = ['id', 'title', 'description', 'stage', 'value', 'probability', 'expectedCloseDate', 'contactId', 'userId'];
      const csv = Papa.unparse(deals, { header: true, columns: fields });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=deals.csv');
      res.send(csv);
    } catch (error) {
      console.error("Error exporting deals:", error);
      res.status(500).json({ message: "Failed to export deals" });
    }
  });

  app.get("/api/export/tasks", isAdmin, async (req: any, res) => {
    try {
      const tasks = await storage.getTasks(null); // null = get all data (admin)
      // Use explicit fields to ensure consistent CSV format even with empty data
      const fields = ['id', 'title', 'description', 'status', 'priority', 'dueDate', 'completedAt', 'contactId', 'dealId', 'userId'];
      const csv = Papa.unparse(tasks, { header: true, columns: fields });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=tasks.csv');
      res.send(csv);
    } catch (error) {
      console.error("Error exporting tasks:", error);
      res.status(500).json({ message: "Failed to export tasks" });
    }
  });

  // Inbox routes - All protected with isAuthenticated
  app.get("/api/inbox", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const { contactId } = req.query;
      const messages = await storage.getInboxMessages(userId, contactId as string | undefined);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching inbox messages:", error);
      res.status(500).json({ message: "Failed to fetch inbox messages" });
    }
  });

  app.get("/api/inbox/unread-count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const count = await storage.getUnreadCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.get("/api/inbox/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const message = await storage.getInboxMessage(req.params.id, userId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }
      res.json(message);
    } catch (error) {
      console.error("Error fetching inbox message:", error);
      res.status(500).json({ message: "Failed to fetch inbox message" });
    }
  });

  app.patch("/api/inbox/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const message = await storage.updateInboxMessage(req.params.id, req.body, userId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }
      res.json(message);
    } catch (error) {
      console.error("Error updating inbox message:", error);
      res.status(500).json({ message: "Failed to update inbox message" });
    }
  });

  app.delete("/api/inbox/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteInboxMessage(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Message not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting inbox message:", error);
      res.status(500).json({ message: "Failed to delete inbox message" });
    }
  });

  // Brevo inbound parse webhook - PUBLIC endpoint for receiving email replies
  app.post("/api/webhooks/sendgrid/inbound", async (req: any, res) => {
    try {
      console.log("[Inbound] Received webhook. Content-Type:", req.headers["content-type"]);
      console.log("[Inbound] Body type:", Array.isArray(req.body) ? "array" : typeof req.body);

      // Brevo sends inbound emails as a JSON array of message objects
      // Fall back to legacy form-urlencoded format (SendGrid-style) if not Brevo format
      let from = "";
      let subject = "";
      let text = "";
      let html = "";

      const body = req.body;

      if (Array.isArray(body) && body.length > 0) {
        // Brevo inbound JSON format
        const msg = body[0];
        const fromAddr = msg.From?.Address || "";
        const fromName = msg.From?.Name || "";
        from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
        subject = msg.Subject || "";
        text = msg.RawTextBody || "";
        html = msg.RawHtmlBody || "";
        console.log(`[Inbound] Brevo format — from: ${from}, subject: ${subject}`);
      } else if (typeof body === "object" && body.from) {
        // Legacy form-urlencoded format
        from = body.from || "";
        subject = body.subject || "";
        text = body.text || "";
        html = body.html || "";
        console.log(`[Inbound] Legacy format — from: ${from}, subject: ${subject}`);
      } else {
        console.log("[Inbound] Unrecognized body format, ignoring.");
        return res.status(200).send("OK");
      }

      // Extract plain email address from "Name <email@domain.com>" format
      const fromEmailMatch = from.match(/<(.+?)>/);
      const fromEmail = fromEmailMatch ? fromEmailMatch[1] : from.trim();

      // Try to find the contact by email
      const contacts = await storage.getContacts(null);
      const contact = contacts.find(c => c.email?.toLowerCase() === fromEmail.toLowerCase());

      if (!contact) {
        console.log(`[Inbound] Email from unknown sender: ${fromEmail} — ignoring`);
        return res.status(200).send("OK");
      }

      // Create inbox message for the contact's owner (salesperson)
      await storage.createInboxMessage({
        contactId: contact.id,
        emailSequenceLogId: null,
        from,
        subject,
        bodyText: text,
        bodyHtml: html,
        isRead: "false"
      }, contact.userId);

      console.log(`[Inbound] Created inbox message from ${fromEmail} for salesperson ${contact.userId}`);

      // Cancel all pending (scheduled) sequence emails for this contact — they replied
      try {
        const allLogs = await storage.getEmailSequenceLogs(null, contact.id);
        const pendingLogs = allLogs.filter(l => l.status === "pending");
        if (pendingLogs.length > 0) {
          await Promise.all(pendingLogs.map(l => storage.deleteEmailSequenceLog(l.id, null)));
          console.log(`[Inbound] Cancelled ${pendingLogs.length} pending sequence(s) for contact ${contact.id} after reply from ${fromEmail}`);
        }
      } catch (cancelErr) {
        console.error("[Inbound] Failed to cancel pending sequences after reply:", cancelErr);
      }

      // Notify the salesperson
      const salesperson = await storage.getUser(contact.userId);
      if (salesperson) {
        const contactName = `${contact.firstName} ${contact.lastName || ""}`.trim();
        sendReplyNotificationEmail({ salesperson, contactName }).catch(err => {
          console.error("[Inbound] Failed to send reply notification:", err);
        });
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("[Inbound] Error processing inbound email:", error);
      res.status(500).json({ message: "Failed to process inbound email" });
    }
  });

  // Lead Discovery Routes
  app.get("/api/lead-discovery/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const jobs = await storage.getLeadDiscoveryJobs(userId);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching lead discovery jobs:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  app.get("/api/lead-discovery/jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const job = await storage.getLeadDiscoveryJob(req.params.id, userId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error("Error fetching lead discovery job:", error);
      res.status(500).json({ message: "Failed to fetch job" });
    }
  });

  app.post("/api/lead-discovery/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const jobData = insertLeadDiscoveryJobSchema.parse(req.body);
      const job = await storage.createLeadDiscoveryJob(jobData, userId);
      
      // Start the job asynchronously
      runLeadDiscoveryJob(job.id, userId).catch(err => {
        console.error("Lead discovery job failed:", err);
      });
      
      res.status(201).json(job);
    } catch (error) {
      console.error("Error creating lead discovery job:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid job data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  app.post("/api/lead-discovery/jobs/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const job = await storage.updateLeadDiscoveryJob(req.params.id, {
        status: "cancelled",
        completedAt: new Date(),
      }, userId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error("Error cancelling job:", error);
      res.status(500).json({ message: "Failed to cancel job" });
    }
  });

  app.delete("/api/lead-discovery/jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const deleted = await storage.deleteLeadDiscoveryJob(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json({ message: "Job deleted" });
    } catch (error) {
      console.error("Error deleting job:", error);
      res.status(500).json({ message: "Failed to delete job" });
    }
  });

  app.get("/api/lead-discovery/jobs/:id/results", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const results = await storage.getLeadDiscoveryResults(req.params.id, userId);
      res.json(results);
    } catch (error) {
      console.error("Error fetching results:", error);
      res.status(500).json({ message: "Failed to fetch results" });
    }
  });

  app.get("/api/lead-discovery/all-results", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const results = await storage.getAllLeadDiscoveryResults(userId);
      res.json(results);
    } catch (error) {
      console.error("Error fetching all results:", error);
      res.status(500).json({ message: "Failed to fetch all results" });
    }
  });

  app.post("/api/lead-discovery/import", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { resultIds } = req.body;
      
      if (!Array.isArray(resultIds) || resultIds.length === 0) {
        return res.status(400).json({ message: "No result IDs provided" });
      }

      const { imported, errors } = await importResultsToCRM(resultIds, userId);
      res.json({ imported, errors });
    } catch (error) {
      console.error("Error importing results:", error);
      res.status(500).json({ message: "Failed to import results" });
    }
  });

  app.delete("/api/lead-discovery/results/:resultId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      await storage.deleteLeadDiscoveryResult(req.params.resultId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting result:", error);
      res.status(500).json({ message: "Failed to delete result" });
    }
  });

  app.get("/api/lead-discovery/export/:jobId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const results = await storage.getLeadDiscoveryResults(req.params.jobId, userId);
      
      // Transform to CRM format
      const csvData = results.map(r => ({
        id: r.id,
        firstName: r.firstName || "",
        lastName: r.lastName || "",
        email: r.email || "",
        phone: r.phone || "",
        company: r.company || "",
        jobTitle: r.jobTitle || "",
        "Currently uses software": r.usesSoftware || "",
        "Software Used": r.currentSoftware || "",
        "Booking Software URL": r.bookingSoftwareUrl || "",
        "Has Web Site": r.hasWebsite || "",
        "Web Site Address": r.websiteUrl || "",
        "Contact Request Form URL": r.contactRequestFormUrl || "",
        source: r.leadSource || "",
        notes: r.notes || "",
        userId: r.userId || "",
      }));

      const csv = Papa.unparse(csvData, { header: true });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=lead-discovery-${req.params.jobId}.csv`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting results:", error);
      res.status(500).json({ message: "Failed to export results" });
    }
  });

  // Check if SerpAPI key is configured and get full status
  app.get("/api/lead-discovery/config", isAuthenticated, async (req: any, res) => {
    try {
      const { getSerpUsageStatus, canRunDiscovery, getActiveQueries } = await import("./lead-discovery");
      const status = await getSerpUsageStatus();
      const queries = await getActiveQueries();
      
      res.json({
        serpApiConfigured: !!process.env.SERPAPI_API_KEY,
        usage: {
          used: status.usage.usedCredits || 0,
          quota: status.usage.monthlyQuota || 250,
          hardStopAt: status.usage.hardStopAt || 200,
          warningLevel: status.warningLevel,
          isQuotaReached: status.isQuotaReached,
        },
        config: {
          queriesPerZip: status.config.queriesPerZip || 2,
          maxZipsPerRun: status.config.maxZipsPerRun || 3,
          maxRunsPerDay: status.config.maxRunsPerDay || 1,
          maxSerpCallsPerHour: status.config.maxSerpCallsPerHour || 5,
          enableThirdQuery: status.config.enableThirdQuery === "true",
          planType: status.config.planType || "free",
        },
        activeQueries: queries,
      });
    } catch (error) {
      res.json({
        serpApiConfigured: !!process.env.SERPAPI_API_KEY,
        usage: { used: 0, quota: 250, hardStopAt: 200, warningLevel: 'none', isQuotaReached: false },
        config: { queriesPerZip: 2, maxZipsPerRun: 3, maxRunsPerDay: 1, maxSerpCallsPerHour: 5, enableThirdQuery: false, planType: "free" },
        activeQueries: [],
      });
    }
  });

  // Admin: Update discovery config (toggle 3rd query, upgrade plan)
  app.patch("/api/lead-discovery/config", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { enableThirdQuery, planType, queriesPerZip, maxZipsPerRun, maxRunsPerDay, maxSerpCallsPerHour } = req.body;
      
      const updates: any = {};
      if (enableThirdQuery !== undefined) {
        updates.enableThirdQuery = enableThirdQuery ? "true" : "false";
      }
      if (planType) updates.planType = planType;
      if (queriesPerZip) updates.queriesPerZip = queriesPerZip;
      if (maxZipsPerRun) updates.maxZipsPerRun = maxZipsPerRun;
      if (maxRunsPerDay) updates.maxRunsPerDay = maxRunsPerDay;
      if (maxSerpCallsPerHour) updates.maxSerpCallsPerHour = maxSerpCallsPerHour;
      
      const config = await storage.updateLeadDiscoveryConfig("global", updates);
      
      // If upgrading to developer plan, update quota too
      if (planType === "developer") {
        const monthYear = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await storage.updateSerpQuota(monthYear, 5000, 4000);
      }
      
      res.json({ success: true, config });
    } catch (error) {
      res.status(500).json({ message: "Failed to update config" });
    }
  });

  // Pre-flight check before starting a job
  app.post("/api/lead-discovery/check", isAuthenticated, async (req: any, res) => {
    try {
      const { numZips } = req.body;
      const { canRunDiscovery } = await import("./lead-discovery");
      const result = await canRunDiscovery(req.user.id, numZips || 1);
      res.json(result);
    } catch (error) {
      res.status(500).json({ allowed: false, reason: "Check failed" });
    }
  });

  // ─── National Search Job Routes ───────────────────────────────────────────
  // List national jobs for the current user
  app.get("/api/lead-discovery/national-jobs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const jobs = await storage.getNationalSearchJobs(userId);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching national jobs:", error);
      res.status(500).json({ message: "Failed to fetch national jobs" });
    }
  });

  // Create and start a new national search job
  app.post("/api/lead-discovery/national-job", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Enforce per-day run limit (same as regular jobs — counts as one run for the day)
      const { canRunDiscovery, getSerpUsageStatus } = await import("./lead-discovery");
      const dailyCheck = await canRunDiscovery(userId, 1); // skipDailyCheck=false (default)
      if (!dailyCheck.allowed) {
        return res.status(400).json({ message: dailyCheck.reason || "Daily run limit reached" });
      }

      // Atomically check for an existing active job and create a new one if clear.
      // Returns null if a job is already running/pending (advisory lock prevents races).
      const job = await storage.createNationalSearchJob(userId);
      if (!job) {
        return res.status(409).json({
          message: "A national search is already running. Wait for it to finish (or cancel it) before starting a new one.",
        });
      }

      // Start asynchronously
      runNationalSearchJob(job.id, userId).catch(err => {
        console.error("[NationalSearch] Job runner error:", err);
      });

      res.status(201).json(job);
    } catch (error) {
      console.error("Error creating national job:", error);
      res.status(500).json({ message: "Failed to create national search job" });
    }
  });

  // Get status / progress of a national job
  app.get("/api/lead-discovery/national-job/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const job = await storage.getNationalSearchJob(req.params.id, userId);
      if (!job) return res.status(404).json({ message: "National job not found" });
      res.json(job);
    } catch (error) {
      console.error("Error fetching national job status:", error);
      res.status(500).json({ message: "Failed to fetch status" });
    }
  });

  // Cancel a national job
  app.post("/api/lead-discovery/national-job/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const job = await storage.getNationalSearchJob(req.params.id, userId);
      if (!job) return res.status(404).json({ message: "National job not found" });
      await storage.updateNationalSearchJob(job.id, { status: "cancelled", completedAt: new Date() });
      res.json({ message: "Cancellation requested" });
    } catch (error) {
      console.error("Error cancelling national job:", error);
      res.status(500).json({ message: "Failed to cancel job" });
    }
  });

  // Get all results for a national job (with state info)
  app.get("/api/lead-discovery/national-job/:id/results", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const job = await storage.getNationalSearchJob(req.params.id, userId);
      if (!job) return res.status(404).json({ message: "National job not found" });
      const results = await storage.getNationalJobResults(req.params.id, userId);
      res.json(results);
    } catch (error) {
      console.error("Error fetching national job results:", error);
      res.status(500).json({ message: "Failed to fetch results" });
    }
  });

  // Export national job results as Excel (.xlsx)
  app.get("/api/lead-discovery/national-job/:id/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const job = await storage.getNationalSearchJob(req.params.id, userId);
      if (!job) return res.status(404).json({ message: "National job not found" });

      const results = await storage.getNationalJobResults(req.params.id, userId);

      const rows = results.map(r => ({
        "Business Name": r.company || "",
        "State": r.state || "",
        "Address": r.address || "",
        "Phone": r.phone || "",
        "Email": r.email || "",
        "Owner First Name": r.firstName || "",
        "Owner Last Name": r.lastName || "",
        "Website URL": r.websiteUrl || "",
        "Uses Software": r.usesSoftware || "Unknown",
        "Business Type": r.jobTitle || "Salon",
        "Current Software": r.currentSoftware || "",
        "Booking Software URL": r.bookingSoftwareUrl || "",
        "ZIP Code": r.zipCode || "",
        "Import Status": r.isImported === "true" ? "Imported" : "Not Imported",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "National Search Results");

      // Set column widths
      ws["!cols"] = [
        { wch: 35 }, { wch: 6 }, { wch: 35 }, { wch: 16 }, { wch: 30 },
        { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 14 }, { wch: 10 },
        { wch: 20 }, { wch: 40 }, { wch: 10 }, { wch: 14 },
      ];

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=national-search-${req.params.id.slice(0, 8)}.xlsx`);
      res.send(buf);
    } catch (error) {
      console.error("Error exporting national job:", error);
      res.status(500).json({ message: "Failed to export results" });
    }
  });
  // ──────────────────────────────────────────────────────────────────────────

  // ─── Admin Brevo Connection Ping ───────────────────────────────────────────
  app.post("/api/admin/sendgrid-ping", isAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user.claims.sub;
      const adminUser = await storage.getUser(adminUserId);
      const toEmail = adminUser?.workEmail || adminUser?.email;
      if (!toEmail) return res.status(400).json({ message: "No email address found for your account" });

      const { sendEmail } = await import("./sendgrid");
      const result = await sendEmail({
        to: toEmail,
        subject: "EsyPet CRM — Brevo Connection Test",
        body: "Your Brevo API key is working correctly.\n\nYou can now use email sequences in EsyPet CRM.\n\nhttps://EsyPet-CRM.replit.app",
      });

      if (result.success) {
        res.json({ success: true, message: `Test email sent to ${toEmail}` });
      } else {
        res.status(400).json({ success: false, message: result.error });
      }
    } catch (error) {
      console.error("SendGrid ping error:", error);
      res.status(500).json({ success: false, message: "Failed to send test email" });
    }
  });
  // ──────────────────────────────────────────────────────────────────────────

  // ─── Admin Sequence Test Routes ───────────────────────────────────────────
  app.post("/api/admin/sequence-test/start", isAdmin, async (req: any, res) => {
    try {
      const schema = z.object({
        contactId: z.string().min(1),
        track: z.enum(["no_software", "uses_competitor"]),
        toEmail: z.string().email(),
      });
      const { contactId, track, toEmail } = schema.parse(req.body);

      const adminUserId = req.user.claims.sub;
      const adminUser = await storage.getUser(adminUserId);
      if (!adminUser) return res.status(404).json({ message: "Admin user not found" });

      const contact = await storage.getContact(contactId, null);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const sequences = await storage.getEmailSequencesByTrack(adminUserId, track);
      if (sequences.length === 0) {
        return res.status(400).json({
          message: `No sequences found for the "${track === "no_software" ? "No Software" : "Uses Competitor"}" track. Please create your email sequences first.`
        });
      }

      const id = Math.random().toString(36).slice(2, 10);
      const run: TestRun = {
        id,
        adminUserId,
        adminEmail: adminUser.workEmail || adminUser.email || toEmail,
        contactId,
        contactName: `${contact.firstName} ${contact.lastName || ""}`.trim(),
        track,
        toEmail,
        status: "running",
        startedAt: new Date(),
        steps: [1, 2, 3, 4, 5].map(n => ({ sequenceNumber: n, status: n === 1 ? "sending" : "pending" })),
      };

      testRuns.set(id, run);

      // Fire and forget — run in background
      runSequenceTest(run).catch(err => console.error("Sequence test error:", err));

      res.status(201).json(run);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Error starting sequence test:", error);
      res.status(500).json({ message: "Failed to start test" });
    }
  });

  app.get("/api/admin/sequence-test/:id", isAdmin, async (req: any, res) => {
    const run = testRuns.get(req.params.id);
    if (!run) return res.status(404).json({ message: "Test run not found" });
    res.json(run);
  });
  // ──────────────────────────────────────────────────────────────────────────

  const httpServer = createServer(app);
  return httpServer;
}
