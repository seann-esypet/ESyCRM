import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// From Replit Auth blueprint - Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// From Replit Auth blueprint - User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  workEmail: varchar("work_email"), // Professional email for sending sequences (e.g., john@esypet.com)
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phone: varchar("phone"),
  profileImageUrl: varchar("profile_image_url"),
  role: text("role").notNull().default("salesperson"), // salesperson, admin
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const contactGroups = pgTable("contact_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  groupId: varchar("group_id").references(() => contactGroups.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  phoneCell: text("phone_cell"),
  phoneWork: text("phone_work"),
  phoneOther: text("phone_other"),
  company: text("company"),
  jobTitle: text("job_title"),
  usesSoftware: text("uses_software"), // Yes, No, Unknown
  hasWebsite: text("has_website"), // Yes, No, Unknown
  websiteUrl: text("website_url"),
  contactRequestFormUrl: text("contact_request_form_url"),
  facebookUrl: text("facebook_url"),
  instagramHandle: text("instagram_handle"),
  secondaryFirstName: text("secondary_first_name"),
  secondaryLastName: text("secondary_last_name"),
  leadSource: text("lead_source"), // Inbound, Outbound, Cold Call, Facebook Ad, Referral, Event, EsyPet Website Form, Google Search
  currentSoftware: text("current_software"),
  bookingSoftwareUrl: text("booking_software_url"),
  numberOfEmployees: integer("number_of_employees"),
  numberOfLocations: integer("number_of_locations"),
  painPoints: text("pain_points"),
  interestLevel: text("interest_level"), // Low, Medium, High
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active, inactive
  lastContactDate: timestamp("last_contact_date"),
});

export const deals = pgTable("deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  title: text("title").notNull(),
  contactId: varchar("contact_id").references(() => contacts.id),
  value: decimal("value", { precision: 10, scale: 2 }),
  plan: text("plan"), // Plan 1 - $2/appoint, Plan 2 - $99/mo, Plan 3 - $150/mo + credit card
  stage: text("stage").notNull().default("new_lead_unqualified"), // new_lead_unqualified, qualified_lead, contacted_left_message, contacted_spoke_to_decision_maker, onboarded_form_completed, demo_scheduled, demo_completed, decision_pending, won, lost
  stageChangedAt: timestamp("stage_changed_at"),
  probability: integer("probability").default(0), // 0-100
  expectedCloseDate: timestamp("expected_close_date"),
  demoScheduledDate: timestamp("demo_scheduled_date"),
  demoCompletedDate: timestamp("demo_completed_date"),
  wonDate: timestamp("won_date"),
  description: text("description"),
  approved: text("approved").default("pending"), // pending, approved, rejected - for commission approval by admin
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  contactId: varchar("contact_id").references(() => contacts.id),
  dealId: varchar("deal_id").references(() => deals.id),
  dueDate: timestamp("due_date"),
  priority: text("priority").notNull().default("medium"), // low, medium, high
  status: text("status").notNull().default("pending"), // pending, completed
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activities = pgTable("activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  type: text("type").notNull(), // contact_added, deal_created, task_completed, etc.
  description: text("description").notNull(),
  contactId: varchar("contact_id").references(() => contacts.id),
  dealId: varchar("deal_id").references(() => deals.id),
  taskId: varchar("task_id").references(() => tasks.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailSequences = pgTable("email_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  sequenceNumber: integer("sequence_number").notNull(), // 1-5
  subject: text("subject").notNull(),
  body: text("body").notNull(), // Email content with placeholders like [Contact_First_Name], [Sales_Person]
  scheduledDate: timestamp("scheduled_date"), // Only for sequence 1
  scheduledTime: text("scheduled_time"), // Only for sequence 1, e.g., "09:00"
  daysAfterNoReply: integer("days_after_no_reply"), // For sequences 2-5
  isActive: text("is_active").notNull().default("true"), // true, false
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const emailSequenceLogs = pgTable("email_sequence_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  sequenceId: varchar("sequence_id").notNull().references(() => emailSequences.id),
  sequenceNumber: integer("sequence_number").notNull(), // 1-5
  sentAt: timestamp("sent_at"),
  status: text("status").notNull().default("pending"), // pending, processing, sent, failed, replied
  emailResponseReceived: text("email_response_received").default("false"), // true, false
  lastCheckedAt: timestamp("last_checked_at"),
  processingStartedAt: timestamp("processing_started_at"), // Track when log transitions to "processing"
  createdAt: timestamp("created_at").defaultNow(),
});

export const inboxMessages = pgTable("inbox_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id),
  emailSequenceLogId: varchar("email_sequence_log_id").references(() => emailSequenceLogs.id),
  from: text("from").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  isRead: text("is_read").notNull().default("false"), // true, false
  receivedAt: timestamp("received_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertContactGroupSchema = createInsertSchema(contactGroups).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  name: z.string().min(1, "Group name is required"),
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  userId: true,
  lastContactDate: true,
}).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  value: z.string().optional().nullable(),
  expectedCloseDate: z.string().optional().nullable(),
  demoScheduledDate: z.string().optional().nullable(),
  demoCompletedDate: z.string().optional().nullable(),
  wonDate: z.string().optional().nullable(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  userId: true,
  completedAt: true,
  createdAt: true,
}).extend({
  dueDate: z.string().optional().nullable(),
});

export const insertActivitySchema = createInsertSchema(activities).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export const insertEmailSequenceSchema = createInsertSchema(emailSequences).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Email body is required"),
  scheduledDate: z.string().optional().nullable(),
  scheduledTime: z.string().optional().nullable(),
  daysAfterNoReply: z.number().optional().nullable(),
});

