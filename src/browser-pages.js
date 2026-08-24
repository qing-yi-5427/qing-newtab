/** Built-in Edge pages exposed as lightweight new-tab actions. */

export const BROWSER_PAGES = {
  history: { label: '历史记录', url: 'edge://history/all' },
  downloads: { label: '下载内容', url: 'edge://downloads/all' },
  favorites: { label: '书签管理', url: 'edge://favorites/' },
  extensions: { label: '扩展管理', url: 'edge://extensions/' },
};

export async function openBrowserPage(name) {
  const target = BROWSER_PAGES[name];
  if (!target || typeof chrome === 'undefined' || !chrome.tabs?.update) return false;
  try {
    await chrome.tabs.update({ url: target.url });
    return true;
  } catch {
    return false;
  }
}
