// From Replit Auth blueprint
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { insertContactSchema, insertDealSchema, insertTaskSchema, type InsertContact } from "@shared/schema";
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
      const { contacts: contactsData } = req.body;
      
      if (!Array.isArray(contactsData) || contactsData.length === 0) {
        return res.status(400).json({ message: "Invalid import data. Expected an array of contacts." });
      }
      
      // Validate each contact and preserve original row numbers
      const validatedContacts: Array<{ row: number, data: InsertContact }> = [];
      const validationErrors = [];
      
      for (let i = 0; i < contactsData.length; i++) {
        try {
          const validated = insertContactSchema.parse(contactsData[i]);
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
        errors: [...validationErrors, ...result.failed]
      });
    } catch (error) {
      console.error("Error importing contacts:", error);
      res.status(500).json({ message: "Failed to import contacts" });
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

  const httpServer = createServer(app);
  return httpServer;
}
