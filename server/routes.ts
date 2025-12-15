// From Replit Auth blueprint
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { insertContactSchema, insertContactGroupSchema, insertDealSchema, insertTaskSchema, insertEmailSequenceSchema, type InsertContact } from "@shared/schema";
import { z } from "zod";
import Papa from "papaparse";

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
        firstName: z.string().optional(),
        lastName: z.string().optional(),
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

  // Contacts routes - All protected with isAuthenticated
  app.get("/api/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserIdForQuery(req.user); // null for admin, user ID for salesperson
      const { search } = req.query;
      const contacts = search 
        ? await storage.searchContacts(search as string, userId)
        : await storage.getContacts(userId);
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
      const userId = getUserIdForQuery(req.user);
      const { stage } = req.query;
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
      const sequences = await storage.getEmailSequences(userId);
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
      // Use explicit fields to ensure consistent CSV format even with empty data
      const fields = ['id', 'firstName', 'lastName', 'email', 'phone', 'company', 'jobTitle', 'source', 'notes', 'userId'];
      const csv = Papa.unparse(contacts, { header: true, columns: fields });
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
      const messages = await storage.getInboxMessages(userId);
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
        emailSequenceLogId: null, // We can enhance this later to link to specific sequences
        from: from,
        subject: subject,
        bodyText: text,
        bodyHtml: html,
        isRead: "false"
      }, contact.userId);
      
      console.log(`Inbox: Created message from ${fromEmail} for user ${contact.userId}`);
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing inbound email:", error);
      res.status(500).json({ message: "Failed to process inbound email" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
