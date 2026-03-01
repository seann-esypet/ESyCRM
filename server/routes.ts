// From Replit Auth blueprint
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { insertContactSchema, insertContactGroupSchema, insertDealSchema, insertTaskSchema, insertEmailSequenceSchema, insertLeadDiscoveryJobSchema, type InsertContact } from "@shared/schema";
import { z } from "zod";
import Papa from "papaparse";
import { runLeadDiscoveryJob, importResultsToCRM } from "./lead-discovery";
import { sendReplyNotificationEmail, sendEmail, replaceTemplateVariables } from "./sendgrid";

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
        fromEmail: salesperson.workEmail || salesperson.email || "noreply@esypet.com",
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
      `Track: ${run.track === "no_software" ? "No Software" : "Uses Competitor"}`,
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
      fromEmail: "noreply@esypet.com",
      fromName: "EsyPet CRM",
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
          // Determine sequence track based on usesSoftware field
          // "Yes" means they use competitor software, otherwise "no_software"
          const sequenceTrack = contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software";
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
      const deal = await storage.updateDeal(req.params.id, dealData, userId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      // When deal is moved to "qualified_lead" stage, assign sequence track to contact
      if (dealData.stage === "qualified_lead" && deal.contactId) {
        const contact = await storage.getContact(deal.contactId, userId);
        if (contact) {
          // Determine sequence track based on usesSoftware field
          // "Yes" means they use competitor software, otherwise "no_software"
          const sequenceTrack = contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software";
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
      const stages = ["new_lead_unqualified", "qualified_lead", "contacted_left_message", "contacted_spoke_to_decision_maker", "onboarded_form_completed", "demo_scheduled", "demo_completed", "decision_pending", "won"];
      
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

  // Get commission summary for authenticated user
  app.get("/api/commissions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user); // null for admin, userId for salesperson
      const deals = await storage.getDeals(userId);
      
      // Only include won deals that are approved
      const approvedDeals = deals.filter(
        deal => deal.stage === "won" && deal.approved === "approved"
      );
      
      res.json(approvedDeals);
    } catch (error) {
      console.error("Error fetching commissions:", error);
      res.status(500).json({ message: "Failed to fetch commissions" });
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
      const { sequenceId, contactIds } = req.body;
      
      if (!sequenceId || typeof sequenceId !== 'string') {
        return res.status(400).json({ message: "Invalid sequenceId" });
      }
      
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ message: "Invalid contactIds. Expected a non-empty array." });
      }
      
      const result = await storage.bulkCreateEmailSequenceLogs(sequenceId, contactIds, userId);
      
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

  app.patch("/api/email-sequence-logs/:id/reschedule", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user);
      const schema = z.object({
        scheduledSendAt: z.string().min(1).refine((val) => !isNaN(Date.parse(val)), { message: "Invalid date format" }),
      });
      const { scheduledSendAt } = schema.parse(req.body);

      const log = await storage.getEmailSequenceLogById(req.params.id, userId);
      if (!log) {
        return res.status(404).json({ message: "Email sequence log not found" });
      }
      if (log.status !== "pending") {
        return res.status(400).json({ message: "Only pending emails can be rescheduled" });
      }

      const updated = await storage.updateEmailSequenceLog(
        req.params.id,
        { scheduledSendAt: new Date(scheduledSendAt) },
        userId
      );
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "scheduledSendAt is required", errors: error.errors });
      }
      console.error("Error rescheduling email sequence log:", error);
      res.status(500).json({ message: "Failed to reschedule email" });
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

      const sequenceTrack = contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software";

      const ownerId = contact.userId;
      const ownerSequences = await storage.getEmailSequencesByTrack(ownerId, sequenceTrack);
      const sequence1 = ownerSequences.find(s => s.sequenceNumber === 1);
      if (!sequence1) {
        return res.status(400).json({ message: `No Sequence 1 template found for the "${sequenceTrack === "no_software" ? "No Software" : "Uses Competitor"}" track. Please create one first in Email Sequences.` });
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

  // SendGrid inbound parse webhook - PUBLIC endpoint with optional verification
  // Note: For production, configure SENDGRID_WEBHOOK_VERIFY_KEY in environment
  app.post("/api/webhooks/sendgrid/inbound", async (req: any, res) => {
    try {
      // Optional: Verify SendGrid webhook signature for security
      // This prevents unauthorized parties from spoofing inbound emails
      const verifyKey = process.env.SENDGRID_WEBHOOK_VERIFY_KEY;
      if (verifyKey && req.headers['x-twilio-email-event-webhook-signature']) {
        // In production, implement full signature verification here
        // For now, we'll just log a warning if the key is set but not verified
        console.warn("SendGrid webhook verification key is set but signature verification is not fully implemented");
      }
      
      // SendGrid sends webhook data as form-urlencoded or multipart
      const from = req.body.from || "";
      const to = req.body.to || "";
      const subject = req.body.subject || "";
      const text = req.body.text || "";
      const html = req.body.html || "";
      
      // Extract email address from "Name <email@domain.com>" format
      const fromEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)[1] : from;
      
      // Try to find the contact by email
      const contacts = await storage.getContacts(null); // Get all contacts (admin view)
      const contact = contacts.find(c => c.email?.toLowerCase() === fromEmail.toLowerCase());
      
      if (!contact) {
        console.log(`Inbox: Received email from unknown sender: ${fromEmail}`);
        return res.status(200).send("OK"); // Acknowledge receipt but don't create message
      }
      
      // Create inbox message for the contact's owner (salesperson)
      await storage.createInboxMessage({
        contactId: contact.id,
        emailSequenceLogId: null,
        from: from,
        subject: subject,
        bodyText: text,
        bodyHtml: html,
        isRead: "false"
      }, contact.userId);
      
      console.log(`Inbox: Created message from ${fromEmail} for user ${contact.userId}`);

      // Send notification email to the salesperson
      const salesperson = await storage.getUser(contact.userId);
      if (salesperson) {
        const contactName = `${contact.firstName} ${contact.lastName || ''}`.trim();
        sendReplyNotificationEmail({ salesperson, contactName }).catch(err => {
          console.error("Failed to send reply notification:", err);
        });
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing inbound email:", error);
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

  // ─── Admin SendGrid Connection Ping ───────────────────────────────────────
  app.post("/api/admin/sendgrid-ping", isAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user.claims.sub;
      const adminUser = await storage.getUser(adminUserId);
      const toEmail = adminUser?.workEmail || adminUser?.email;
      if (!toEmail) return res.status(400).json({ message: "No email address found for your account" });

      const { sendEmail } = await import("./sendgrid");
      const result = await sendEmail({
        to: toEmail,
        subject: "EsyPet CRM — SendGrid Connection Test",
        body: "Your SendGrid API key is working correctly.\n\nYou can now use email sequences in EsyPet CRM.\n\nhttps://EsyPet-CRM.replit.app",
        fromEmail: toEmail,
        fromName: "EsyPet CRM",
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
