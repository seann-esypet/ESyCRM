// From Replit Auth and Database blueprints
import { 
  type Contact, 
  type InsertContact,
  type ContactGroup,
  type InsertContactGroup,
  type Deal, 
  type InsertDeal, 
  type Task, 
  type InsertTask, 
  type Activity, 
  type InsertActivity,
  type User,
  type UpsertUser,
  type EmailSequence,
  type InsertEmailSequence,
  type EmailSequenceLog,
  type InsertEmailSequenceLog,
  type InboxMessage,
  type InsertInboxMessage,
  users,
  contacts,
  contactGroups,
  deals,
  tasks,
  activities,
  emailSequences,
  emailSequenceLogs,
  inboxMessages
} from "@shared/schema";
import { normalizePhoneNumber, normalizeName, normalizeEmail } from "@shared/utils";
import { db } from "./db";
import { eq, desc, and, sql, gte, lte, or, ne } from "drizzle-orm";

export interface IStorage {
  // User operations - From Replit Auth blueprint
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserProfile(id: string, profile: Partial<Pick<User, 'workEmail'>>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  
  // Contact Groups (userId can be null for admins to get all data)
  getContactGroups(userId: string | null): Promise<ContactGroup[]>;
  getContactGroup(id: string, userId: string | null): Promise<ContactGroup | undefined>;
  createContactGroup(group: InsertContactGroup, userId: string): Promise<ContactGroup>;
  updateContactGroup(id: string, group: Partial<InsertContactGroup>, userId: string | null): Promise<ContactGroup | undefined>;
  deleteContactGroup(id: string, userId: string | null): Promise<boolean>;
  
  // Contacts (userId can be null for admins to get all data)
  getContacts(userId: string | null): Promise<Contact[]>;
  getContact(id: string, userId: string | null): Promise<Contact | undefined>;
  createContact(contact: InsertContact, userId: string): Promise<Contact>;
  bulkCreateContacts(contacts: Array<{ row: number, data: InsertContact }>, userId: string): Promise<{ successful: Contact[], failed: Array<{ row: number, error: string, data: any }> }>;
  updateContact(id: string, contact: Partial<InsertContact>, userId: string | null): Promise<Contact | undefined>;
  deleteContact(id: string, userId: string | null): Promise<boolean>;
  searchContacts(query: string, userId: string | null): Promise<Contact[]>;
  findDuplicateContacts(contact: InsertContact, userId: string, excludeId?: string): Promise<Contact[]>;

  // Deals (userId can be null for admins to get all data)
  getDeals(userId: string | null): Promise<Deal[]>;
  getDeal(id: string, userId: string | null): Promise<Deal | undefined>;
  createDeal(deal: InsertDeal, userId: string): Promise<Deal>;
  updateDeal(id: string, deal: Partial<InsertDeal>, userId: string | null): Promise<Deal | undefined>;
  deleteDeal(id: string, userId: string | null): Promise<boolean>;
  getDealsByStage(stage: string, userId: string | null): Promise<Deal[]>;

  // Tasks (userId can be null for admins to get all data)
  getTasks(userId: string | null): Promise<Task[]>;
  getTask(id: string, userId: string | null): Promise<Task | undefined>;
  createTask(task: InsertTask, userId: string): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>, userId: string | null): Promise<Task | undefined>;
  deleteTask(id: string, userId: string | null): Promise<boolean>;
  getTasksByStatus(status: string, userId: string | null): Promise<Task[]>;
  getUpcomingTasks(userId: string | null): Promise<Task[]>;

  // Activities (userId can be null for admins to get all data)
  getActivities(userId: string | null): Promise<Activity[]>;
  createActivity(activity: InsertActivity, userId: string): Promise<Activity>;
  getRecentActivities(limit: number, userId: string | null): Promise<Activity[]>;

  // Email Sequences (userId can be null for admins to get all data)
  getEmailSequences(userId: string | null): Promise<EmailSequence[]>;
  getEmailSequence(id: string, userId: string | null): Promise<EmailSequence | undefined>;
  createEmailSequence(sequence: InsertEmailSequence, userId: string): Promise<EmailSequence>;
  updateEmailSequence(id: string, sequence: Partial<InsertEmailSequence>, userId: string | null): Promise<EmailSequence | undefined>;
  deleteEmailSequence(id: string, userId: string | null): Promise<boolean>;
  
