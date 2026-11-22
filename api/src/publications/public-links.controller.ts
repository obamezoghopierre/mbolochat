import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { PublicationsService } from './publications.service.js';

/** Échappe une valeur pour un attribut ou un texte HTML. */
function html(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Liste « a,b,c » d'une variable d'environnement, sans vides. */
function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Liens web partageables, sans connexion :
 *
 * - `GET /p/:id` : page d'aperçu d'une publication **publique** (balises
 *   Open Graph pour l'aperçu WhatsApp/X/Telegram…), bouton « Ouvrir dans
 *   MboloChat » et liens vers les boutiques. Rien n'est révélé pour un
 *   contenu non public : même page neutre qu'une publication inexistante.
 * - `/.well-known/apple-app-site-association` et `/.well-known/assetlinks.json` :
 *   fichiers qui permettent à iOS (Universal Links) et Android (App Links)
 *   d'ouvrir directement l'app quand elle est installée.
 *
 * Tout est piloté par l'environnement (voir `.env.example`) : sans
 * identifiants d'app, les fichiers .well-known répondent vides et le lien
 * reste une simple page web.
 */
@Controller()
export class PublicLinksController {
  constructor(
    private readonly publications: PublicationsService,
    private readonly config: ConfigService,
  ) {}

  @Get('p/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async post(@Param('id') id: string, @Res() res: Response) {
    const safeId = /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : '';
    const preview = safeId ? await this.publications.publicPreview(safeId) : null;
    const scheme = this.config.get<string>('APP_SCHEME') ?? 'mbolochat';
    const base = (this.config.get<string>('PUBLIC_WEB_URL') ?? '').replace(/\/$/, '');
    const appStore = this.config.get<string>('APP_STORE_URL') ?? '';
    const playStore = this.config.get<string>('PLAY_STORE_URL') ?? '';
    const deepLink = `${scheme}://post/${safeId}`;
    const pageUrl = base ? `${base}/p/${safeId}` : '';

    const name = preview?.author.displayName ?? 'MboloChat';
    const text = (preview?.title || preview?.caption || '').trim();
    const description = text ? text.slice(0, 200) : 'Découvre cette publication sur MboloChat.';
    const title = preview ? `${name} sur MboloChat` : 'MboloChat';

    const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<meta name="robots" content="noindex">
<meta property="og:site_name" content="MboloChat">
<meta property="og:type" content="article">
<meta property="og:title" content="${html(title)}">
<meta property="og:description" content="${html(description)}">
${pageUrl ? `<meta property="og:url" content="${html(pageUrl)}">` : ''}
${preview?.imageUrl ? `<meta property="og:image" content="${html(preview.imageUrl)}">` : ''}
<meta name="twitter:card" content="${preview?.imageUrl ? 'summary_large_image' : 'summary'}">
${appStore ? `<meta name="apple-itunes-app" content="app-id=${html(appStore.match(/id(\d+)/)?.[1] ?? '')}, app-argument=${html(deepLink)}">` : ''}
<style>
  body{margin:0;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#000;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{max-width:420px;width:100%;padding:24px;box-sizing:border-box;text-align:center}
  img.media{width:100%;border-radius:16px;margin:16px 0;object-fit:cover;max-height:520px}
  .author{font-weight:700;font-size:17px}
  .text{opacity:.85;line-height:1.4;white-space:pre-wrap;margin:8px 0 20px}
  a.btn{display:block;background:#FFFC00;color:#000;font-weight:700;text-decoration:none;padding:14px;border-radius:999px;margin:10px 0}
  a.store{display:inline-block;color:#fff;opacity:.8;margin:6px 10px;font-size:14px}
</style>
</head>
<body>
<main class="card">
  ${preview ? `<div class="author">${html(name)} <span style="opacity:.6">@${html(preview.author.username)}</span></div>` : '<div class="author">MboloChat</div>'}
  ${preview?.imageUrl ? `<img class="media" src="${html(preview.imageUrl)}" alt="">` : ''}
  <p class="text">${preview ? html(description) : 'Cette publication n’est pas disponible ou n’est pas publique.'}</p>
  ${safeId ? `<a class="btn" href="${html(deepLink)}">Ouvrir dans MboloChat</a>` : ''}
  ${appStore ? `<a class="store" href="${html(appStore)}">App Store</a>` : ''}
  ${playStore ? `<a class="store" href="${html(playStore)}">Google Play</a>` : ''}
</main>
</body>
</html>`;
    res
      .status(preview ? 200 : 404)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(page);
  }

  /** iOS Universal Links : l'app s'ouvre directement sur `/p/*`. */
  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json')
  appleAssociation() {
    const teamId = this.config.get<string>('APPLE_TEAM_ID');
    const bundleId = this.config.get<string>('IOS_BUNDLE_ID');
    const appIDs = teamId && bundleId ? [`${teamId}.${bundleId}`] : [];
    return {
      applinks: {
        details: appIDs.length ? [{ appIDs, components: [{ '/': '/p/*' }] }] : [],
      },
    };
  }

  /** Android App Links : empreintes SHA-256 du certificat de signature. */
  @Get('.well-known/assetlinks.json')
  @Header('Content-Type', 'application/json')
  androidAssociation() {
    const pkg = this.config.get<string>('ANDROID_PACKAGE') ?? 'com.groupenzogho.mbolochat';
    const fingerprints = list(this.config.get<string>('ANDROID_SHA256_FINGERPRINTS'));
    return fingerprints.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: pkg,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];
  }
}
