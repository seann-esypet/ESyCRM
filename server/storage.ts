import { 
  type Contact, 
  type InsertContact, 
  type Deal, 
  type InsertDeal, 
  type Task, 
  type InsertTask, 
  type Activity, 
  type InsertActivity 
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Contacts
  getContacts(): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<boolean>;
  searchContacts(query: string): Promise<Contact[]>;

  // Deals
  getDeals(): Promise<Deal[]>;
  getDeal(id: string): Promise<Deal | undefined>;
  createDeal(deal: InsertDeal): Promise<Deal>;
  updateDeal(id: string, deal: Partial<InsertDeal>): Promise<Deal | undefined>;
  deleteDeal(id: string): Promise<boolean>;
  getDealsByStage(stage: string): Promise<Deal[]>;

  // Tasks
  getTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;
  getTasksByStatus(status: string): Promise<Task[]>;
  getUpcomingTasks(): Promise<Task[]>;

  // Activities
  getActivities(): Promise<Activity[]>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  getRecentActivities(limit?: number): Promise<Activity[]>;
}

export class MemStorage implements IStorage {
  private contacts: Map<string, Contact>;
  private deals: Map<string, Deal>;
  private tasks: Map<string, Task>;
  private activities: Map<string, Activity>;

  constructor() {
    this.contacts = new Map();
    this.deals = new Map();
    this.tasks = new Map();
    this.activities = new Map();
  }

  // Contacts
  async getContacts(): Promise<Contact[]> {
    return Array.from(this.contacts.values());
  }

  async getContact(id: string): Promise<Contact | undefined> {
    return this.contacts.get(id);
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const id = randomUUID();
    const contact: Contact = { 
      ...insertContact, 
      id, 
      lastContactDate: new Date(),
      email: insertContact.email || null,
      phone: insertContact.phone || null,
      company: insertContact.company || null,
      jobTitle: insertContact.jobTitle || null,
      notes: insertContact.notes || null
    };
    this.contacts.set(id, contact);
    
    // Create activity
    await this.createActivity({
      type: "contact_added",
      description: `New contact ${contact.firstName} ${contact.lastName} added`,
      contactId: id,
    });
    
    return contact;
  }

  async updateContact(id: string, updateData: Partial<InsertContact>): Promise<Contact | undefined> {
    const existing = this.contacts.get(id);
    if (!existing) return undefined;
    
    const updated: Contact = { 
      ...existing, 
      ...updateData,
      lastContactDate: new Date()
    };
    this.contacts.set(id, updated);
    return updated;
  }

  async deleteContact(id: string): Promise<boolean> {
    return this.contacts.delete(id);
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.contacts.values()).filter(contact =>
      contact.firstName.toLowerCase().includes(lowercaseQuery) ||
      contact.lastName.toLowerCase().includes(lowercaseQuery) ||
      contact.email?.toLowerCase().includes(lowercaseQuery) ||
      contact.company?.toLowerCase().includes(lowercaseQuery)
    );
  }

  // Deals
  async getDeals(): Promise<Deal[]> {
    return Array.from(this.deals.values());
  }

  async getDeal(id: string): Promise<Deal | undefined> {
    return this.deals.get(id);
  }

  async createDeal(insertDeal: InsertDeal): Promise<Deal> {
    const id = randomUUID();
    const deal: Deal = { 
      ...insertDeal, 
      id, 
      createdAt: new Date(),
      contactId: insertDeal.contactId || null,
      value: insertDeal.value || null,
      probability: insertDeal.probability || null,
      expectedCloseDate: insertDeal.expectedCloseDate || null,
      description: insertDeal.description || null
    };
    this.deals.set(id, deal);
    
    // Create activity
    await this.createActivity({
      type: "deal_created",
      description: `New deal "${deal.title}" created`,
      dealId: id,
      contactId: deal.contactId || undefined,
    });
    
    return deal;
  }

  async updateDeal(id: string, updateData: Partial<InsertDeal>): Promise<Deal | undefined> {
    const existing = this.deals.get(id);
    if (!existing) return undefined;
    
    const updated: Deal = { ...existing, ...updateData };
    this.deals.set(id, updated);
    
    // Create activity if stage changed
    if (updateData.stage && updateData.stage !== existing.stage) {
      await this.createActivity({
        type: "deal_stage_changed",
        description: `Deal "${updated.title}" moved to ${updateData.stage}`,
        dealId: id,
        contactId: updated.contactId || undefined,
      });
    }
    
    return updated;
  }

  async deleteDeal(id: string): Promise<boolean> {
    return this.deals.delete(id);
  }

  async getDealsByStage(stage: string): Promise<Deal[]> {
    return Array.from(this.deals.values()).filter(deal => deal.stage === stage);
  }

  // Tasks
  async getTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const id = randomUUID();
    const task: Task = { 
      ...insertTask, 
      id, 
      createdAt: new Date(),
      completedAt: null,
      contactId: insertTask.contactId || null,
      dealId: insertTask.dealId || null,
      description: insertTask.description || null,
      dueDate: insertTask.dueDate || null
    };
    this.tasks.set(id, task);
    
    // Create activity
    await this.createActivity({
      type: "task_created",
      description: `Task "${task.title}" created`,
      taskId: id,
      contactId: task.contactId || undefined,
      dealId: task.dealId || undefined,
    });
    
    return task;
  }

  async updateTask(id: string, updateData: Partial<InsertTask>): Promise<Task | undefined> {
    const existing = this.tasks.get(id);
    if (!existing) return undefined;
    
    const updated: Task = { 
      ...existing, 
      ...updateData,
      completedAt: updateData.status === "completed" ? new Date() : existing.completedAt
    };
    this.tasks.set(id, updated);
    
    // Create activity if completed
    if (updateData.status === "completed" && existing.status !== "completed") {
      await this.createActivity({
        type: "task_completed",
        description: `Task "${updated.title}" completed`,
        taskId: id,
        contactId: updated.contactId || undefined,
        dealId: updated.dealId || undefined,
      });
    }
    
    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async getTasksByStatus(status: string): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(task => task.status === status);
  }

  async getUpcomingTasks(): Promise<Task[]> {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return Array.from(this.tasks.values())
      .filter(task => 
        task.status === "pending" && 
        task.dueDate && 
        task.dueDate >= now && 
        task.dueDate <= weekFromNow
      )
      .sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return 0;
        return a.dueDate.getTime() - b.dueDate.getTime();
      });
  }

  // Activities
  async getActivities(): Promise<Activity[]> {
    return Array.from(this.activities.values());
  }

  async createActivity(insertActivity: InsertActivity): Promise<Activity> {
    const id = randomUUID();
    const activity: Activity = { 
      ...insertActivity, 
      id, 
      createdAt: new Date(),
      contactId: insertActivity.contactId || null,
      dealId: insertActivity.dealId || null,
      taskId: insertActivity.taskId || null
    };
    this.activities.set(id, activity);
    return activity;
  }

  async getRecentActivities(limit: number = 10): Promise<Activity[]> {
    return Array.from(this.activities.values())
      .sort((a, b) => {
        const aTime = a.createdAt ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, limit);
  }
}

export const storage = new MemStorage();
