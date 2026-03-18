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
  type DealActivity,
  type InsertDealActivity,
  type User,
  type UpsertUser,
  type EmailSequence,
  type InsertEmailSequence,
  type EmailSequenceLog,
  type InsertEmailSequenceLog,
  type DealTask,
  type InsertDealTask,
  type InboxMessage,
  type InsertInboxMessage,
  type LeadDiscoveryJob,
  type InsertLeadDiscoveryJob,
  type LeadDiscoveryResult,
  type InsertLeadDiscoveryResult,
  type SerpUsage,
  type SerpCache,
  type LeadDiscoveryConfig,
  type Commission,
  type InsertCommission,
  type CommissionMonthlyPayment,
  type InsertCommissionMonthlyPayment,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type PayrollLineItem,
  type InsertPayrollLineItem,
  users,
  contacts,
  contactGroups,
  deals,
  tasks,
  activities,
  dealActivities,
  emailSequences,
  emailSequenceLogs,
  inboxMessages,
  leadDiscoveryJobs,
  leadDiscoveryResults,
  serpUsage,
  serpCache,
  leadDiscoveryConfig,
  dealTasks,
  commissions,
  commissionMonthlyPayments,
  payrollPeriods,
  payrollLineItems,
} from "@shared/schema";
import { normalizePhoneNumber, normalizeName, normalizeEmail } from "@shared/utils";
import { db } from "./db";
import { eq, desc, and, sql, gte, lte, or, ne, inArray } from "drizzle-orm";

export type PayrollPreviewItem = {
  tempId: string;
  commissionId: string | null;
  monthlyPaymentId: string | null;
  type: "upfront" | "recurring";
  date: string;
  contactName: string;
  dealTitle: string;
  planName: string;
  originalAmount: string;
};

export type PayrollLineItemInput = {
  commissionId?: string | null;
  monthlyPaymentId?: string | null;
  type: string;
  contactName: string;
  dealTitle: string;
  planName: string;
  originalAmount: string;
  adjustedAmount: string;
  date: Date;
  notes?: string | null;
};

export type PayrollPeriodFull = PayrollPeriod & {
  items: PayrollLineItem[];
  salespersonName: string;
  salespersonEmail: string;
};

