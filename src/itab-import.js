/** Helpers for importing an iTab backup without carrying over iTab widgets. */

function webUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

/** Return true for destinations intended for the user's private network. */
export function isLocalNetworkUrl(value) {
  const url = webUrl(value);
  if (!url) return false;
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === 'localhost' || hostname.endsWith('.local') || isPrivateIpv4(hostname);
}

function linkFromItem(item) {
  const url = webUrl(item?.url);
  if (!url) return null;
  let name = String(item?.name || '').trim();
  if (!name) name = new URL(url).hostname;
  let icon = null;
  try {
    const parsedIcon = new URL(String(item?.src || '').trim());
    if (parsedIcon.protocol === 'https:') icon = parsedIcon.href;
  } catch {
    // iTab widgets and invalid icon values are intentionally ignored.
  }
  return { name, url, icon };
}

/** Convert iTab's first two pages into this extension's data model. */
export function parseITabBackup(value) {
  if (!value || !Array.isArray(value.navConfig)) return null;
  const firstPage = value.navConfig[0]?.children;
  const secondPage = value.navConfig[1]?.children;
  if (!Array.isArray(firstPage) || !Array.isArray(secondPage)) return null;

  const shortcuts = firstPage
    .map(linkFromItem)
    .filter(Boolean)
    .map((item) => ({ ...item, size: '1x1' }));
  const localBookmarks = secondPage
    .map(linkFromItem)
    .filter((item) => item && isLocalNetworkUrl(item.url))
    .map(({ name, url }) => ({ name, url }));

  return { shortcuts, localBookmarks };
}

function sameUrl(left, right) {
  return webUrl(left) === webUrl(right);
}

/** Create or reuse 收藏夹栏/local and add missing iTab intranet links. */
export async function importLocalBookmarks(items, bookmarksApi = globalThis.chrome?.bookmarks) {
  if (!bookmarksApi || !Array.isArray(items) || !items.length) {
    return { created: 0, skipped: 0, total: 0 };
  }

  const tree = await bookmarksApi.getTree();
  const root = tree?.[0];
  const bar = root?.children?.find((node) => !node.url) || root;
  if (!bar?.id) throw new Error('找不到收藏夹栏');

  let children = Array.isArray(bar.children)
    ? bar.children
    : await bookmarksApi.getChildren(bar.id);
  let folder = children.find((node) => !node.url && String(node.title || '').toLowerCase() === 'local');
  if (!folder) folder = await bookmarksApi.create({ parentId: bar.id, title: 'local' });

  children = await bookmarksApi.getChildren(folder.id);
  const existingUrls = children.filter((node) => node.url).map((node) => node.url);
  let created = 0;
  let skipped = 0;
  for (const item of items) {
    if (existingUrls.some((url) => sameUrl(url, item.url))) {
      skipped += 1;
      continue;
    }
    await bookmarksApi.create({ parentId: folder.id, title: item.name, url: item.url });
    existingUrls.push(item.url);
    created += 1;
  }
  return { created, skipped, total: items.length };
}