export const insertEmailSequenceLogSchema = createInsertSchema(emailSequenceLogs).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export const insertInboxMessageSchema = createInsertSchema(inboxMessages).omit({
  id: true,
  userId: true,
  createdAt: true,
  receivedAt: true,
});

// Lead Discovery Module
export const leadDiscoveryJobs = pgTable("lead_discovery_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  state: text("state").notNull(), // e.g., "NY", "CA"
  zipCodes: text("zip_codes").notNull(), // Comma-separated ZIP codes
  searchEngines: text("search_engines").notNull().default("google,bing"), // Comma-separated: google, bing, yahoo
  maxResultsPerZip: integer("max_results_per_zip").default(20),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
  totalZipCodes: integer("total_zip_codes").default(0),
  processedZipCodes: integer("processed_zip_codes").default(0),
  totalBusinessesFound: integer("total_businesses_found").default(0),
  duplicatesRemoved: integer("duplicates_removed").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leadDiscoveryResults = pgTable("lead_discovery_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => leadDiscoveryJobs.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  // Core business info
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  jobTitle: text("job_title"),
  // Software qualification
  usesSoftware: text("uses_software"), // Yes, No, Unknown
  currentSoftware: text("current_software"),
  bookingSoftwareUrl: text("booking_software_url"),
  // Website info
  hasWebsite: text("has_website"), // Yes, No, Unknown
  websiteUrl: text("website_url"),
  contactRequestFormUrl: text("contact_request_form_url"),
  // Source tracking
  leadSource: text("lead_source"), // Google Search, Bing Search, etc.
  notes: text("notes"),
  // Discovery metadata
  zipCode: text("zip_code"),
  searchQuery: text("search_query"),
  googleBusinessProfileUrl: text("google_business_profile_url"),
  isDuplicate: text("is_duplicate").default("false"), // true, false
  isImported: text("is_imported").default("false"), // true, false
  importedContactId: varchar("imported_contact_id"),
  crawlStatus: text("crawl_status").default("pending"), // pending, completed, failed
  crawlError: text("crawl_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeadDiscoveryJobSchema = createInsertSchema(leadDiscoveryJobs).omit({
  id: true,
  userId: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
}).extend({
  state: z.string().min(1, "State is required"),
  zipCodes: z.string().min(1, "At least one ZIP code is required"),
});

export const insertLeadDiscoveryResultSchema = createInsertSchema(leadDiscoveryResults).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type ContactGroup = typeof contactGroups.$inferSelect;
export type InsertContactGroup = z.infer<typeof insertContactGroupSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type EmailSequence = typeof emailSequences.$inferSelect;
export type InsertEmailSequence = z.infer<typeof insertEmailSequenceSchema>;
export type EmailSequenceLog = typeof emailSequenceLogs.$inferSelect;
export type InsertEmailSequenceLog = z.infer<typeof insertEmailSequenceLogSchema>;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type InsertInboxMessage = z.infer<typeof insertInboxMessageSchema>;
export type LeadDiscoveryJob = typeof leadDiscoveryJobs.$inferSelect;
export type InsertLeadDiscoveryJob = z.infer<typeof insertLeadDiscoveryJobSchema>;
export type LeadDiscoveryResult = typeof leadDiscoveryResults.$inferSelect;
export type InsertLeadDiscoveryResult = z.infer<typeof insertLeadDiscoveryResultSchema>;
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;