export interface IStorage {
  // User operations - From Replit Auth blueprint
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(userData: { email: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User>;
  updateUserProfile(id: string, profile: Partial<Pick<User, 'workEmail' | 'replyToEmail' | 'firstName' | 'lastName' | 'phone'>>): Promise<User | undefined>;
  updateUserAdmin(id: string, userData: { email?: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  forceDeleteUser(id: string): Promise<boolean>;

  // Commissions
  createCommission(data: InsertCommission): Promise<Commission>;
  getCommissions(userId: string | null): Promise<Commission[]>;
  // Payroll
  previewPayroll(userId: string, startDate: Date, endDate: Date): Promise<PayrollPreviewItem[]>;
  createPayrollPeriod(data: Omit<InsertPayrollPeriod, "totalAmount">, lineItems: PayrollLineItemInput[]): Promise<{ period: PayrollPeriod; items: PayrollLineItem[] }>;
  getPayrollPeriods(userId: string | null): Promise<PayrollPeriodFull[]>;
  getPayrollPeriod(id: string): Promise<PayrollPeriodFull | null>;
  updatePayrollLineItem(id: string, adjustedAmount: string, notes?: string): Promise<PayrollLineItem>;
  updatePayrollPeriod(id: string, data: Partial<Pick<PayrollPeriod, "status" | "notes" | "sentAt" | "sentToEmails" | "totalAmount">>): Promise<PayrollPeriod>;
  createMonthlyPayment(data: InsertCommissionMonthlyPayment): Promise<CommissionMonthlyPayment>;
  getMonthlyPaymentsForCommission(commissionId: string): Promise<CommissionMonthlyPayment[]>;
  getMonthlyPayments(userId: string | null): Promise<CommissionMonthlyPayment[]>;

  // Deal Tasks
  getDealTasks(dealId: string): Promise<DealTask[]>;
  getDealTask(id: string): Promise<DealTask | undefined>;
  createDealTask(task: Omit<InsertDealTask, 'dueDate' | 'reminderDatetime'> & { dueDate?: Date | null; reminderDatetime?: Date | null }): Promise<DealTask>;
  updateDealTask(id: string, updates: Partial<DealTask>): Promise<DealTask | undefined>;
  deleteDealTask(id: string): Promise<boolean>;
  getPendingReminderTasks(): Promise<(DealTask & { dealTitle: string; contactFirstName: string | null; contactLastName: string | null; contactPhone: string | null; assignedUserFirstName: string | null; assignedUserLastName: string | null; })[]>;

  // Contact Groups (userId can be null for admins to get all data)
  getContactGroups(userId: string | null): Promise<ContactGroup[]>;
  getContactGroup(id: string, userId: string | null): Promise<ContactGroup | undefined>;
  createContactGroup(group: InsertContactGroup, userId: string): Promise<ContactGroup>;
  updateContactGroup(id: string, group: Partial<InsertContactGroup>, userId: string | null): Promise<ContactGroup | undefined>;
  deleteContactGroup(id: string, userId: string | null): Promise<boolean>;
  
  // Contacts (userId can be null for admins to get all data)
  getContacts(userId: string | null, showArchived?: boolean): Promise<Contact[]>;
  getContact(id: string, userId: string | null): Promise<Contact | undefined>;
  createContact(contact: InsertContact, userId: string): Promise<Contact>;
  bulkCreateContacts(contacts: Array<{ row: number, data: InsertContact }>, userId: string): Promise<{ successful: Contact[], failed: Array<{ row: number, error: string, data: any }> }>;
  updateContact(id: string, contact: Partial<InsertContact>, userId: string | null): Promise<Contact | undefined>;
  assignContact(id: string, newUserId: string): Promise<Contact | undefined>;
  archiveContact(id: string, userId: string | null): Promise<Contact | undefined>;
  unarchiveContact(id: string, userId: string | null): Promise<Contact | undefined>;
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
  getTasksByDealId(dealId: string, userId: string | null): Promise<Task[]>;
  getUpcomingTasks(userId: string | null): Promise<Task[]>;
  getDealActivities(dealId: string, userId: string | null): Promise<DealActivity[]>;
  createDealActivity(activity: InsertDealActivity, createdBy: string): Promise<DealActivity>;

  // Activities (userId can be null for admins to get all data)
  getActivities(userId: string | null): Promise<Activity[]>;
  createActivity(activity: InsertActivity, userId: string): Promise<Activity>;
  getRecentActivities(limit: number, userId: string | null): Promise<Activity[]>;

  // Email Sequences (userId can be null for admins to get all data)
  getEmailSequences(userId: string | null): Promise<EmailSequence[]>;
  getEmailSequencesByTrack(userId: string | null, track: string): Promise<EmailSequence[]>;
  getEmailSequence(id: string, userId: string | null): Promise<EmailSequence | undefined>;
  createEmailSequence(sequence: InsertEmailSequence, userId: string): Promise<EmailSequence>;
  updateEmailSequence(id: string, sequence: Partial<InsertEmailSequence>, userId: string | null): Promise<EmailSequence | undefined>;
  deleteEmailSequence(id: string, userId: string | null): Promise<boolean>;
  
  // Email Sequence Logs
  getEmailSequenceLogs(userId: string | null, contactId?: string): Promise<EmailSequenceLog[]>;
  getEmailSequenceLogById(id: string, userId: string | null): Promise<EmailSequenceLog | undefined>;
  createEmailSequenceLog(log: InsertEmailSequenceLog, userId: string): Promise<EmailSequenceLog>;
  bulkCreateEmailSequenceLogs(sequenceId: string, contactIds: string[], userId: string | null, scheduledSendAt?: Date | null, customSubject?: string, customBody?: string): Promise<{ successful: EmailSequenceLog[], failed: Array<{ contactId: string, error: string }> }>;
  updateEmailSequenceLog(id: string, log: Partial<InsertEmailSequenceLog>, userId: string | null): Promise<EmailSequenceLog | undefined>;
  deleteEmailSequenceLog(id: string, userId: string | null): Promise<boolean>;
  
  // Inbox Messages (userId can be null for admins to get all data)
  getInboxMessages(userId: string | null, contactId?: string): Promise<InboxMessage[]>;
  getInboxMessage(id: string, userId: string | null): Promise<InboxMessage | undefined>;
  createInboxMessage(message: InsertInboxMessage, userId: string): Promise<InboxMessage>;
  updateInboxMessage(id: string, message: Partial<InsertInboxMessage>, userId: string | null): Promise<InboxMessage | undefined>;
  deleteInboxMessage(id: string, userId: string | null): Promise<boolean>;
  getUnreadCount(userId: string | null): Promise<number>;
  getDealsWithUnreadReplies(userId: string | null): Promise<string[]>;
  markRepliesReadForDeal(dealId: string, userId: string | null): Promise<void>;

  // Lead Discovery
  getLeadDiscoveryJobs(userId: string | null): Promise<LeadDiscoveryJob[]>;
  getLeadDiscoveryJob(id: string, userId: string | null): Promise<LeadDiscoveryJob | undefined>;
  createLeadDiscoveryJob(job: InsertLeadDiscoveryJob, userId: string): Promise<LeadDiscoveryJob>;
  updateLeadDiscoveryJob(id: string, job: Partial<LeadDiscoveryJob>, userId: string | null): Promise<LeadDiscoveryJob | undefined>;
  deleteLeadDiscoveryJob(id: string, userId: string | null): Promise<boolean>;
  getLeadDiscoveryResults(jobId: string, userId: string | null): Promise<LeadDiscoveryResult[]>;
  getAllLeadDiscoveryResults(userId: string | null): Promise<LeadDiscoveryResult[]>;
  getLeadDiscoveryResultById(id: string): Promise<LeadDiscoveryResult | undefined>;
  deleteLeadDiscoveryResult(id: string, userId: string | null): Promise<boolean>;
  createLeadDiscoveryResult(result: InsertLeadDiscoveryResult, userId: string): Promise<LeadDiscoveryResult>;
  bulkCreateLeadDiscoveryResults(results: InsertLeadDiscoveryResult[], userId: string): Promise<LeadDiscoveryResult[]>;
  updateLeadDiscoveryResult(id: string, result: Partial<LeadDiscoveryResult>, userId: string | null): Promise<LeadDiscoveryResult | undefined>;
  markResultsAsImported(resultIds: string[], contactIds: string[], userId: string | null): Promise<void>;
  
  // SERP Usage Tracking
  getSerpUsage(monthYear: string): Promise<SerpUsage | undefined>;
  getOrCreateSerpUsage(monthYear: string): Promise<SerpUsage>;
  incrementSerpUsage(monthYear: string): Promise<SerpUsage>;
  updateSerpQuota(monthYear: string, quota: number, hardStopAt: number): Promise<SerpUsage | undefined>;
  
  // SERP Cache
  getSerpCache(zipCode: string, queryTemplate: string, state: string, maxAgeDays?: number): Promise<SerpCache | undefined>;
  createSerpCache(zipCode: string, queryTemplate: string, state: string, results: any): Promise<SerpCache>;
  clearOldSerpCache(maxAgeDays: number): Promise<number>;
  
  // Lead Discovery Config
  getLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig | undefined>;
  getOrCreateLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig>;
  updateLeadDiscoveryConfig(configKey: string, updates: Partial<LeadDiscoveryConfig>): Promise<LeadDiscoveryConfig | undefined>;
  getRunsToday(userId: string): Promise<number>;
  getSerpCallsInLastHour(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // User operations - From Replit Auth blueprint
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    if (userData.email) {
      const existingByEmail = await this.getUserByEmail(userData.email);
      if (existingByEmail && existingByEmail.id !== userData.id) {
        // Manual user exists with different ID - need to migrate to auth ID
        // Use raw SQL to update PK since ON UPDATE CASCADE is in place
        const oldId = existingByEmail.id;
        const newId = userData.id!;
        
        // Update user ID - foreign keys will cascade automatically due to ON UPDATE CASCADE
        await db.execute(sql`
          UPDATE users 
          SET id = ${newId},
              first_name = COALESCE(${userData.firstName ?? null}, first_name),
              last_name = COALESCE(${userData.lastName ?? null}, last_name),
              profile_image_url = COALESCE(${userData.profileImageUrl ?? null}, profile_image_url),
              updated_at = NOW()
          WHERE id = ${oldId}
        `);
        
        // Fetch and return the updated user
        const [updatedUser] = await db.select().from(users).where(eq(users.id, newId));
        return updatedUser;
      }
    }
    
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

  async createUser(userData: { email: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User> {
    const id = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [user] = await db
      .insert(users)
      .values({
        id,
        email: userData.email,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        phone: userData.phone || null,
        workEmail: userData.workEmail || null,
        replyToEmail: userData.replyToEmail || null,
        role: userData.role || "salesperson",
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserProfile(id: string, profile: Partial<Pick<User, 'workEmail' | 'replyToEmail' | 'firstName' | 'lastName' | 'phone'>>): Promise<User | undefined> {
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

  async updateUserAdmin(id: string, userData: { email?: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        ...userData,
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

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async forceDeleteUser(id: string): Promise<boolean> {
    // Step 1: Collect all IDs owned by this user so we can clean up cross-user FK references
    const ownedContacts = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, id));
    const contactIds = ownedContacts.map((c) => c.id);

    const ownedDeals = await db.select({ id: deals.id }).from(deals).where(eq(deals.userId, id));
    const dealIds = ownedDeals.map((d) => d.id);

    const ownedTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, id));
    const taskIds = ownedTasks.map((t) => t.id);

    const ownedSequences = await db.select({ id: emailSequences.id }).from(emailSequences).where(eq(emailSequences.userId, id));
    const sequenceIds = ownedSequences.map((s) => s.id);

    // Step 2: deal_activities — references deals, contacts, createdBy (users)
    if (dealIds.length > 0) await db.delete(dealActivities).where(inArray(dealActivities.dealId, dealIds));
    if (contactIds.length > 0) await db.delete(dealActivities).where(inArray(dealActivities.contactId, contactIds));
    await db.delete(dealActivities).where(eq(dealActivities.createdBy, id));

    // Step 3: inbox_messages — references users and contacts
    //         Must come before email_sequence_logs (inboxMessages.emailSequenceLogId → emailSequenceLogs.id)
    await db.delete(inboxMessages).where(eq(inboxMessages.userId, id));
    if (contactIds.length > 0) await db.delete(inboxMessages).where(inArray(inboxMessages.contactId, contactIds));

    // Step 4: email_sequence_logs — references users, contacts, emailSequences
    await db.delete(emailSequenceLogs).where(eq(emailSequenceLogs.userId, id));
    if (contactIds.length > 0) await db.delete(emailSequenceLogs).where(inArray(emailSequenceLogs.contactId, contactIds));
    if (sequenceIds.length > 0) await db.delete(emailSequenceLogs).where(inArray(emailSequenceLogs.sequenceId, sequenceIds));

    // Step 5: email_sequences — references users
    await db.delete(emailSequences).where(eq(emailSequences.userId, id));

    // Step 6: lead discovery — references users (results cascade from jobs)
    await db.delete(leadDiscoveryResults).where(eq(leadDiscoveryResults.userId, id));
    await db.delete(leadDiscoveryJobs).where(eq(leadDiscoveryJobs.userId, id));

    // Step 7: activities — references users, contacts, deals, AND tasks
    //         Must be deleted BEFORE tasks (activities.taskId → tasks.id)
    await db.delete(activities).where(eq(activities.userId, id));
    if (contactIds.length > 0) await db.delete(activities).where(inArray(activities.contactId, contactIds));
    if (dealIds.length > 0) await db.delete(activities).where(inArray(activities.dealId, dealIds));
    if (taskIds.length > 0) await db.delete(activities).where(inArray(activities.taskId, taskIds));

    // Step 8: tasks — references users, contacts, deals
    await db.delete(tasks).where(eq(tasks.userId, id));
    if (contactIds.length > 0) await db.delete(tasks).where(inArray(tasks.contactId, contactIds));
    if (dealIds.length > 0) await db.delete(tasks).where(inArray(tasks.dealId, dealIds));

    // Step 9: deals — references users and contacts (other users' deals may reference this user's contacts)
    if (contactIds.length > 0) await db.delete(deals).where(inArray(deals.contactId, contactIds));
    await db.delete(deals).where(eq(deals.userId, id));

    // Step 10: contacts — references users and contactGroups
    await db.delete(contacts).where(eq(contacts.userId, id));

    // Step 11: contactGroups — references users
    await db.delete(contactGroups).where(eq(contactGroups.userId, id));

    // Step 12: delete the user
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount ?? 0) > 0;
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
  async getContacts(userId: string | null, showArchived = false): Promise<Contact[]> {
    const archivedFilter = showArchived
      ? sql`${contacts.archivedAt} IS NOT NULL`
      : sql`${contacts.archivedAt} IS NULL`;
    if (userId === null) {
      return await db.select().from(contacts).where(archivedFilter);
    }
    return await db.select().from(contacts)
      .where(and(eq(contacts.userId, userId), archivedFilter));
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

  async assignContact(id: string, newUserId: string): Promise<Contact | undefined> {
    const [updated] = await db
      .update(contacts)
      .set({ userId: newUserId })
      .where(eq(contacts.id, id))
      .returning();
    return updated;
  }

  async archiveContact(id: string, userId: string | null): Promise<Contact | undefined> {
    const where = userId === null
      ? eq(contacts.id, id)
      : and(eq(contacts.id, id), eq(contacts.userId, userId));
    const [updated] = await db
      .update(contacts)
      .set({ archivedAt: new Date() })
      .where(where)
      .returning();
    return updated;
  }

  async unarchiveContact(id: string, userId: string | null): Promise<Contact | undefined> {
    const where = userId === null
      ? eq(contacts.id, id)
      : and(eq(contacts.id, id), eq(contacts.userId, userId));
    const [updated] = await db
      .update(contacts)
      .set({ archivedAt: null })
      .where(where)
      .returning();
    return updated;
  }

  async deleteContact(id: string, userId: string | null): Promise<boolean> {
    // Verify ownership before deleting
    let contact;
    if (userId === null) {
      [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    } else {
      [contact] = await db.select().from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
    }
    if (!contact) return false;

    // Delete all related records first (cascade in code to avoid FK violations)
    await db.delete(emailSequenceLogs).where(eq(emailSequenceLogs.contactId, id));
    await db.delete(inboxMessages).where(eq(inboxMessages.contactId, id));
    await db.delete(activities).where(eq(activities.contactId, id));
    await db.delete(tasks).where(eq(tasks.contactId, id));
    await db.delete(deals).where(eq(deals.contactId, id));

    const result = await db.delete(contacts).where(eq(contacts.id, id));
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

    // Verify the deal exists (and belongs to user if not admin)
    const [deal] = await db.select({ id: deals.id }).from(deals).where(whereClause);
    if (!deal) return false;

    // 1. Get commission IDs for this deal (needed to clean payroll line items)
    const dealCommissions = await db.select({ id: commissions.id })
      .from(commissions).where(eq(commissions.dealId, id));
    const commissionIds = dealCommissions.map(c => c.id);

    // 2. Get monthly payment IDs for this deal
    const monthlyPayments = await db.select({ id: commissionMonthlyPayments.id })
      .from(commissionMonthlyPayments).where(eq(commissionMonthlyPayments.dealId, id));
    const monthlyPaymentIds = monthlyPayments.map(p => p.id);

    // 3. Nullify FK references in payroll_line_items (preserve payroll history, just unlink)
    if (commissionIds.length > 0) {
      await db.update(payrollLineItems)
        .set({ commissionId: null })
        .where(inArray(payrollLineItems.commissionId, commissionIds));
    }
    if (monthlyPaymentIds.length > 0) {
      await db.update(payrollLineItems)
        .set({ monthlyPaymentId: null })
        .where(inArray(payrollLineItems.monthlyPaymentId, monthlyPaymentIds));
    }

    // 4. Delete commission monthly payments for this deal
    await db.delete(commissionMonthlyPayments).where(eq(commissionMonthlyPayments.dealId, id));

    // 5. Delete commissions for this deal
    await db.delete(commissions).where(eq(commissions.dealId, id));

    // 6. Delete deal activities
    await db.delete(dealActivities).where(eq(dealActivities.dealId, id));

    // 7. Nullify dealId on tasks (keep tasks but unlink from deal)
    await db.update(tasks).set({ dealId: null }).where(eq(tasks.dealId, id));

    // 8. Nullify dealId on activities (keep audit trail but unlink)
    await db.update(activities).set({ dealId: null }).where(eq(activities.dealId, id));

    // 9. Delete the deal
    const result = await db.delete(deals).where(eq(deals.id, id));
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

  async getTasksByDealId(dealId: string, userId: string | null): Promise<Task[]> {
    if (userId === null) {
      return await db.select().from(tasks)
        .where(eq(tasks.dealId, dealId))
        .orderBy(desc(tasks.createdAt));
    }
    return await db.select().from(tasks)
      .where(and(eq(tasks.dealId, dealId), eq(tasks.userId, userId)))
      .orderBy(desc(tasks.createdAt));
  }

  async getDealActivities(dealId: string, userId: string | null): Promise<DealActivity[]> {
    return await db.select().from(dealActivities)
      .where(eq(dealActivities.dealId, dealId))
      .orderBy(desc(dealActivities.createdAt));
  }

  async createDealActivity(activity: InsertDealActivity, createdBy: string): Promise<DealActivity> {
    const [result] = await db.insert(dealActivities)
      .values({ ...activity, createdBy })
      .returning();
    return result;
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

  async getEmailSequencesByTrack(userId: string | null, track: string): Promise<EmailSequence[]> {
    if (userId === null) {
      // Admin: get all sequences for track
      return await db.select().from(emailSequences)
        .where(eq(emailSequences.sequenceTrack, track))
        .orderBy(emailSequences.sequenceNumber);
    }
    return await db.select().from(emailSequences)
      .where(and(eq(emailSequences.userId, userId), eq(emailSequences.sequenceTrack, track)))
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

  async getEmailSequenceLogById(id: string, userId: string | null): Promise<EmailSequenceLog | undefined> {
    if (userId === null) {
      const [log] = await db.select().from(emailSequenceLogs).where(eq(emailSequenceLogs.id, id));
      return log;
    }
    const [log] = await db.select().from(emailSequenceLogs)
      .where(and(eq(emailSequenceLogs.id, id), eq(emailSequenceLogs.userId, userId)));
    return log;
  }

  async createEmailSequenceLog(insertLog: InsertEmailSequenceLog, userId: string): Promise<EmailSequenceLog> {
    const [log] = await db
      .insert(emailSequenceLogs)
      .values({ ...insertLog, userId })
      .returning();
    return log;
  }

  async bulkCreateEmailSequenceLogs(sequenceId: string, contactIds: string[], userId: string | null, scheduledSendAt?: Date | null, customSubject?: string, customBody?: string): Promise<{ successful: EmailSequenceLog[], failed: Array<{ contactId: string, error: string }> }> {
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
        
        // Enforce track matching rules:
        // - bare "custom" track → accepts any contact (full bypass)
        // - "salon_custom" / "mobile_custom" → accepts any salon/mobile contact
        //   regardless of whether they use software (these are the "General" tracks)
        // - all other tracks → contact track must match exactly
        const seqTrack = sequence.sequenceTrack;
        const bType = contact.businessType === "mobile" ? "mobile" : "salon";
        const contactTrack = contact.sequenceTrack ||
          `${bType}_${contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software"}`;

        if (seqTrack === "custom") {
          // bare custom — no restriction
        } else if (seqTrack === "salon_custom" || seqTrack === "mobile_custom") {
          // Prefixed general track — only check business type prefix
          const seqBizType = seqTrack.replace("_custom", ""); // "salon" or "mobile"
          if (seqBizType !== bType) {
            failed.push({
              contactId,
              error: `This sequence is for ${seqBizType} businesses but contact is a ${bType} business`
            });
            continue;
          }
        } else if (contactTrack !== seqTrack) {
          failed.push({
            contactId,
            error: `Contact track (${contactTrack}) does not match sequence track (${seqTrack})`
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
            sequenceTrack: sequence.sequenceTrack,
            sequenceNumber: sequence.sequenceNumber,
            status: "pending",
            emailResponseReceived: "false",
            userId: sequenceOwnerId,
            ...(scheduledSendAt ? { scheduledSendAt } : {}),
            ...(customSubject ? { customSubject } : {}),
            ...(customBody ? { customBody } : {}),
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

  async deleteEmailSequenceLog(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(emailSequenceLogs.id, id)
      : and(eq(emailSequenceLogs.id, id), eq(emailSequenceLogs.userId, userId));

    const result = await db.delete(emailSequenceLogs).where(whereClause).returning();
    return result.length > 0;
  }

  // Inbox Messages
  async getInboxMessages(userId: string | null, contactId?: string): Promise<InboxMessage[]> {
    const conditions = [];
    if (userId !== null) {
      conditions.push(eq(inboxMessages.userId, userId));
    }
    if (contactId) {
      conditions.push(eq(inboxMessages.contactId, contactId));
    }
    if (conditions.length > 0) {
      return await db.select().from(inboxMessages)
        .where(and(...conditions))
        .orderBy(desc(inboxMessages.receivedAt));
    }
    return await db.select().from(inboxMessages).orderBy(desc(inboxMessages.receivedAt));
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

  async getDealsWithUnreadReplies(userId: string | null): Promise<string[]> {
    const userDeals = userId
      ? await db.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(eq(deals.userId, userId))
      : await db.select({ id: deals.id, contactId: deals.contactId }).from(deals);

    const contactToDeals = new Map<string, string[]>();
    for (const deal of userDeals) {
      if (!deal.contactId) continue;
      if (!contactToDeals.has(deal.contactId)) contactToDeals.set(deal.contactId, []);
      contactToDeals.get(deal.contactId)!.push(deal.id);
    }

    if (contactToDeals.size === 0) return [];

    const contactIds = Array.from(contactToDeals.keys());
    const unreadMsgs = await db
      .select({ contactId: inboxMessages.contactId })
      .from(inboxMessages)
      .where(and(inArray(inboxMessages.contactId, contactIds), eq(inboxMessages.isRead, "false")));

    const dealIds = new Set<string>();
    for (const msg of unreadMsgs) {
      if (!msg.contactId) continue;
      for (const dealId of (contactToDeals.get(msg.contactId) ?? [])) {
        dealIds.add(dealId);
      }
    }

    return Array.from(dealIds);
  }

  async markRepliesReadForDeal(dealId: string, userId: string | null): Promise<void> {
    const deal = await this.getDeal(dealId, userId);
    if (!deal?.contactId) return;
    await db
      .update(inboxMessages)
      .set({ isRead: "true" })
      .where(and(eq(inboxMessages.contactId, deal.contactId), eq(inboxMessages.isRead, "false")));
  }

  // Lead Discovery operations
  async getLeadDiscoveryJobs(userId: string | null): Promise<LeadDiscoveryJob[]> {
    const whereClause = userId === null
      ? undefined
      : eq(leadDiscoveryJobs.userId, userId);

    return await db
      .select()
      .from(leadDiscoveryJobs)
      .where(whereClause)
      .orderBy(desc(leadDiscoveryJobs.createdAt));
  }

  async getLeadDiscoveryJob(id: string, userId: string | null): Promise<LeadDiscoveryJob | undefined> {
    const whereClause = userId === null
      ? eq(leadDiscoveryJobs.id, id)
      : and(eq(leadDiscoveryJobs.id, id), eq(leadDiscoveryJobs.userId, userId));

    const [job] = await db
      .select()
      .from(leadDiscoveryJobs)
      .where(whereClause);
    return job;
  }

  async createLeadDiscoveryJob(job: InsertLeadDiscoveryJob, userId: string): Promise<LeadDiscoveryJob> {
    const zipCodeList = job.zipCodes.split(',').map(z => z.trim()).filter(z => z);
    const [newJob] = await db
      .insert(leadDiscoveryJobs)
      .values({
        ...job,
        userId,
        totalZipCodes: zipCodeList.length,
      })
      .returning();
    return newJob;
  }

  async updateLeadDiscoveryJob(id: string, job: Partial<LeadDiscoveryJob>, userId: string | null): Promise<LeadDiscoveryJob | undefined> {
    const whereClause = userId === null
      ? eq(leadDiscoveryJobs.id, id)
      : and(eq(leadDiscoveryJobs.id, id), eq(leadDiscoveryJobs.userId, userId));

    const [updated] = await db
      .update(leadDiscoveryJobs)
      .set(job)
      .where(whereClause)
      .returning();
    return updated;
  }

  async deleteLeadDiscoveryJob(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(leadDiscoveryJobs.id, id)
      : and(eq(leadDiscoveryJobs.id, id), eq(leadDiscoveryJobs.userId, userId));

    const result = await db
      .delete(leadDiscoveryJobs)
      .where(whereClause)
      .returning();
    return result.length > 0;
  }

  async getLeadDiscoveryResults(jobId: string, userId: string | null): Promise<LeadDiscoveryResult[]> {
    const whereClause = userId === null
      ? eq(leadDiscoveryResults.jobId, jobId)
      : and(eq(leadDiscoveryResults.jobId, jobId), eq(leadDiscoveryResults.userId, userId));

    return await db
      .select()
      .from(leadDiscoveryResults)
      .where(whereClause)
      .orderBy(desc(leadDiscoveryResults.createdAt));
  }

  async getAllLeadDiscoveryResults(userId: string | null): Promise<LeadDiscoveryResult[]> {
    const whereClause = userId === null
      ? undefined
      : eq(leadDiscoveryResults.userId, userId);

    const query = db.select().from(leadDiscoveryResults);
    if (whereClause) {
      return await query.where(whereClause).orderBy(desc(leadDiscoveryResults.createdAt));
    }
    return await query.orderBy(desc(leadDiscoveryResults.createdAt));
  }

  async getLeadDiscoveryResultById(id: string): Promise<LeadDiscoveryResult | undefined> {
    const [result] = await db
      .select()
      .from(leadDiscoveryResults)
      .where(eq(leadDiscoveryResults.id, id));
    return result;
  }

  async deleteLeadDiscoveryResult(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(leadDiscoveryResults.id, id)
      : and(eq(leadDiscoveryResults.id, id), eq(leadDiscoveryResults.userId, userId));
    
    const deleted = await db
      .delete(leadDiscoveryResults)
      .where(whereClause)
      .returning();
    return deleted.length > 0;
  }

  async createLeadDiscoveryResult(result: InsertLeadDiscoveryResult, userId: string): Promise<LeadDiscoveryResult> {
    const [newResult] = await db
      .insert(leadDiscoveryResults)
      .values({
        ...result,
        userId,
      })
      .returning();
    return newResult;
  }

  async bulkCreateLeadDiscoveryResults(results: InsertLeadDiscoveryResult[], userId: string): Promise<LeadDiscoveryResult[]> {
    if (results.length === 0) return [];
    
    const resultsWithUserId = results.map(r => ({ ...r, userId }));
    return await db
      .insert(leadDiscoveryResults)
      .values(resultsWithUserId)
      .returning();
  }

  async updateLeadDiscoveryResult(id: string, result: Partial<LeadDiscoveryResult>, userId: string | null): Promise<LeadDiscoveryResult | undefined> {
    const whereClause = userId === null
      ? eq(leadDiscoveryResults.id, id)
      : and(eq(leadDiscoveryResults.id, id), eq(leadDiscoveryResults.userId, userId));

    const [updated] = await db
      .update(leadDiscoveryResults)
      .set(result)
      .where(whereClause)
      .returning();
    return updated;
  }

  async markResultsAsImported(resultIds: string[], contactIds: string[], userId: string | null): Promise<void> {
    for (let i = 0; i < resultIds.length; i++) {
      const whereClause = userId === null
        ? eq(leadDiscoveryResults.id, resultIds[i])
        : and(eq(leadDiscoveryResults.id, resultIds[i]), eq(leadDiscoveryResults.userId, userId));

      await db
        .update(leadDiscoveryResults)
        .set({ 
          isImported: "true",
          importedContactId: contactIds[i]
        })
        .where(whereClause);
    }
  }

  // SERP Usage Tracking
  async getSerpUsage(monthYear: string): Promise<SerpUsage | undefined> {
    const [usage] = await db
      .select()
      .from(serpUsage)
      .where(eq(serpUsage.monthYear, monthYear));
    return usage;
  }

  async getOrCreateSerpUsage(monthYear: string): Promise<SerpUsage> {
    const existing = await this.getSerpUsage(monthYear);
    if (existing) return existing;
    
    const [created] = await db
      .insert(serpUsage)
      .values({ monthYear, usedCredits: 0, monthlyQuota: 250, hardStopAt: 200 })
      .returning();
    return created;
  }

  async incrementSerpUsage(monthYear: string): Promise<SerpUsage> {
    const usage = await this.getOrCreateSerpUsage(monthYear);
    const [updated] = await db
      .update(serpUsage)
      .set({ usedCredits: (usage.usedCredits || 0) + 1 })
      .where(eq(serpUsage.monthYear, monthYear))
      .returning();
    return updated;
  }

  async updateSerpQuota(monthYear: string, quota: number, hardStopAt: number): Promise<SerpUsage | undefined> {
    const usage = await this.getOrCreateSerpUsage(monthYear);
    const [updated] = await db
      .update(serpUsage)
      .set({ monthlyQuota: quota, hardStopAt })
      .where(eq(serpUsage.monthYear, monthYear))
      .returning();
    return updated;
  }

  // SERP Cache
  async getSerpCache(zipCode: string, queryTemplate: string, state: string, maxAgeDays: number = 30): Promise<SerpCache | undefined> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    const [cached] = await db
      .select()
      .from(serpCache)
      .where(and(
        eq(serpCache.zipCode, zipCode),
        eq(serpCache.queryTemplate, queryTemplate),
        eq(serpCache.state, state),
        gte(serpCache.createdAt, cutoffDate)
      ));
    return cached;
  }

  async createSerpCache(zipCode: string, queryTemplate: string, state: string, results: any): Promise<SerpCache> {
    const [created] = await db
      .insert(serpCache)
      .values({ zipCode, queryTemplate, state, resultsJson: results })
      .returning();
    return created;
  }

  async clearOldSerpCache(maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    const result = await db
      .delete(serpCache)
      .where(lte(serpCache.createdAt, cutoffDate));
    return 0;
  }

  // Lead Discovery Config
  async getLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig | undefined> {
    const [config] = await db
      .select()
      .from(leadDiscoveryConfig)
      .where(eq(leadDiscoveryConfig.configKey, configKey));
    return config;
  }

  async getOrCreateLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig> {
    const existing = await this.getLeadDiscoveryConfig(configKey);
    if (existing) return existing;
    
    const [created] = await db
      .insert(leadDiscoveryConfig)
      .values({
        configKey,
        queriesPerZip: 2,
        maxZipsPerRun: 3,
        maxRunsPerDay: 1,
        maxSerpCallsPerHour: 5,
        enableThirdQuery: "false",
        planType: "free"
      })
      .returning();
    return created;
  }

  async updateLeadDiscoveryConfig(configKey: string, updates: Partial<LeadDiscoveryConfig>): Promise<LeadDiscoveryConfig | undefined> {
    await this.getOrCreateLeadDiscoveryConfig(configKey);
    const [updated] = await db
      .update(leadDiscoveryConfig)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leadDiscoveryConfig.configKey, configKey))
      .returning();
    return updated;
  }

  async getRunsToday(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const jobs = await db
      .select()
      .from(leadDiscoveryJobs)
      .where(and(
        eq(leadDiscoveryJobs.userId, userId),
        gte(leadDiscoveryJobs.createdAt, today)
      ));
    return jobs.length;
  }

  // ─── Deal Tasks ───────────────────────────────────────────────────────────
  async getDealTasks(dealId: string): Promise<DealTask[]> {
    return await db.select().from(dealTasks)
      .where(eq(dealTasks.dealId, dealId))
      .orderBy(dealTasks.createdAt);
  }

  async getDealTask(id: string): Promise<DealTask | undefined> {
    const [task] = await db.select().from(dealTasks).where(eq(dealTasks.id, id));
    return task;
  }

  async createDealTask(task: Omit<InsertDealTask, 'dueDate' | 'reminderDatetime'> & { dueDate?: Date | null; reminderDatetime?: Date | null }): Promise<DealTask> {
    const [created] = await db.insert(dealTasks).values(task as any).returning();
    return created;
  }

  async updateDealTask(id: string, updates: Partial<DealTask>): Promise<DealTask | undefined> {
    const [updated] = await db.update(dealTasks).set(updates as any).where(eq(dealTasks.id, id)).returning();
    return updated;
  }

  async deleteDealTask(id: string): Promise<boolean> {
    const result = await db.delete(dealTasks).where(eq(dealTasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getPendingReminderTasks() {
    const now = new Date();
    const rows = await db
      .select({
        task: dealTasks,
        dealTitle: deals.title,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        contactPhone: contacts.phoneCell,
        assignedUserFirstName: users.firstName,
        assignedUserLastName: users.lastName,
      })
      .from(dealTasks)
      .leftJoin(deals, eq(dealTasks.dealId, deals.id))
      .leftJoin(contacts, eq(dealTasks.contactId, contacts.id))
      .leftJoin(users, eq(dealTasks.assignedTo, users.id))
      .where(
        and(
          eq(dealTasks.completed, "false"),
          eq(dealTasks.reminderSent, "false"),
          lte(dealTasks.reminderDatetime, now),
        )
      );
    return rows.map(r => ({
      ...r.task,
      dealTitle: r.dealTitle ?? "",
      contactFirstName: r.contactFirstName ?? null,
      contactLastName: r.contactLastName ?? null,
      contactPhone: r.contactPhone ?? null,
      assignedUserFirstName: r.assignedUserFirstName ?? null,
      assignedUserLastName: r.assignedUserLastName ?? null,
    }));
  }

  async createCommission(data: InsertCommission): Promise<Commission> {
    const [commission] = await db.insert(commissions).values(data).returning();
    return commission;
  }

  async getCommissions(userId: string | null): Promise<Commission[]> {
    if (userId) {
      return db.select().from(commissions).where(eq(commissions.userId, userId)).orderBy(desc(commissions.confirmedAt));
    }
    return db.select().from(commissions).orderBy(desc(commissions.confirmedAt));
  }

  async createMonthlyPayment(data: InsertCommissionMonthlyPayment): Promise<CommissionMonthlyPayment> {
    const [payment] = await db.insert(commissionMonthlyPayments).values(data).returning();
    return payment;
  }

  async getMonthlyPaymentsForCommission(commissionId: string): Promise<CommissionMonthlyPayment[]> {
    return db.select().from(commissionMonthlyPayments)
      .where(eq(commissionMonthlyPayments.commissionId, commissionId))
      .orderBy(commissionMonthlyPayments.periodNumber);
  }

  async getMonthlyPayments(userId: string | null): Promise<CommissionMonthlyPayment[]> {
    if (userId) {
      return db.select().from(commissionMonthlyPayments)
        .where(eq(commissionMonthlyPayments.userId, userId))
        .orderBy(desc(commissionMonthlyPayments.paidAt));
    }
    return db.select().from(commissionMonthlyPayments).orderBy(desc(commissionMonthlyPayments.paidAt));
  }

  async previewPayroll(userId: string, startDate: Date, endDate: Date): Promise<PayrollPreviewItem[]> {
    const comms = await db
      .select({
        id: commissions.id,
        planName: commissions.planName,
        upfrontAmount: commissions.upfrontAmount,
        confirmedAt: commissions.confirmedAt,
        dealTitle: deals.title,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(commissions)
      .innerJoin(deals, eq(commissions.dealId, deals.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .where(and(
        eq(commissions.userId, userId),
        gte(commissions.confirmedAt, startDate),
        lte(commissions.confirmedAt, endDate),
      ));

    const monthly = await db
      .select({
        id: commissionMonthlyPayments.id,
        commissionId: commissionMonthlyPayments.commissionId,
        amount: commissionMonthlyPayments.amount,
        periodNumber: commissionMonthlyPayments.periodNumber,
        paidAt: commissionMonthlyPayments.paidAt,
        dealTitle: deals.title,
        planName: commissions.planName,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(commissionMonthlyPayments)
      .innerJoin(deals, eq(commissionMonthlyPayments.dealId, deals.id))
      .innerJoin(commissions, eq(commissionMonthlyPayments.commissionId, commissions.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .where(and(
        eq(commissionMonthlyPayments.userId, userId),
        gte(commissionMonthlyPayments.paidAt, startDate),
        lte(commissionMonthlyPayments.paidAt, endDate),
      ));

    const buildContactName = (first: string | null | undefined, last: string | null | undefined) =>
      [first, last].filter(Boolean).join(" ").trim() || "Unknown Contact";

    const items: PayrollPreviewItem[] = [
      ...comms.map(c => ({
        tempId: `c_${c.id}`,
        commissionId: c.id,
        monthlyPaymentId: null,
        type: "upfront" as const,
        date: c.confirmedAt!.toISOString(),
        contactName: buildContactName(c.contactFirstName, c.contactLastName),
        dealTitle: c.dealTitle,
        planName: c.planName,
        originalAmount: c.upfrontAmount,
      })),
      ...monthly.map(m => ({
        tempId: `m_${m.id}`,
        commissionId: m.commissionId,
        monthlyPaymentId: m.id,
        type: "recurring" as const,
        date: m.paidAt.toISOString(),
        contactName: buildContactName(m.contactFirstName, m.contactLastName),
        dealTitle: m.dealTitle,
        planName: m.planName,
        originalAmount: m.amount,
      })),
    ];

    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return items;
  }

  async createPayrollPeriod(
    data: Omit<InsertPayrollPeriod, "totalAmount">,
    lineItems: PayrollLineItemInput[],
  ): Promise<{ period: PayrollPeriod; items: PayrollLineItem[] }> {
    const totalAmount = lineItems
      .reduce((sum, item) => sum + parseFloat(item.adjustedAmount || "0"), 0)
      .toFixed(2);

    const [period] = await db.insert(payrollPeriods).values({ ...data, totalAmount }).returning();

    const insertedItems: PayrollLineItem[] = [];
    for (const item of lineItems) {
      const [inserted] = await db.insert(payrollLineItems).values({
        payrollPeriodId: period.id,
        commissionId: item.commissionId ?? null,
        monthlyPaymentId: item.monthlyPaymentId ?? null,
        type: item.type,
        contactName: item.contactName,
        dealTitle: item.dealTitle,
        planName: item.planName,
        originalAmount: item.originalAmount,
        adjustedAmount: item.adjustedAmount,
        date: item.date,
        notes: item.notes ?? null,
      }).returning();
      insertedItems.push(inserted);
    }

    return { period, items: insertedItems };
  }

  async getPayrollPeriods(userId: string | null): Promise<PayrollPeriodFull[]> {
    const periods = await db
      .select()
      .from(payrollPeriods)
      .where(userId ? eq(payrollPeriods.userId, userId) : undefined)
      .orderBy(desc(payrollPeriods.createdAt));

    const enriched: PayrollPeriodFull[] = [];
    for (const period of periods) {
      const items = await db
        .select()
        .from(payrollLineItems)
        .where(eq(payrollLineItems.payrollPeriodId, period.id))
        .orderBy(payrollLineItems.date);

      const userRows = await db.select().from(users).where(eq(users.id, period.userId)).limit(1);
      const u = userRows[0];
      const salespersonName = u
        ? [`${u.firstName ?? ""}`, `${u.lastName ?? ""}`].join(" ").trim() || u.email || period.userId
        : period.userId;
      const salespersonEmail = u?.email || "";

      enriched.push({ ...period, items, salespersonName, salespersonEmail });
    }

    return enriched;
  }

  async getPayrollPeriod(id: string): Promise<PayrollPeriodFull | null> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).limit(1);
    if (!period) return null;

    const items = await db
      .select()
      .from(payrollLineItems)
      .where(eq(payrollLineItems.payrollPeriodId, period.id))
      .orderBy(payrollLineItems.date);

    const userRows = await db.select().from(users).where(eq(users.id, period.userId)).limit(1);
    const u = userRows[0];
    const salespersonName = u
      ? [`${u.firstName ?? ""}`, `${u.lastName ?? ""}`].join(" ").trim() || u.email || period.userId
      : period.userId;
    const salespersonEmail = u?.email || "";

    return { ...period, items, salespersonName, salespersonEmail };
  }

  async updatePayrollLineItem(id: string, adjustedAmount: string, notes?: string): Promise<PayrollLineItem> {
    const [updated] = await db
      .update(payrollLineItems)
      .set({ adjustedAmount, ...(notes !== undefined ? { notes } : {}) })
      .where(eq(payrollLineItems.id, id))
      .returning();
    return updated;
  }

  async updatePayrollPeriod(
    id: string,
    data: Partial<Pick<PayrollPeriod, "status" | "notes" | "sentAt" | "sentToEmails" | "totalAmount">>,
  ): Promise<PayrollPeriod> {
    const [updated] = await db.update(payrollPeriods).set(data).where(eq(payrollPeriods.id, id)).returning();
    return updated;
  }

  async getSerpCallsInLastHour(): Promise<number> {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    
    const cached = await db
      .select()
      .from(serpCache)
      .where(gte(serpCache.createdAt, oneHourAgo));
    return cached.length;
  }
}

export const storage = new DatabaseStorage();
