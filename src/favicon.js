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
    `${origin}/apple-touch-icon.png`,
    `${origin}/favicon-192x192.png`,
    `${origin}/favicon.svg`,
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

    candidates.push(
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

    candidates.push(
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.origin)}&sz=128`,
    );
    return [...new Set(candidates)];
  } catch {
    return [];
  }
}

/** Backward-compatible helper returning the preferred high-resolution icon. */
export async function fetchFaviconDataUrl(url) {
  return faviconCandidates(url)[0] || null;
}
