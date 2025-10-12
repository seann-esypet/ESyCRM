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
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: text("role").notNull().default("salesperson"), // salesperson, admin
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  phoneCell: text("phone_cell"),
  phoneWork: text("phone_work"),
  phoneOther: text("phone_other"),
  company: text("company"),
  jobTitle: text("job_title"),
  websiteUrl: text("website_url"),
  facebookUrl: text("facebook_url"),
  instagramHandle: text("instagram_handle"),
  secondaryFirstName: text("secondary_first_name"),
  secondaryLastName: text("secondary_last_name"),
  leadSource: text("lead_source"), // Inbound, Outbound, Cold Call, Facebook Ad, Referral, Event, EsyPet Website Form, Google Search
  currentSoftware: text("current_software"),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active, inactive
  lastContactDate: timestamp("last_contact_date"),
});

export const deals = pgTable("deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  contactId: varchar("contact_id").references(() => contacts.id),
  value: decimal("value", { precision: 10, scale: 2 }),
  plan: text("plan"), // Plan 1 - $2/appoint, Plan 2 - $99/mo, Plan 3 - $150/mo + credit card
  stage: text("stage").notNull().default("lead"), // lead, qualified, proposal, negotiation, closed_won, closed_lost
  probability: integer("probability").default(0), // 0-100
  expectedCloseDate: timestamp("expected_close_date"),
  description: text("description"),
  approved: text("approved").default("pending"), // pending, approved, rejected - for commission approval by admin
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
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
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // contact_added, deal_created, task_completed, etc.
  description: text("description").notNull(),
  contactId: varchar("contact_id").references(() => contacts.id),
  dealId: varchar("deal_id").references(() => deals.id),
  taskId: varchar("task_id").references(() => tasks.id),
  createdAt: timestamp("created_at").defaultNow(),
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

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;
