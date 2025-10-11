// From Replit Auth and Database blueprints
import { 
  type Contact, 
  type InsertContact, 
  type Deal, 
  type InsertDeal, 
  type Task, 
  type InsertTask, 
  type Activity, 
  type InsertActivity,
  type User,
  type UpsertUser,
  users,
  contacts,
  deals,
  tasks,
  activities
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

export interface IStorage {
  // User operations - From Replit Auth blueprint
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Contacts
  getContacts(userId: string): Promise<Contact[]>;
  getContact(id: string, userId: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact, userId: string): Promise<Contact>;
  bulkCreateContacts(contacts: Array<{ row: number, data: InsertContact }>, userId: string): Promise<{ successful: Contact[], failed: Array<{ row: number, error: string, data: any }> }>;
  updateContact(id: string, contact: Partial<InsertContact>, userId: string): Promise<Contact | undefined>;
  deleteContact(id: string, userId: string): Promise<boolean>;
  searchContacts(query: string, userId: string): Promise<Contact[]>;

  // Deals
  getDeals(userId: string): Promise<Deal[]>;
  getDeal(id: string, userId: string): Promise<Deal | undefined>;
  createDeal(deal: InsertDeal, userId: string): Promise<Deal>;
  updateDeal(id: string, deal: Partial<InsertDeal>, userId: string): Promise<Deal | undefined>;
  deleteDeal(id: string, userId: string): Promise<boolean>;
  getDealsByStage(stage: string, userId: string): Promise<Deal[]>;

  // Tasks
  getTasks(userId: string): Promise<Task[]>;
  getTask(id: string, userId: string): Promise<Task | undefined>;
  createTask(task: InsertTask, userId: string): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>, userId: string): Promise<Task | undefined>;
  deleteTask(id: string, userId: string): Promise<boolean>;
  getTasksByStatus(status: string, userId: string): Promise<Task[]>;
  getUpcomingTasks(userId: string): Promise<Task[]>;

  // Activities
  getActivities(userId: string): Promise<Activity[]>;
  createActivity(activity: InsertActivity, userId: string): Promise<Activity>;
  getRecentActivities(limit: number, userId: string): Promise<Activity[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations - From Replit Auth blueprint
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Contacts
  async getContacts(userId: string): Promise<Contact[]> {
    return await db.select().from(contacts).where(eq(contacts.userId, userId));
  }

  async getContact(id: string, userId: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
    return contact;
  }

  async createContact(insertContact: InsertContact, userId: string): Promise<Contact> {
    const [contact] = await db
      .insert(contacts)
      .values({ ...insertContact, userId, lastContactDate: new Date() })
      .returning();
    
    // Create activity
    await this.createActivity({
      type: "contact_added",
      description: `New contact ${contact.firstName} ${contact.lastName} added`,
      contactId: contact.id,
    }, userId);
    
    return contact;
  }

  async bulkCreateContacts(contactsData: Array<{ row: number, data: InsertContact }>, userId: string): Promise<{ successful: Contact[], failed: Array<{ row: number, error: string, data: any }> }> {
    const successful: Contact[] = [];
    const failed: Array<{ row: number, error: string, data: any }> = [];
    
    for (const { row, data } of contactsData) {
      try {
        const contact = await this.createContact(data, userId);
        successful.push(contact);
      } catch (error) {
        failed.push({
          row,
          error: error instanceof Error ? error.message : "Unknown error",
          data
        });
      }
    }
    
    return { successful, failed };
  }

  async updateContact(id: string, updateData: Partial<InsertContact>, userId: string): Promise<Contact | undefined> {
    const [updated] = await db
      .update(contacts)
      .set({ ...updateData, lastContactDate: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
      .returning();
    return updated;
  }

  async deleteContact(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async searchContacts(query: string, userId: string): Promise<Contact[]> {
    const lowercaseQuery = `%${query.toLowerCase()}%`;
    return await db.select().from(contacts)
      .where(and(
        eq(contacts.userId, userId),
        sql`(
          LOWER(${contacts.firstName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.lastName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.email}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.company}) LIKE ${lowercaseQuery}
        )`
      ));
  }

  // Deals
  async getDeals(userId: string): Promise<Deal[]> {
    return await db.select().from(deals).where(eq(deals.userId, userId));
  }

  async getDeal(id: string, userId: string): Promise<Deal | undefined> {
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.id, id), eq(deals.userId, userId)));
    return deal;
  }

  async createDeal(insertDeal: InsertDeal, userId: string): Promise<Deal> {
    const dealData = {
      ...insertDeal,
      userId,
      value: insertDeal.value && insertDeal.value.trim() ? insertDeal.value : null,
      expectedCloseDate: insertDeal.expectedCloseDate ? new Date(insertDeal.expectedCloseDate) : null,
      contactId: insertDeal.contactId && insertDeal.contactId.trim() ? insertDeal.contactId : null,
    };
    
    const [deal] = await db
      .insert(deals)
      .values(dealData)
      .returning();
    
    // Create activity
    await this.createActivity({
      type: "deal_created",
      description: `New deal "${deal.title}" created`,
      dealId: deal.id,
      contactId: deal.contactId || undefined,
    }, userId);
    
    return deal;
  }

  async updateDeal(id: string, updateData: Partial<InsertDeal>, userId: string): Promise<Deal | undefined> {
    const existing = await this.getDeal(id, userId);
    if (!existing) return undefined;

    const dealUpdateData = {
      ...updateData,
      value: updateData.value !== undefined ? (updateData.value && updateData.value.trim() ? updateData.value : null) : undefined,
      expectedCloseDate: updateData.expectedCloseDate ? new Date(updateData.expectedCloseDate) : undefined,
      contactId: updateData.contactId !== undefined ? (updateData.contactId && updateData.contactId.trim() ? updateData.contactId : null) : undefined,
    };

    const [updated] = await db
      .update(deals)
      .set(dealUpdateData)
      .where(and(eq(deals.id, id), eq(deals.userId, userId)))
      .returning();
    
    // Create activity if stage changed
    if (updateData.stage && updateData.stage !== existing.stage) {
      await this.createActivity({
        type: "deal_stage_changed",
        description: `Deal "${updated.title}" moved to ${updateData.stage}`,
        dealId: id,
        contactId: updated.contactId || undefined,
      }, userId);
    }
    
    return updated;
  }

  async deleteDeal(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(deals)
      .where(and(eq(deals.id, id), eq(deals.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getDealsByStage(stage: string, userId: string): Promise<Deal[]> {
    return await db.select().from(deals)
      .where(and(eq(deals.stage, stage), eq(deals.userId, userId)));
  }

  // Tasks
  async getTasks(userId: string): Promise<Task[]> {
    return await db.select().from(tasks).where(eq(tasks.userId, userId));
  }

  async getTask(id: string, userId: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return task;
  }

  async createTask(insertTask: InsertTask, userId: string): Promise<Task> {
    const taskData = {
      ...insertTask,
      userId,
      dueDate: insertTask.dueDate ? new Date(insertTask.dueDate) : null,
    };
    
    const [task] = await db
      .insert(tasks)
      .values(taskData)
      .returning();
    
    // Create activity
    await this.createActivity({
      type: "task_created",
      description: `Task "${task.title}" created`,
      taskId: task.id,
      contactId: task.contactId || undefined,
      dealId: task.dealId || undefined,
    }, userId);
    
    return task;
  }

  async updateTask(id: string, updateData: Partial<InsertTask>, userId: string): Promise<Task | undefined> {
    const existing = await this.getTask(id, userId);
    if (!existing) return undefined;

    const completedAt = updateData.status === "completed" ? new Date() : existing.completedAt;
    
    const taskUpdateData = {
      ...updateData,
      dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
      completedAt,
    };
    
    const [updated] = await db
      .update(tasks)
      .set(taskUpdateData)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .returning();
    
    // Create activity if completed
    if (updateData.status === "completed" && existing.status !== "completed") {
      await this.createActivity({
        type: "task_completed",
        description: `Task "${updated.title}" completed`,
        taskId: id,
        contactId: updated.contactId || undefined,
        dealId: updated.dealId || undefined,
      }, userId);
    }
    
    return updated;
  }

  async deleteTask(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getTasksByStatus(status: string, userId: string): Promise<Task[]> {
    return await db.select().from(tasks)
      .where(and(eq(tasks.status, status), eq(tasks.userId, userId)));
  }

  async getUpcomingTasks(userId: string): Promise<Task[]> {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return await db.select().from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.status, "pending"),
        gte(tasks.dueDate, now),
        lte(tasks.dueDate, weekFromNow)
      ))
      .orderBy(tasks.dueDate);
  }

  // Activities
  async getActivities(userId: string): Promise<Activity[]> {
    return await db.select().from(activities).where(eq(activities.userId, userId));
  }

  async createActivity(insertActivity: InsertActivity, userId: string): Promise<Activity> {
    const [activity] = await db
      .insert(activities)
      .values({ ...insertActivity, userId })
      .returning();
    return activity;
  }

  async getRecentActivities(limit: number = 10, userId: string): Promise<Activity[]> {
    return await db.select().from(activities)
      .where(eq(activities.userId, userId))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
