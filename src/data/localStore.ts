import {
  DEFAULT_SITE_CONFIG,
  sanitizeExternalUrl,
  sanitizeMediaUrl,
  type MediaType,
  type SiteConfig,
} from './gamingData';

export const ADMIN_EMAIL = 'monarchgaming5612@gmail.com';
export const SITE_CONFIG_STORAGE_KEY = 'monarch_gaming_site_config_v1';
export const ADMIN_AUTH_STORAGE_KEY = 'monarch_gaming_admin_auth_v1';
export const CONFIG_UPDATED_EVENT = 'monarch:config-updated';

const IDB_NAME = 'monarch_gaming_media_db';
const IDB_STORE = 'media_blobs';

interface StoredAdminAuth {
  email: string;
  salt: string;
  passwordHash: string;
  claimedAt: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function fallbackSaltedHash(password: string, saltHex: string): string {
  // Portable iterated FNV-1a + mixing fallback when crypto.subtle is unavailable (non-HTTPS)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const input = `${saltHex}:${password}:${saltHex}`;
  for (let round = 0; round < 2048; round += 1) {
    for (let i = 0; i < input.length; i += 1) {
      const ch = input.charCodeAt(i);
      h1 ^= ch ^ (round & 0xff);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= ch + ((h1 >>> 5) | (h1 << 27));
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

async function derivePasswordHash(password: string, saltHex: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode(saltHex),
        iterations: 100_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    return bytesToHex(new Uint8Array(derivedBits));
  }
  return fallbackSaltedHash(password, saltHex);
}

function readStoredAdminAuth(): StoredAdminAuth | null {
  try {
    const raw = window.localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAdminAuth>;
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      parsed.email.toLowerCase() === ADMIN_EMAIL &&
      typeof parsed.salt === 'string' &&
      typeof parsed.passwordHash === 'string'
    ) {
      return {
        email: ADMIN_EMAIL,
        salt: parsed.salt,
        passwordHash: parsed.passwordHash,
        claimedAt: String(parsed.claimedAt || ''),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getLocalAdminAuthStatus(): {
  needsSetup: boolean;
  configuredEmail: string;
} {
  const stored = readStoredAdminAuth();
  return {
    needsSetup: !stored,
    configuredEmail: ADMIN_EMAIL,
  };
}

export async function claimLocalAdminAccess(
  email: string,
  password: string
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const existing = readStoredAdminAuth();
  if (existing) {
    return { ok: false, error: 'Admin access has already been configured.' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { ok: false, error: 'Please enter a valid admin email address.' };
  }
  if (normalizedEmail !== ADMIN_EMAIL) {
    return {
      ok: false,
      error: `Admin setup is restricted to ${ADMIN_EMAIL}.`,
    };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToHex(saltBytes);
  const passwordHash = await derivePasswordHash(password, salt);

  const record: StoredAdminAuth = {
    email: ADMIN_EMAIL,
    salt,
    passwordHash,
    claimedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, JSON.stringify(record));
  return { ok: true, email: ADMIN_EMAIL };
}

export async function loginLocalAdmin(
  email: string,
  password: string
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const stored = readStoredAdminAuth();
  if (!stored) {
    return { ok: false, error: 'Initial admin setup is required first.' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { ok: false, error: 'Email and password are required.' };
  }

  if (!constantTimeEqual(normalizedEmail, stored.email)) {
    return { ok: false, error: 'Invalid admin email or password.' };
  }

  const candidateHash = await derivePasswordHash(password, stored.salt);
  if (!constantTimeEqual(candidateHash, stored.passwordHash)) {
    return { ok: false, error: 'Invalid admin email or password.' };
  }

  return { ok: true, email: stored.email };
}

export function normalizeSiteConfig(input: Partial<SiteConfig>): SiteConfig {
  const d = DEFAULT_SITE_CONFIG;
  const stats = Array.isArray(input.stats) && input.stats.length > 0 ? input.stats : d.stats;
  const featuredGames = (
    Array.isArray(input.featuredGames) ? input.featuredGames : d.featuredGames
  ).map((g, idx) => {
    const photos = Array.isArray(g.photos)
      ? g.photos.map((u) => sanitizeMediaUrl(u)).filter((u): u is string => Boolean(u)).slice(0, 20)
      : g.mediaUrl && g.mediaType !== 'video' && sanitizeMediaUrl(g.mediaUrl)
        ? [sanitizeMediaUrl(g.mediaUrl)!]
        : [];
    const videos = Array.isArray(g.videos)
      ? g.videos.map((u) => sanitizeMediaUrl(u)).filter((u): u is string => Boolean(u)).slice(0, 10)
      : g.mediaUrl && g.mediaType === 'video' && sanitizeMediaUrl(g.mediaUrl)
        ? [sanitizeMediaUrl(g.mediaUrl)!]
        : [];
    const primaryMedia = sanitizeMediaUrl(g.mediaUrl) ?? videos[0] ?? photos[0];
    const primaryType =
      g.mediaType === 'video' || (!g.mediaUrl && videos.length > 0)
        ? ('video' as const)
        : primaryMedia
          ? ('image' as const)
          : undefined;

    return {
      id: String(g.id || `game-${idx + 1}`).slice(0, 60),
      title: String(g.title || 'UNTITLED PROFILE').slice(0, 80),
      genre: String(g.genre || 'Esports').slice(0, 50),
      mode: String(g.mode || 'Mobile').slice(0, 50),
      playersBadge: String(g.playersBadge || '').slice(0, 40),
      prizePool: String(g.prizePool || '$1,000').slice(0, 30),
      nextMatchIn: String(g.nextMatchIn || '05m 00s').slice(0, 30),
      activeRooms: Number.isFinite(Number(g.activeRooms)) ? Math.max(0, Number(g.activeRooms)) : 0,
      description: String(g.description || '').slice(0, 500),
      status: g.status === 'pending' ? ('pending' as const) : ('active' as const),
      photos,
      videos,
      mediaUrl: primaryMedia,
      mediaType: primaryType,
      tournaments: Array.isArray(g.tournaments)
        ? g.tournaments.slice(0, 10).map((t) => ({
            name: String(t.name || 'Open Bracket').slice(0, 80),
            format: String(t.format || 'Squad').slice(0, 60),
            entry: String(t.entry || 'Free Entry').slice(0, 40),
            prize: String(t.prize || '$500').slice(0, 30),
            slots: String(t.slots || '0 / 32').slice(0, 30),
          }))
        : [],
    };
  });

  const leaderboard = (
    Array.isArray(input.leaderboard) ? input.leaderboard : d.leaderboard
  ).map((p, idx) => {
    const numeric = Number.isFinite(Number(p.pointsNumeric))
      ? Math.max(0, Math.round(Number(p.pointsNumeric)))
      : 0;
    return {
      rank: idx + 1,
      name: String(p.name || `Player_${idx + 1}`).slice(0, 40),
      points: `${numeric.toLocaleString('en-US')} PTS`,
      pointsNumeric: numeric,
      winRate: Number.isFinite(Number(p.winRate))
        ? Math.min(100, Math.max(0, Math.round(Number(p.winRate))))
        : 50,
      primaryGame: String(p.primaryGame || 'free-fire').slice(0, 60),
      region: String(p.region || 'GLOBAL').slice(0, 20),
      matches: Number.isFinite(Number(p.matches)) ? Math.max(0, Math.round(Number(p.matches))) : 0,
      bio: p.bio ? String(p.bio).slice(0, 300) : '',
      mediaUrl: sanitizeMediaUrl(p.mediaUrl),
      mediaType:
        p.mediaType === 'video'
          ? ('video' as const)
          : p.mediaType === 'image'
            ? ('image' as const)
            : undefined,
    };
  });

  const socialLinksMap = new Map(
    (Array.isArray(input.socialLinks) ? input.socialLinks : d.socialLinks).map((item) => [
      item.id,
      item,
    ])
  );

  const socialLinks = d.socialLinks.map((base) => {
    const incoming = socialLinksMap.get(base.id);
    if (!incoming) return base;
    const rawUrl = typeof incoming.url === 'string' ? incoming.url.trim() : '';
    const safeUrl = rawUrl ? sanitizeExternalUrl(rawUrl) ?? '' : '';
    return {
      id: base.id,
      label: String(incoming.label || base.label).slice(0, 40),
      url: safeUrl,
      enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : true,
    };
  });

  return {
    brand: {
      topName: String(input.brand?.topName ?? d.brand.topName).slice(0, 30),
      bottomName: String(input.brand?.bottomName ?? d.brand.bottomName).slice(0, 30),
      domainSuffix: String(input.brand?.domainSuffix ?? d.brand.domainSuffix).slice(0, 20),
      profileUrl:
        input.brand?.profileUrl !== undefined
          ? sanitizeExternalUrl(input.brand.profileUrl) ?? ''
          : d.brand.profileUrl,
    },
    hero: {
      headline: String(input.hero?.headline ?? d.hero.headline).slice(0, 60),
      subtitle: String(input.hero?.subtitle ?? d.hero.subtitle).slice(0, 60),
      description: String(input.hero?.description ?? d.hero.description).slice(0, 400),
      primaryCtaText: String(input.hero?.primaryCtaText ?? d.hero.primaryCtaText).slice(0, 40),
      secondaryCtaText: String(input.hero?.secondaryCtaText ?? d.hero.secondaryCtaText).slice(0, 40),
      downloadUrl:
        input.hero?.downloadUrl !== undefined
          ? sanitizeExternalUrl(input.hero.downloadUrl) ?? ''
          : d.hero.downloadUrl,
      androidVersion: String(input.hero?.androidVersion ?? d.hero.androidVersion).slice(0, 60),
      androidSize: String(input.hero?.androidSize ?? d.hero.androidSize).slice(0, 60),
      iosLabel: String(input.hero?.iosLabel ?? d.hero.iosLabel).slice(0, 60),
      iosSize: String(input.hero?.iosSize ?? d.hero.iosSize).slice(0, 60),
    },
    stats: stats.slice(0, 3).map((s, idx) => ({
      id: String(s.id || `stat-${idx}`).slice(0, 30),
      value: String(s.value || '0').slice(0, 20),
      label: String(s.label || 'Metric').slice(0, 30),
      badge: String(s.badge || 'Active').slice(0, 30),
      icon:
        s.icon === 'tournaments' || s.icon === 'support' || s.icon === 'players'
          ? s.icon
          : 'players',
    })),
    featuredGamesTitle: String(input.featuredGamesTitle ?? d.featuredGamesTitle).slice(0, 60),
    featuredGames,
    about: {
      enabled: typeof input.about?.enabled === 'boolean' ? input.about.enabled : d.about.enabled,
      title: String(input.about?.title ?? d.about.title).slice(0, 80),
      subtitle: String(input.about?.subtitle ?? d.about.subtitle).slice(0, 120),
      body: String(input.about?.body ?? d.about.body).slice(0, 3000),
    },
    leaderboardTitle: String(input.leaderboardTitle ?? d.leaderboardTitle).slice(0, 60),
    leaderboardSubtitle: String(input.leaderboardSubtitle ?? d.leaderboardSubtitle).slice(0, 120),
    leaderboardCtaText: String(input.leaderboardCtaText ?? d.leaderboardCtaText).slice(0, 50),
    leaderboard,
    footer: {
      copyright: String(input.footer?.copyright ?? d.footer.copyright).slice(0, 140),
      followHeading: String(input.footer?.followHeading ?? d.footer.followHeading).slice(0, 40),
    },
    socialLinks,
    updatedAt: new Date().toISOString(),
  };
}

export function loadSiteConfig(): SiteConfig {
  if (typeof window === 'undefined') {
    return structuredClone(DEFAULT_SITE_CONFIG);
  }
  try {
    const raw = window.localStorage.getItem(SITE_CONFIG_STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_SITE_CONFIG);
    }
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return normalizeSiteConfig(parsed);
  } catch {
    return structuredClone(DEFAULT_SITE_CONFIG);
  }
}

export function saveSiteConfig(input: SiteConfig): SiteConfig {
  const normalized = normalizeSiteConfig(input);
  window.localStorage.setItem(SITE_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent<SiteConfig>(CONFIG_UPDATED_EVENT, { detail: normalized })
  );
  return normalized;
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Unable to open browser media database.'));
  });
}

async function saveBlobToIndexedDb(blob: Blob): Promise<string> {
  const id = generateUuid();
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, id);
    tx.oncomplete = () => {
      db.close();
      resolve(`idb-media:${id}`);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to store media in browser storage.'));
    };
  });
}

export async function loadBlobFromIndexedDb(mediaRef: string): Promise<Blob | null> {
  if (!mediaRef.startsWith('idb-media:')) return null;
  const id = mediaRef.slice('idb-media:'.length);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const db = await openMediaDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => {
        db.close();
        resolve(req.result instanceof Blob ? req.result : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

export async function deleteBlobFromIndexedDb(mediaRef: string): Promise<void> {
  if (!mediaRef.startsWith('idb-media:')) return;
  const id = mediaRef.slice('idb-media:'.length);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  try {
    const db = await openMediaDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore cleanup errors
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read media file.'));
    reader.readAsDataURL(blob);
  });
}

async function compressImageToDataUrl(
  file: File,
  maxDim = 1200,
  quality = 0.82
): Promise<string> {
  // Keep animated GIFs intact unless oversized
  if (file.type === 'image/gif' && file.size <= 450 * 1024) {
    return readBlobAsDataUrl(file);
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        readBlobAsDataUrl(file).then(resolve).catch(() => resolve(''));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const outputMime =
        file.type === 'image/png' && file.size < 250_000
          ? 'image/png'
          : 'image/jpeg';
      const dataUrl = canvas.toDataURL(outputMime, quality);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      readBlobAsDataUrl(file).then(resolve).catch(() => resolve(''));
    };

    img.src = objectUrl;
  });
}

export async function storeBrowserMedia(
  file: File,
  kind: MediaType
): Promise<string> {
  if (kind === 'image') {
    let dataUrl = await compressImageToDataUrl(file, 1200, 0.82);
    if (dataUrl && dataUrl.length >= 420_000) {
      dataUrl = await compressImageToDataUrl(file, 900, 0.72);
    }
    if (dataUrl && dataUrl.length < 480_000) {
      return dataUrl;
    }
    return saveBlobToIndexedDb(file);
  }

  // Small clips fit inside JSONB + localStorage so all global visitors can view them
  if (file.size <= 1.5 * 1024 * 1024) {
    const dataUrl = await readBlobAsDataUrl(file);
    if (dataUrl && dataUrl.length <= 2_100_000) {
      return dataUrl;
    }
  }

  return saveBlobToIndexedDb(file);
}
