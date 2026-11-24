import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SiteConfig } from './gamingData';
import {
  normalizeSiteConfig,
  saveSiteConfig,
} from './localStore';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
const SITE_CONTENT_TABLE = 'site_content';
const MAIN_CONFIG_KEY = 'main_config';
const MEDIA_BUCKET = 'monarch-media';

let cachedClient: SupabaseClient | null = null;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && isValidHttpUrl(SUPABASE_URL));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedClient;
}

export async function fetchSiteConfigFromSupabase(): Promise<SiteConfig | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from(SITE_CONTENT_TABLE)
      .select('id, key, data')
      .eq('key', MAIN_CONFIG_KEY)
      .limit(1)
      .maybeSingle();

    if (error || !data || !data.data || typeof data.data !== 'object') {
      return null;
    }

    const normalized = normalizeSiteConfig(data.data as Partial<SiteConfig>);
    saveSiteConfig(normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function saveSiteConfigToSupabase(
  config: SiteConfig
): Promise<{ synced: boolean; error?: string }> {
  const normalized = saveSiteConfig(config);
  const client = getSupabaseClient();
  if (!client) {
    return {
      synced: false,
      error: 'Supabase environment variables are not configured yet.',
    };
  }

  try {
    const { error: upsertError } = await client
      .from(SITE_CONTENT_TABLE)
      .upsert(
        { key: MAIN_CONFIG_KEY, data: normalized },
        { onConflict: 'key' }
      );

    if (!upsertError) {
      return { synced: true };
    }

    // Fallback if table was created without a unique constraint on `key`
    const { data: existing, error: selectError } = await client
      .from(SITE_CONTENT_TABLE)
      .select('id')
      .eq('key', MAIN_CONFIG_KEY)
      .limit(1)
      .maybeSingle();

    if (selectError) {
      return { synced: false, error: upsertError.message };
    }

    if (existing?.id !== undefined) {
      const { error: updateError } = await client
        .from(SITE_CONTENT_TABLE)
        .update({ data: normalized })
        .eq('id', existing.id);

      if (updateError) {
        return { synced: false, error: updateError.message };
      }
      return { synced: true };
    }

    const { error: insertError } = await client
      .from(SITE_CONTENT_TABLE)
      .insert({ key: MAIN_CONFIG_KEY, data: normalized });

    if (insertError) {
      return { synced: false, error: insertError.message };
    }

    return { synced: true };
  } catch (err) {
    return {
      synced: false,
      error: err instanceof Error ? err.message : 'Unable to reach Supabase.',
    };
  }
}

export async function uploadMediaToSupabaseStorage(file: File): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const filePath = `cards/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  try {
    const { error } = await client.storage
      .from(MEDIA_BUCKET)
      .upload(filePath, file, {
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false,
      });

    if (error) {
      return null;
    }

    const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(filePath);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}
