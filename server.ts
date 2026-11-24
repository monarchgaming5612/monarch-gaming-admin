import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import {
  DEFAULT_SITE_CONFIG,
  sanitizeExternalUrl,
  sanitizeMediaUrl,
  type SiteConfig,
} from './src/data/gamingData.ts';
import {
  getMainSiteConfig,
  getUploadedMedia,
  saveMainSiteConfig,
  saveUploadedMedia,
} from './src/db/siteContent.ts';
import {
  requireAdminRole,
  requireAuth,
  type AuthRequest,
} from './src/middleware/auth.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const ROOT_DIR = process.cwd();
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30MB

function normalizeConfig(input: Partial<SiteConfig>): SiteConfig {
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

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '45mb' }));

  // Public site configuration loaded from Cloud SQL
  app.get('/api/config', async (_req: Request, res: Response) => {
    try {
      const stored = await getMainSiteConfig();
      if (stored) {
        res.json(normalizeConfig(stored));
        return;
      }
      res.json(structuredClone(DEFAULT_SITE_CONFIG));
    } catch (error) {
      console.error('Failed to fetch site config from Cloud SQL:', error);
      res.status(500).json({ error: 'Failed to load site configuration.' });
    }
  });

  // Uploaded media streaming from Cloud SQL (supports Range requests for <video>)
  app.get('/api/media/:filename', async (req: Request, res: Response) => {
    const filename = String(req.params.filename || '');
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/i.test(filename)) {
      res.status(400).json({ error: 'Invalid media identifier' });
      return;
    }

    try {
      const media = await getUploadedMedia(filename);
      if (media) {
        const buffer = Buffer.from(media.base64Data, 'base64');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Type', media.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');

        const range = req.headers.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (match) {
            const start = match[1] ? Number(match[1]) : 0;
            const end = match[2] ? Math.min(Number(match[2]), buffer.length - 1) : buffer.length - 1;
            if (start <= end && end < buffer.length) {
              res.status(206);
              res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
              res.setHeader('Content-Length', String(end - start + 1));
              res.send(buffer.subarray(start, end + 1));
              return;
            }
          }
        }

        res.setHeader('Content-Length', String(buffer.length));
        res.send(buffer);
        return;
      }
    } catch (error) {
      console.error('Failed to fetch uploaded media:', error);
      res.status(500).json({ error: 'Failed to load media.' });
      return;
    }

    // Legacy disk fallback if any files exist locally
    const resolved = path.resolve(UPLOADS_DIR, filename);
    if (resolved.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(resolved)) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(resolved);
      return;
    }

    res.status(404).json({ error: 'Media not found' });
  });

  // Protected: Verify current Firebase-authenticated Admin user
  app.get(
    '/api/admin/me',
    requireAuth,
    requireAdminRole,
    (req: AuthRequest, res: Response) => {
      res.json({
        email: req.dbUser?.email || req.user?.email || '',
        role: req.dbUser?.role || 'admin',
      });
    }
  );

  // Protected: Update full site configuration in Cloud SQL
  app.put(
    '/api/admin/config',
    requireAuth,
    requireAdminRole,
    async (req: AuthRequest, res: Response) => {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({ error: 'Invalid configuration payload.' });
        return;
      }

      if (Array.isArray(req.body.socialLinks)) {
        for (const link of req.body.socialLinks) {
          const raw = typeof link?.url === 'string' ? link.url.trim() : '';
          if (raw && !sanitizeExternalUrl(raw)) {
            res.status(400).json({
              error: `Social link for "${String(link?.label || link?.id || 'channel')}" must start with http:// or https://`,
            });
            return;
          }
        }
      }

      try {
        const normalized = normalizeConfig(req.body as Partial<SiteConfig>);
        const saved = await saveMainSiteConfig(normalized, req.dbUser?.id);
        res.json(saved);
      } catch (error) {
        console.error('Failed to save site config to Cloud SQL:', error);
        res.status(500).json({ error: 'Failed to save configuration.' });
      }
    }
  );

  // Protected: Reset site config to defaults in Cloud SQL
  app.post(
    '/api/admin/reset',
    requireAuth,
    requireAdminRole,
    async (req: AuthRequest, res: Response) => {
      try {
        const fresh = structuredClone(DEFAULT_SITE_CONFIG);
        fresh.updatedAt = new Date().toISOString();
        const saved = await saveMainSiteConfig(fresh, req.dbUser?.id);
        res.json(saved);
      } catch (error) {
        console.error('Failed to reset site config in Cloud SQL:', error);
        res.status(500).json({ error: 'Failed to reset configuration.' });
      }
    }
  );

  // Protected: Upload photo or video for profile cards to Cloud SQL
  app.post(
    '/api/admin/upload',
    requireAuth,
    requireAdminRole,
    async (req: AuthRequest, res: Response) => {
      const mimeType = String(req.body?.mimeType || '').toLowerCase().trim();
      const dataBase64 = String(req.body?.dataBase64 || '');

      const ext = ALLOWED_MIME_TO_EXT[mimeType];
      if (!ext) {
        res.status(400).json({
          error: 'Unsupported file type. Allowed: JPG, PNG, WEBP, GIF, MP4, WEBM, MOV.',
        });
        return;
      }

      if (!dataBase64) {
        res.status(400).json({ error: 'Missing media payload.' });
        return;
      }

      const commaIdx = dataBase64.indexOf(',');
      const cleanB64 = commaIdx !== -1 ? dataBase64.slice(commaIdx + 1) : dataBase64;
      const buffer = Buffer.from(cleanB64, 'base64');

      if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
        res.status(400).json({ error: 'Media file must be between 1 byte and 30 MB.' });
        return;
      }

      const safeFilename = `${crypto.randomUUID()}${ext}`;
      try {
        await saveUploadedMedia({
          mediaKey: safeFilename,
          mimeType,
          base64Data: cleanB64,
          bytes: buffer.length,
          uploadedByUserId: req.dbUser?.id,
        });

        const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';
        res.json({
          mediaUrl: `/api/media/${safeFilename}`,
          mediaType,
          bytes: buffer.length,
        });
      } catch (error) {
        console.error('Failed to store uploaded media in Cloud SQL:', error);
        res.status(500).json({ error: 'Failed to store uploaded media.' });
      }
    }
  );

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Monarch Gaming server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
