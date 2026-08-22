/** Wallpaper source selection and visual treatments. */

import * as storage from './storage.js';
import * as state from './state.js';

const BING_API =
  'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN';

let wallpaperEl = null;
let overlayEl = null;
let refreshVersion = 0;

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function validImageUrl(value) {
  const url = String(value || '');
  return url.startsWith('data:image/') || url.startsWith('blob:') || /^https?:\/\//i.test(url);
}

function applyEffects(settings) {
  const blur = Math.max(0, Math.min(20, Number(settings.wallpaperBlur) || 0));
  const dim = Math.max(0, Math.min(75, Number(settings.wallpaperDim) || 0));
  const glass = Math.max(0, Math.min(30, Number(settings.glassBlur) || 0));
  wallpaperEl.style.filter = `blur(${blur}px) scale(${1 + blur / 300})`;
  overlayEl.style.background = `rgba(0, 0, 0, ${dim / 100})`;
  document.documentElement.style.setProperty('--glass-blur', `${glass}px`);
}

function setWallpaper(url, fade = false) {
  wallpaperEl.style.backgroundImage = validImageUrl(url)
    ? `url("${String(url).replace(/["\\]/g, '\\$&')}")`
    : '';
  wallpaperEl.classList.toggle('loaded', fade);
}

async function fetchBing() {
  try {
    const response = await fetch(BING_API);
    if (!response.ok) return null;
    const data = await response.json();
    const path = data.images?.[0]?.url;
    return path ? new URL(path, 'https://www.bing.com').href : null;
  } catch {
    return null;
  }
}

async function refresh() {
  if (!wallpaperEl || !overlayEl) return;
  const version = ++refreshVersion;
  const settings = await storage.getSettings();
  applyEffects(settings);

  const source = settings.wallpaperSource || (settings.wallpaperEnabled ? 'bing' : 'gradient');
  if (source === 'gradient') {
    setWallpaper('');
    return;
  }
  if (source === 'custom') {
    setWallpaper(await storage.getCustomWallpaper());
    return;
  }

  const key = todayKey();
  const cached = await storage.getCachedWallpaper(key);
  if (version !== refreshVersion) return;
  if (cached) {
    setWallpaper(cached);
    return;
  }

  const fresh = await fetchBing();
  if (!fresh || version !== refreshVersion) return;
  setWallpaper(fresh, !cached);
  await storage.setCachedWallpaper(key, fresh);
}

export function initWallpaper() {
  wallpaperEl = document.getElementById('wallpaper');
  overlayEl = document.getElementById('overlay');
  refresh();
  state.subscribe((changedKeys) => {
    const wallpaperKeys = ['wallpaperSource', 'wallpaperBlur', 'wallpaperDim', 'glassBlur', 'customWallpaper'];
    if (!changedKeys || changedKeys.some((key) => wallpaperKeys.includes(key))) refresh();
  });
}
