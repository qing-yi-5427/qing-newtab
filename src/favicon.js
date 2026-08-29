/**
 * favicon.js
 *
 * Generates zero-network "letter avatars" (inline SVG) for shortcuts and
 * bookmarks, and resolves real icons through a high-resolution icon service
 * with site-owned endpoints as fallbacks.
 *
 * Letter avatars: first character uppercased, white text, background colour
 * deterministically hashed from the label (stable across renders). The SVG is
 * returned as a string for direct `innerHTML` injection (no network, no data
 * URL overhead).
 */

import { LETTER_PALETTE } from './config.js';
import * as storage from './storage.js';

// Some sites publish only a 16 px favicon even though an official high-
// resolution application icon exists. Keep these narrow overrides explicit;
// the generic fallback chain remains responsible for every other site.
const HIGH_RES_ICON_OVERRIDES = new Map([
  ['miyoushe.com', 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/a7/e3/e9/a7e3e9df-0f89-5369-ab35-0017a9025bd9/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/256x256bb.jpg'],
  ['bbs.mihoyo.com', 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/a7/e3/e9/a7e3e9df-0f89-5369-ab35-0017a9025bd9/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/256x256bb.jpg'],
  ['jd.com', 'https://files.codelife.cc/icons/jd.svg'],
  ['email.163.com', 'https://files.codelife.cc/icons/eb58486c2f648735.png'],
  ['mail.163.com', 'https://files.codelife.cc/icons/eb58486c2f648735.png'],
  ['pan.baidu.com', 'https://files.codelife.cc/icons/pan-baidu.svg'],
  ['twitter.com', 'https://files.codelife.cc/icons/x.com.svg'],
  ['x.com', 'https://files.codelife.cc/icons/x.com.svg'],
  ['2dfan.com', 'https://files.codelife.cc/icons/5a3cc7bb7abcde1715cb29bf.png'],
  ['bbs.mikocon.com', 'https://files.codelife.cc/website/user_e36N5keRReUD-q1AQiWcT.png'],
]);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Stable 32-bit-ish string hash. @returns {number} non-negative int */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Map a label to a stable palette colour. */
export function colorFor(str) {
  return LETTER_PALETTE[hashString(str || 'x') % LETTER_PALETTE.length];
}

/** Extract a clean host (no leading www.) from a URL, or '' on failure. */
export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isIpAddress(hostname) {
  return hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Do not disclose private/intranet hostnames to public icon services. */
export function isPrivateIconHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return !host.includes('.')
    || isIpAddress(host)
    || ['.local', '.lan', '.internal', '.home', '.localhost'].some((suffix) => host.endsWith(suffix));
}

function browserFaviconUrl(pageUrl) {
  try {
    if (!globalThis.chrome?.runtime?.getURL) return '';
    const iconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    iconUrl.searchParams.set('pageUrl', pageUrl);
    iconUrl.searchParams.set('size', '128');
    return iconUrl.href;
  } catch {
    return '';
  }
}

function siteIconCandidates(origin) {
  return [
    `${origin}/favicon.svg`,
    `${origin}/favicon-192x192.png`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/favicon-96x96.png`,
    `${origin}/favicon.png`,
    `${origin}/favicon.ico`,
  ];
}

function publicParentHost(hostname) {
  const labels = hostname.replace(/^www\./, '').split('.');
  return labels.length > 2 ? labels.slice(1).join('.') : '';
}

/**
 * Build an inline SVG letter avatar string.
 * @param {string} name label used for the letter + colour
 * @param {number} [size=40] rendered pixel size (viewBox is fixed at 40)
 * @returns {string} SVG markup
 */
export function letterAvatarSVG(name, size = 40) {
  const ch = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const color = colorFor(name || 'x');
  const fontSize = Math.round(size * 0.5);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 40 40" role="img" aria-hidden="true">` +
    `<rect width="40" height="40" rx="8" fill="${color}"/>` +
    `<text x="20" y="21" font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif" ` +
    `font-size="${fontSize}" font-weight="600" fill="#ffffff" text-anchor="middle" ` +
    `dominant-baseline="central">${escapeHtml(ch)}</text></svg>`
  );
}

/**
 * Return site-owned icon candidates from highest to lowest expected quality.
 * Loading them as <img> resources does not require broad host permissions.
 * @param {string} url
 * @returns {string[]}
 */
export function faviconCandidates(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const candidates = [];
    const browserIcon = browserFaviconUrl(parsed.href);
    if (isPrivateIconHost(host)) {
      if (browserIcon) candidates.push(browserIcon);
      return [...candidates, ...siteIconCandidates(parsed.origin)];
    }

    const highResolutionOverride = HIGH_RES_ICON_OVERRIDES.get(host);
    if (highResolutionOverride) candidates.push(highResolutionOverride);

    // Ask for the largest available official asset first. The browser keeps
    // the response bytes in its HTTP cache; extension storage only remembers
    // which URL succeeded, so raster icons are never re-scaled or re-encoded.
    candidates.push(
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.origin)}&sz=256`,
      `https://favicon.im/${encodeURIComponent(host)}?larger=true&throw-error-on-404=true`,
      ...siteIconCandidates(parsed.origin),
    );

    const parentHost = publicParentHost(host);
    if (parentHost && !isPrivateIconHost(parentHost)) {
      const parentOrigin = `${parsed.protocol}//${parentHost}`;
      candidates.push(
        `https://favicon.im/${encodeURIComponent(parentHost)}?larger=true&throw-error-on-404=true`,
        ...siteIconCandidates(parentOrigin),
      );
    }
    // Edge's public-site favicon endpoint may report a 128 px canvas while
    // merely enlarging a 16 px icon. Do not accept that pseudo-HD fallback;
    // a crisp letter is preferable when no real high-resolution source exists.
    return [...new Set(candidates)];
  } catch {
    return [];
  }
}

