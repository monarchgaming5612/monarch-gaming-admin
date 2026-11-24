import { relations } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { SiteConfig } from '../data/gamingData.ts';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const siteContent = pgTable('site_content', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  data: jsonb('data').$type<SiteConfig>().notNull(),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const uploadedMedia = pgTable('uploaded_media', {
  id: serial('id').primaryKey(),
  mediaKey: text('media_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  base64Data: text('base64_data').notNull(),
  bytes: integer('bytes').notNull(),
  uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  siteContentUpdates: many(siteContent),
  uploadedMedia: many(uploadedMedia),
}));

export const siteContentRelations = relations(siteContent, ({ one }) => ({
  updatedBy: one(users, {
    fields: [siteContent.updatedByUserId],
    references: [users.id],
  }),
}));

export const uploadedMediaRelations = relations(uploadedMedia, ({ one }) => ({
  uploadedBy: one(users, {
    fields: [uploadedMedia.uploadedByUserId],
    references: [users.id],
  }),
}));