  // Email Sequence Logs
  getEmailSequenceLogs(userId: string | null, contactId?: string): Promise<EmailSequenceLog[]>;
  createEmailSequenceLog(log: InsertEmailSequenceLog, userId: string): Promise<EmailSequenceLog>;
  bulkCreateEmailSequenceLogs(sequenceId: string, contactIds: string[], userId: string | null): Promise<{ successful: EmailSequenceLog[], failed: Array<{ contactId: string, error: string }> }>;
  updateEmailSequenceLog(id: string, log: Partial<InsertEmailSequenceLog>, userId: string | null): Promise<EmailSequenceLog | undefined>;
  
  // Inbox Messages (userId can be null for admins to get all data)
  getInboxMessages(userId: string | null): Promise<InboxMessage[]>;
  getInboxMessage(id: string, userId: string | null): Promise<InboxMessage | undefined>;
  createInboxMessage(message: InsertInboxMessage, userId: string): Promise<InboxMessage>;
  updateInboxMessage(id: string, message: Partial<InsertInboxMessage>, userId: string | null): Promise<InboxMessage | undefined>;
  deleteInboxMessage(id: string, userId: string | null): Promise<boolean>;
  getUnreadCount(userId: string | null): Promise<number>;
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

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserProfile(id: string, profile: Partial<Pick<User, 'workEmail'>>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        ...profile,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  // Contact Groups
  async getContactGroups(userId: string | null): Promise<ContactGroup[]> {
    if (userId === null) {
      // Admin: get all groups
      return await db.select().from(contactGroups);
    }
    return await db.select().from(contactGroups).where(eq(contactGroups.userId, userId));
  }

  async getContactGroup(id: string, userId: string | null): Promise<ContactGroup | undefined> {
    if (userId === null) {
      // Admin: get any group by ID
      const [group] = await db.select().from(contactGroups).where(eq(contactGroups.id, id));
      return group;
    }
    const [group] = await db.select().from(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)));
    return group;
  }

  async createContactGroup(insertGroup: InsertContactGroup, userId: string): Promise<ContactGroup> {
    const [group] = await db
      .insert(contactGroups)
      .values({ ...insertGroup, userId })
      .returning();
    return group;
  }

  async updateContactGroup(id: string, updateData: Partial<InsertContactGroup>, userId: string | null): Promise<ContactGroup | undefined> {
    if (userId === null) {
      // Admin: update any group
      const [updated] = await db
        .update(contactGroups)
        .set(updateData)
        .where(eq(contactGroups.id, id))
        .returning();
      return updated;
    }
    const [updated] = await db
      .update(contactGroups)
      .set(updateData)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)))
      .returning();
    return updated;
  }

  async deleteContactGroup(id: string, userId: string | null): Promise<boolean> {
    if (userId === null) {
      // Admin: clear groupId for all contacts in this group, then delete group
      await db.update(contacts)
        .set({ groupId: null })
        .where(eq(contacts.groupId, id));
      
      const result = await db.delete(contactGroups).where(eq(contactGroups.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
    
    // Salesperson: verify ownership first, then clear groupId only for user's contacts, then delete
    const [group] = await db.select().from(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)));
    
    if (!group) {
      return false; // Group not found or user doesn't own it
    }
    
    // Only clear groupId for contacts owned by this user
    await db.update(contacts)
      .set({ groupId: null })
      .where(and(eq(contacts.groupId, id), eq(contacts.userId, userId)));
    
    const result = await db.delete(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Contacts
  async getContacts(userId: string | null): Promise<Contact[]> {
    if (userId === null) {
      // Admin: get all contacts
      return await db.select().from(contacts);
    }
    return await db.select().from(contacts).where(eq(contacts.userId, userId));
  }

  async getContact(id: string, userId: string | null): Promise<Contact | undefined> {
    if (userId === null) {
      // Admin: get any contact by ID
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
      return contact;
    }
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

  async updateContact(id: string, updateData: Partial<InsertContact>, userId: string | null): Promise<Contact | undefined> {
    if (userId === null) {
      // Admin: update any contact
      const [updated] = await db
        .update(contacts)
        .set({ ...updateData, lastContactDate: new Date() })
        .where(eq(contacts.id, id))
        .returning();
      return updated;
    }
    const [updated] = await db
      .update(contacts)
      .set({ ...updateData, lastContactDate: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
      .returning();
    return updated;
  }

  async deleteContact(id: string, userId: string | null): Promise<boolean> {
    if (userId === null) {
      // Admin: delete any contact
      const result = await db.delete(contacts).where(eq(contacts.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
    const result = await db.delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async searchContacts(query: string, userId: string | null): Promise<Contact[]> {
    const lowercaseQuery = `%${query.toLowerCase()}%`;
    if (userId === null) {
      // Admin: search all contacts
      return await db.select().from(contacts)
        .where(sql`(
          LOWER(${contacts.firstName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.lastName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.email}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.company}) LIKE ${lowercaseQuery}
        )`);
    }
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

  async findDuplicateContacts(contact: InsertContact, userId: string, excludeId?: string): Promise<Contact[]> {
    const normalizedPhone = normalizePhoneNumber(contact.phone);
    const normalizedEmail = normalizeEmail(contact.email);
    const normalizedFirstName = normalizeName(contact.firstName);
    const normalizedLastName = normalizeName(contact.lastName);
    
    // Get all contacts for the user
    const userContacts = await db.select().from(contacts).where(eq(contacts.userId, userId));
    
    // Filter for potential duplicates
    const duplicates = userContacts.filter(existing => {
      // Exclude the contact being updated (if applicable)
      if (excludeId && existing.id === excludeId) {
        return false;
      }
      
      // Check phone number match (normalized)
      if (normalizedPhone && existing.phone) {
        const existingNormalizedPhone = normalizePhoneNumber(existing.phone);
        if (existingNormalizedPhone === normalizedPhone) {
          return true;
        }
      }
      
      // Check email match (case-insensitive)
      if (normalizedEmail && existing.email) {
        const existingNormalizedEmail = normalizeEmail(existing.email);
        if (existingNormalizedEmail === normalizedEmail) {
          return true;
        }
      }
      
      // Check first and last name match (case-insensitive)
      if (normalizedFirstName && normalizedLastName) {
        const existingNormalizedFirstName = normalizeName(existing.firstName);
        const existingNormalizedLastName = normalizeName(existing.lastName);
        if (existingNormalizedFirstName === normalizedFirstName && 
            existingNormalizedLastName === normalizedLastName) {
          return true;
        }
      }
      
      return false;
    });
    
    return duplicates;
  }

  // Deals
  async getDeals(userId: string | null): Promise<Deal[]> {
    if (userId === null) {
      // Admin: get all deals
      return await db.select().from(deals);
    }
    return await db.select().from(deals).where(eq(deals.userId, userId));
  }

  async getDeal(id: string, userId: string | null): Promise<Deal | undefined> {
    if (userId === null) {
      // Admin: get any deal by ID
      const [deal] = await db.select().from(deals).where(eq(deals.id, id));
      return deal;
    }
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.id, id), eq(deals.userId, userId)));
    return deal;
  }

  async createDeal(insertDeal: InsertDeal, userId: string): Promise<Deal> {
    const dealData: any = {
      ...insertDeal,
      userId,
      value: insertDeal.value && insertDeal.value.trim() ? insertDeal.value : null,
      expectedCloseDate: insertDeal.expectedCloseDate ? new Date(insertDeal.expectedCloseDate) : null,
      demoScheduledDate: insertDeal.demoScheduledDate ? new Date(insertDeal.demoScheduledDate) : null,
      demoCompletedDate: insertDeal.demoCompletedDate ? new Date(insertDeal.demoCompletedDate) : null,
      wonDate: insertDeal.wonDate ? new Date(insertDeal.wonDate) : null,
      contactId: insertDeal.contactId && insertDeal.contactId.trim() ? insertDeal.contactId : null,
      stageChangedAt: new Date(), // Set initial timestamp when deal is created
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

  async updateDeal(id: string, updateData: Partial<InsertDeal>, userId: string | null): Promise<Deal | undefined> {
    const existing = await this.getDeal(id, userId);
    if (!existing) return undefined;

    const dealUpdateData: any = {
      ...updateData,
      value: updateData.value !== undefined ? (updateData.value && updateData.value.trim() ? updateData.value : null) : undefined,
      expectedCloseDate: updateData.expectedCloseDate ? new Date(updateData.expectedCloseDate) : undefined,
      demoScheduledDate: updateData.demoScheduledDate ? new Date(updateData.demoScheduledDate) : undefined,
      demoCompletedDate: updateData.demoCompletedDate ? new Date(updateData.demoCompletedDate) : undefined,
      wonDate: updateData.wonDate ? new Date(updateData.wonDate) : undefined,
      contactId: updateData.contactId !== undefined ? (updateData.contactId && updateData.contactId.trim() ? updateData.contactId : null) : undefined,
    };

    // Set stageChangedAt timestamp if stage is being changed
    if (updateData.stage && updateData.stage !== existing.stage) {
      dealUpdateData.stageChangedAt = new Date();
    }

    const whereClause = userId === null 
      ? eq(deals.id, id)
      : and(eq(deals.id, id), eq(deals.userId, userId));

    const [updated] = await db
      .update(deals)
      .set(dealUpdateData)
      .where(whereClause)
      .returning();
    
    // Create activity if stage changed (use the deal's actual userId for activity)
    if (updateData.stage && updateData.stage !== existing.stage) {
      await this.createActivity({
        type: "deal_stage_changed",
        description: `Deal "${updated.title}" moved to ${updateData.stage}`,
        dealId: id,
        contactId: updated.contactId || undefined,
      }, updated.userId);
    }
    
    return updated;
  }

  async deleteDeal(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null 
      ? eq(deals.id, id)
      : and(eq(deals.id, id), eq(deals.userId, userId));
    
    const result = await db.delete(deals).where(whereClause);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getDealsByStage(stage: string, userId: string | null): Promise<Deal[]> {
    if (userId === null) {
      // Admin: get all deals in this stage
      return await db.select().from(deals).where(eq(deals.stage, stage));
    }
    return await db.select().from(deals)
      .where(and(eq(deals.stage, stage), eq(deals.userId, userId)));
  }

  // Tasks
  async getTasks(userId: string | null): Promise<Task[]> {
    if (userId === null) {
      // Admin: get all tasks
      return await db.select().from(tasks);
    }
    return await db.select().from(tasks).where(eq(tasks.userId, userId));
  }

  async getTask(id: string, userId: string | null): Promise<Task | undefined> {
    if (userId === null) {
      // Admin: get any task by ID
      const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
      return task;
    }
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

  async updateTask(id: string, updateData: Partial<InsertTask>, userId: string | null): Promise<Task | undefined> {
    const existing = await this.getTask(id, userId);
    if (!existing) return undefined;

    const completedAt = updateData.status === "completed" ? new Date() : existing.completedAt;
    
    const taskUpdateData = {
      ...updateData,
      dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
      completedAt,
    };
    
    const whereClause = userId === null 
      ? eq(tasks.id, id)
      : and(eq(tasks.id, id), eq(tasks.userId, userId));

    const [updated] = await db
      .update(tasks)
      .set(taskUpdateData)
      .where(whereClause)
      .returning();
    
    // Create activity if completed (use the task's actual userId for activity)
    if (updateData.status === "completed" && existing.status !== "completed") {
      await this.createActivity({
        type: "task_completed",
        description: `Task "${updated.title}" completed`,
        taskId: id,
        contactId: updated.contactId || undefined,
        dealId: updated.dealId || undefined,
      }, updated.userId);
    }
    
    return updated;
  }

  async deleteTask(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null 
      ? eq(tasks.id, id)
      : and(eq(tasks.id, id), eq(tasks.userId, userId));
    
    const result = await db.delete(tasks).where(whereClause);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getTasksByStatus(status: string, userId: string | null): Promise<Task[]> {
    if (userId === null) {
      // Admin: get all tasks with this status
      return await db.select().from(tasks).where(eq(tasks.status, status));
    }
    return await db.select().from(tasks)
      .where(and(eq(tasks.status, status), eq(tasks.userId, userId)));
  }

  async getUpcomingTasks(userId: string | null): Promise<Task[]> {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    if (userId === null) {
      // Admin: get all upcoming tasks
      return await db.select().from(tasks)
        .where(and(
          eq(tasks.status, "pending"),
          gte(tasks.dueDate, now),
          lte(tasks.dueDate, weekFromNow)
        ))
        .orderBy(tasks.dueDate);
    }
    
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
  async getActivities(userId: string | null): Promise<Activity[]> {
    if (userId === null) {
      // Admin: get all activities
      return await db.select().from(activities);
    }
    return await db.select().from(activities).where(eq(activities.userId, userId));
  }

  async createActivity(insertActivity: InsertActivity, userId: string): Promise<Activity> {
    const [activity] = await db
      .insert(activities)
      .values({ ...insertActivity, userId })
      .returning();
    return activity;
  }

  async getRecentActivities(limit: number = 10, userId: string | null): Promise<Activity[]> {
    if (userId === null) {
      // Admin: get all recent activities
      return await db.select().from(activities)
        .orderBy(desc(activities.createdAt))
        .limit(limit);
    }
    return await db.select().from(activities)
      .where(eq(activities.userId, userId))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }

  // Email Sequences
  async getEmailSequences(userId: string | null): Promise<EmailSequence[]> {
    if (userId === null) {
      // Admin: get all sequences
      return await db.select().from(emailSequences);
    }
    return await db.select().from(emailSequences)
      .where(eq(emailSequences.userId, userId))
      .orderBy(emailSequences.sequenceNumber);
  }

  async getEmailSequence(id: string, userId: string | null): Promise<EmailSequence | undefined> {
    if (userId === null) {
      // Admin: get any sequence by ID
      const [sequence] = await db.select().from(emailSequences).where(eq(emailSequences.id, id));
      return sequence;
    }
    const [sequence] = await db.select().from(emailSequences)
      .where(and(eq(emailSequences.id, id), eq(emailSequences.userId, userId)));
    return sequence;
  }

  async createEmailSequence(insertSequence: InsertEmailSequence, userId: string): Promise<EmailSequence> {
    const sequenceData: any = {
      ...insertSequence,
      userId,
      scheduledDate: insertSequence.scheduledDate && insertSequence.scheduledDate.trim() 
        ? new Date(insertSequence.scheduledDate) 
        : null,
    };

    const [sequence] = await db
      .insert(emailSequences)
      .values(sequenceData)
      .returning();
    
    return sequence;
  }

  async updateEmailSequence(id: string, updateData: Partial<InsertEmailSequence>, userId: string | null): Promise<EmailSequence | undefined> {
    const sequenceUpdateData: any = {
      ...updateData,
      scheduledDate: updateData.scheduledDate !== undefined 
        ? (updateData.scheduledDate && updateData.scheduledDate.trim() ? new Date(updateData.scheduledDate) : null)
        : undefined,
      updatedAt: new Date(),
    };

    const whereClause = userId === null 
      ? eq(emailSequences.id, id)
      : and(eq(emailSequences.id, id), eq(emailSequences.userId, userId));

    const [updated] = await db
      .update(emailSequences)
      .set(sequenceUpdateData)
      .where(whereClause)
      .returning();
    
    return updated;
  }

  async deleteEmailSequence(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null 
      ? eq(emailSequences.id, id)
      : and(eq(emailSequences.id, id), eq(emailSequences.userId, userId));
    
    const result = await db.delete(emailSequences).where(whereClause);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Email Sequence Logs
  async getEmailSequenceLogs(userId: string | null, contactId?: string): Promise<EmailSequenceLog[]> {
    if (userId === null) {
      // Admin: get all logs or filtered by contact
      if (contactId) {
        return await db.select().from(emailSequenceLogs)
          .where(eq(emailSequenceLogs.contactId, contactId))
          .orderBy(desc(emailSequenceLogs.createdAt));
      }
      return await db.select().from(emailSequenceLogs)
        .orderBy(desc(emailSequenceLogs.createdAt));
    }
    
    // Salesperson: get their logs or filtered by contact
    if (contactId) {
      return await db.select().from(emailSequenceLogs)
        .where(and(
          eq(emailSequenceLogs.userId, userId),
          eq(emailSequenceLogs.contactId, contactId)
        ))
        .orderBy(desc(emailSequenceLogs.createdAt));
    }
    return await db.select().from(emailSequenceLogs)
      .where(eq(emailSequenceLogs.userId, userId))
      .orderBy(desc(emailSequenceLogs.createdAt));
  }

  async createEmailSequenceLog(insertLog: InsertEmailSequenceLog, userId: string): Promise<EmailSequenceLog> {
    const [log] = await db
      .insert(emailSequenceLogs)
      .values({ ...insertLog, userId })
      .returning();
    return log;
  }

  async bulkCreateEmailSequenceLogs(sequenceId: string, contactIds: string[], userId: string | null): Promise<{ successful: EmailSequenceLog[], failed: Array<{ contactId: string, error: string }> }> {
    const successful: EmailSequenceLog[] = [];
    const failed: Array<{ contactId: string, error: string }> = [];
    
    // First verify the sequence exists (and belongs to the user if not admin)
    const sequence = await this.getEmailSequence(sequenceId, userId);
    if (!sequence) {
      // If sequence doesn't exist or doesn't belong to user, fail all
      return {
        successful: [],
        failed: contactIds.map(contactId => ({
          contactId,
          error: "Email sequence not found or you don't have access to it"
        }))
      };
    }
    
    // Use the sequence's userId for creating logs (the owner of the sequence)
    const sequenceOwnerId = sequence.userId;
    
    for (const contactId of contactIds) {
      try {
        // Verify contact exists (and belongs to the user if not admin)
        const contact = await this.getContact(contactId, userId);
        if (!contact) {
          failed.push({
            contactId,
            error: "Contact not found or you don't have access to it"
          });
          continue;
        }
        
        // Check if this contact is already in the queue for this sequence
        const existingLogs = await db.select().from(emailSequenceLogs)
          .where(and(
            eq(emailSequenceLogs.contactId, contactId),
            eq(emailSequenceLogs.sequenceId, sequenceId)
          ));
        
        if (existingLogs.length > 0) {
          failed.push({
            contactId,
            error: "Contact is already in this email sequence"
          });
          continue;
        }
        
        // Create log entry with status "pending"
        // Use the sequence owner's ID for the log
        const [log] = await db
          .insert(emailSequenceLogs)
          .values({
            contactId,
            sequenceId,
            sequenceNumber: sequence.sequenceNumber,
            status: "pending",
            emailResponseReceived: "false",
            userId: sequenceOwnerId
          })
          .returning();
        
        successful.push(log);
      } catch (error) {
        failed.push({
          contactId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
    
    return { successful, failed };
  }

  async updateEmailSequenceLog(id: string, updateData: Partial<InsertEmailSequenceLog>, userId: string | null): Promise<EmailSequenceLog | undefined> {
    const whereClause = userId === null 
      ? eq(emailSequenceLogs.id, id)
      : and(eq(emailSequenceLogs.id, id), eq(emailSequenceLogs.userId, userId));

    const [updated] = await db
      .update(emailSequenceLogs)
      .set(updateData)
      .where(whereClause)
      .returning();
    
    return updated;
  }

  // Inbox Messages
  async getInboxMessages(userId: string | null): Promise<InboxMessage[]> {
    if (userId === null) {
      // Admin: get all inbox messages
      return await db.select().from(inboxMessages).orderBy(desc(inboxMessages.receivedAt));
    }
    return await db.select().from(inboxMessages)
      .where(eq(inboxMessages.userId, userId))
      .orderBy(desc(inboxMessages.receivedAt));
  }

  async getInboxMessage(id: string, userId: string | null): Promise<InboxMessage | undefined> {
    if (userId === null) {
      // Admin: get any message by ID
      const [message] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, id));
      return message;
    }
    const [message] = await db.select().from(inboxMessages)
      .where(and(eq(inboxMessages.id, id), eq(inboxMessages.userId, userId)));
    return message;
  }

  async createInboxMessage(insertMessage: InsertInboxMessage, userId: string): Promise<InboxMessage> {
    const [message] = await db
      .insert(inboxMessages)
      .values({ ...insertMessage, userId })
      .returning();
    return message;
  }

  async updateInboxMessage(id: string, updateData: Partial<InsertInboxMessage>, userId: string | null): Promise<InboxMessage | undefined> {
    const whereClause = userId === null
      ? eq(inboxMessages.id, id)
      : and(eq(inboxMessages.id, id), eq(inboxMessages.userId, userId));

    const [updated] = await db
      .update(inboxMessages)
      .set(updateData)
      .where(whereClause)
      .returning();
    
    return updated;
  }

  async deleteInboxMessage(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(inboxMessages.id, id)
      : and(eq(inboxMessages.id, id), eq(inboxMessages.userId, userId));

    const result = await db
      .delete(inboxMessages)
      .where(whereClause)
      .returning();
    
    return result.length > 0;
  }

  async getUnreadCount(userId: string | null): Promise<number> {
    const whereClause = userId === null
      ? eq(inboxMessages.isRead, "false")
      : and(eq(inboxMessages.userId, userId), eq(inboxMessages.isRead, "false"));

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxMessages)
      .where(whereClause);
    
    return result?.count || 0;
  }
}

export const storage = new DatabaseStorage();
