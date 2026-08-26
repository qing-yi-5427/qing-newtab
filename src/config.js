/**
 * config.js
 *
 * Central configuration: default shortcuts, search engine table, default
 * settings schema, theme/icon-mode enums, and the AA-friendly colour palette
 * used for generated letter avatars.
 *
 * All values here are plain data; this module has no side effects and no
 * dependency on the DOM, chrome.* APIs, or other app modules.
 */

/**
 * Default shortcut set shown on first run (before any user data exists).
 * @type {Array<{name:string,url:string,size:string}>}
 */
export const DEFAULT_SHORTCUTS = [
  { name: 'GitHub', url: 'https://github.com', size: '1x1' },
  { name: 'YouTube', url: 'https://youtube.com', size: '1x1' },
  { name: 'Twitter', url: 'https://x.com', size: '1x1' },
  { name: 'Reddit', url: 'https://reddit.com', size: '1x1' },
  { name: '知乎', url: 'https://zhihu.com', size: '1x1' },
  { name: '哔哩哔哩', url: 'https://bilibili.com', size: '1x1' },
];

/** Allowed shortcut tile sizes. */
export const SIZES = ['1x1'];

/** Theme modes: follow system / explicit light / explicit dark. */
export const THEME_MODES = ['system', 'light', 'dark'];

/** Icon rendering strategies for shortcuts/bookmarks. */
export const ICON_MODES = ['letter', 'favicon'];

/**
 * Canonical default settings. Persisted (merged) in chrome.storage.local.
 * @type {Record<string, string|number|boolean>}
 */
export const DEFAULT_SETTINGS = {
  theme: 'system',
  wallpaperEnabled: true,
  wallpaperSource: 'bing',
  wallpaperBlur: 0,
  wallpaperDim: 45,
  glassBlur: 10,
  shortcutColumns: 12,
  shortcutRows: 2,
  shortcutIconSize: 48,
  bookmarkWidth: 100,
  showClock: true,
  showAssistant: true,
  showBookmarks: true,
  homeOrder: 'shortcuts-first',
  contentDensity: 'standard',
  syncEnabled: false,
  searchEngine: 'bing',
  customEngineUrl: 'https://www.google.com/search?q=%s',
  iconMode: 'favicon',
  llmProvider: 'deepseek',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  llmWebUrl: '',
};

/**
 * Search engine registry. Each engine exposes a `letter` (shown in the
 * in-search engine switch) and a `build(query, template?)` that returns the
 * destination URL.
 */
export const SEARCH_ENGINES = {
  bing: {
    label: 'Bing',
    letter: 'B',
    build: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  google: {
    label: 'Google',
    letter: 'G',
    build: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  custom: {
    label: '自定义',
    letter: '✎',
    build: (q, template) => {
      const fallback = 'https://www.google.com/search?q=%s';
      let t = template || fallback;
      try {
        const parsed = new URL(t.replace('%s', 'query'));
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') t = fallback;
      } catch {
        t = fallback;
      }
      if (t.includes('%s')) return t.replace('%s', encodeURIComponent(q));
      const sep = t.includes('?') ? '&' : '?';
      return `${t}${sep}q=${encodeURIComponent(q)}`;
    },
  },
};

/**
 * Low-saturation, AA-friendly palette for letter avatars (white text on these
 * backgrounds passes WCAG AA for large text). The colour is deterministically
 * derived from the label so a given site always gets the same colour.
 */
export const LETTER_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#d97706', '#16a34a', '#0891b2', '#4f46e5', '#9333ea',
  '#0d9488', '#ca8a04', '#be123c', '#4338ca', '#15803d',
];
