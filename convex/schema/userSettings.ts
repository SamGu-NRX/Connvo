/**
 * User Settings Schema
 *
 * This module defines the schema for user settings/preferences with
 * proper indexing for efficient queries.
 *
 * Requirements: 9.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex schema patterns
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const userSettings = defineTable({
  userId: v.id("users"),
  
  // Notification preferences
  emailNotifications: v.boolean(),
  pushNotifications: v.boolean(),
  smsNotifications: v.boolean(),
  
  // Privacy settings
  profileVisibility: v.boolean(), // true = public, false = private
  dataSharing: v.boolean(),
  activityTracking: v.boolean(),
  
  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"]);