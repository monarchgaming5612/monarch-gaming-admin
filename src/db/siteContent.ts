import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { siteContent, uploadedMedia } from './schema.ts';
import type { SiteConfig } from '../data/gamingData.ts';

const MAIN_CONFIG_KEY = 'main_config';

export async function getMainSiteConfig(): Promise<Partial<SiteConfig> | null> {
  try {
    const rows = await db
      .select({ data: siteContent.data })
      .from(siteContent)
      .where(eq(siteContent.key, MAIN_CONFIG_KEY))
      .limit(1);

    return rows[0]?.data ?? null;
  } catch (error) {
    console.error('Database query failed in getMainSiteConfig:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function saveMainSiteConfig(
  config: SiteConfig,
  updatedByUserId?: number
): Promise<SiteConfig> {
  try {
    const result = await db
      .insert(siteContent)
      .values({
        key: MAIN_CONFIG_KEY,
        data: config,
        updatedByUserId: updatedByUserId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: siteContent.key,
        set: {
          data: config,
          updatedByUserId: updatedByUserId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ data: siteContent.data });

    return result[0]?.data ?? config;
  } catch (error) {
    console.error('Database query failed in saveMainSiteConfig:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function saveUploadedMedia(params: {
  mediaKey: string;
  mimeType: string;
  base64Data: string;
  bytes: number;
  uploadedByUserId?: number;
}) {
  try {
    await db
      .insert(uploadedMedia)
      .values({
        mediaKey: params.mediaKey,
        mimeType: params.mimeType,
        base64Data: params.base64Data,
        bytes: params.bytes,
        uploadedByUserId: params.uploadedByUserId ?? null,
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error('Database query failed in saveUploadedMedia:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getUploadedMedia(mediaKey: string): Promise<{
  mimeType: string;
  base64Data: string;
  bytes: number;
} | null> {
  try {
    const rows = await db
      .select({
        mimeType: uploadedMedia.mimeType,
        base64Data: uploadedMedia.base64Data,
        bytes: uploadedMedia.bytes,
      })
      .from(uploadedMedia)
      .where(eq(uploadedMedia.mediaKey, mediaKey))
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in getUploadedMedia:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}