function persistLoadedIcon(host, source) {
  void storage.setCachedFavicon(host, source).catch(() => {});
}

/** Load a website icon, preferring the source that succeeded on a previous tab. */
export function renderWebsiteIcon(container, {
  url,
  label,
  iconMode = 'favicon',
  cachedUrl = null,
  size = 40,
  minimumSourceSize = 64,
  loading = 'eager',
} = {}) {
  const host = hostFromUrl(url);
  const renderToken = {};
  container.iconRenderToken = renderToken;

  const showLetter = () => {
    container.innerHTML = letterAvatarSVG(label || host || '?', size);
  };
  if (iconMode !== 'favicon' || !host) {
    showLetter();
    return;
  }

  const candidates = faviconCandidates(url).filter((candidate) => candidate !== cachedUrl);
  let candidateIndex = -1;
  const loadSource = (source, fromCache = false) => {
    const nextImage = document.createElement('img');
    nextImage.className = 'site-icon';
    nextImage.alt = label || '网站图标';
    nextImage.referrerPolicy = 'no-referrer';
    nextImage.loading = loading;
    nextImage.decoding = fromCache ? 'sync' : 'async';
    nextImage.onerror = () => {
      if (fromCache) {
        void storage.removeCachedFavicon(host).catch(() => {});
        showLetter();
      }
      tryNext();
    };
    nextImage.onload = () => {
      if (nextImage.naturalWidth < minimumSourceSize || nextImage.naturalHeight < minimumSourceSize) {
        if (fromCache) {
          void storage.removeCachedFavicon(host).catch(() => {});
          showLetter();
        }
        tryNext();
        return;
      }
      if (container.iconRenderToken === renderToken) container.replaceChildren(nextImage);
      if (!fromCache || cachedUrl !== nextImage.currentSrc) {
        persistLoadedIcon(host, source);
      }
    };
    nextImage.src = source;
    if (fromCache) container.replaceChildren(nextImage);
  };

  const tryNext = () => {
    candidateIndex += 1;
    if (candidateIndex >= candidates.length) {
      showLetter();
      return;
    }
    loadSource(candidates[candidateIndex]);
  };

  if (cachedUrl) loadSource(cachedUrl, true);
  else {
    showLetter();
    tryNext();
  }
}

/** Batch-load cached sources for a set of page URLs. */
export async function cachedFaviconSources(urls) {
  const hosts = [...new Set((urls || []).map(hostFromUrl).filter(Boolean))];
  return storage.getCachedFavicons(hosts);
}

/** Backward-compatible helper returning the preferred high-resolution icon. */
export async function fetchFaviconDataUrl(url) {
  return faviconCandidates(url)[0] || null;
}
