// src/db/schema.ts
import { relations } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

// --- Enums for DB constraints ---
export const connectionStatusEnum = pgEnum("connection_status", [
  "online",
  "away",
  "offline",
]);
export const connectionTypeEnum = pgEnum("connection_type", [
  "b2b",
  "collaboration",
  "mentorship",
  "investment",
  "general",
]);
export const interestCategoryEnum = pgEnum("interest_category", [
  "academic",
  "industry",
  "skill",
  "personal",
]);

// --- Users Table ---
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: varchar("clerk_id", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),

  // Personal information
  bio: text("bio"),
  age: integer("age"),
  gender: varchar("gender", { length: 50 }),

  // Professional information
  field: varchar("field", { length: 100 }),
  jobTitle: varchar("job_title", { length: 100 }),
  company: varchar("company", { length: 100 }),
  experience: integer("experience"),
  linkedinUrl: varchar("linkedin_url", { length: 255 }),

  // Educational information
  school: varchar("school", { length: 100 }),

  // Platform settings
  onboardingComplete: boolean("onboarding_complete").default(false),

  // Timestamps
  createdAt: timestamp("created_at", { precision: 3 }).defaultNow(),
  updatedAt: timestamp("updated_at", { precision: 3 }).defaultNow(),
});

// --- Interests Table ---
// Note: The `customId` column remains to support custom interests.
export const interests = pgTable("interests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  category: interestCategoryEnum("category").notNull(),
  iconName: varchar("icon_name", { length: 50 }),
  customId: varchar("custom_id", { length: 100 }),
});

// --- Meetings Table ---
// Updated foreign keys to UUID
export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  user1Id: uuid("user1_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  user2Id: uuid("user2_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { precision: 3 }),
  isRandom: boolean("is_random").default(true).notNull(),
  createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
});

// --- Connections Table ---
export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  user1Id: uuid("user1_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  user2Id: uuid("user2_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
});

// --- Messages Table ---
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => connections.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
});

// --- Relations ---
export const userRelations = relations(users, ({ many }) => ({
  interests: many(interests),
  connectionsInitiated: many(connections, { relationName: "user1" }),
  connectionsReceived: many(connections, { relationName: "user2" }),
  sentMessages: many(messages),
}));

export const interestRelations = relations(interests, ({ one }) => ({
  user: one(users, { fields: [interests.userId], references: [users.id] }),
}));

export const connectionRelations = relations(connections, ({ one, many }) => ({
  user1: one(users, {
    fields: [connections.user1Id],
    references: [users.id],
    relationName: "user1",
  }),
  user2: one(users, {
    fields: [connections.user2Id],
    references: [users.id],
    relationName: "user2",
  }),
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  connection: one(connections, {
    fields: [messages.connectionId],
    references: [connections.id],
  }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));
