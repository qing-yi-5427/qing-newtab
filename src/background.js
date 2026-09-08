/** Serialize shared mutations and bind each web prompt to its destination tab. */
import { WEB_CHAT_PROVIDERS, pendingPromptKey } from './web-chat.js';

export const MAX_PENDING_AGE = 30 * 60 * 1000;
let queue = Promise.resolve();

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id
    && sender.url?.startsWith(chrome.runtime.getURL(''));
}

function senderProvider(sender) {
  try {
    const host = new URL(sender.url).hostname;
    if (host === 'chat.deepseek.com') return 'deepseek';
    if (['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn'].includes(host)) return 'kimi';
    if (host === 'aistudio.xiaomimimo.com') return 'mimo';
    if (host === 'chatglm.cn' || host.endsWith('.chatglm.cn')) return 'glm';
  } catch { /* Invalid senders cannot receive prompts. */ }
  return '';
}

export async function handleMessage(message, sender) {
  if (message.type === 'save-settings') {
    if (!isExtensionPage(sender)) throw new Error('无权修改设置');
    const current = (await chrome.storage.local.get('nt_settings')).nt_settings || {};
    const settings = { ...current, ...message.patch };
    await chrome.storage.local.set({ nt_settings: settings });
    return { ok: true, settings };
  }
  if (message.type === 'open-web-chat') {
    if (!isExtensionPage(sender)) throw new Error('无权打开对话');
    const provider = Object.hasOwn(WEB_CHAT_PROVIDERS, message.provider) ? message.provider : 'deepseek';
    const prompt = String(message.prompt || '').trim();
    if (!prompt) throw new Error('消息不能为空');
    // Store before navigating so document_idle cannot race the hand-off write.
    const tab = await chrome.tabs.create({ url: 'about:blank' });
    const key = pendingPromptKey(tab.id);
    try {
      await chrome.storage.local.set({ [key]: {
        id: crypto.randomUUID(), provider, prompt, createdAt: Date.now(), status: 'pending',
      } });
      await chrome.tabs.update(tab.id, { url: WEB_CHAT_PROVIDERS[provider].url });
    } catch (error) {
      await chrome.storage.local.remove(key);
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
    return { ok: true };
  }
  if (!['peek-web-prompt', 'claim-web-prompt', 'complete-web-prompt'].includes(message.type)) return;
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) {
    return { ok: false };
  }
  const key = pendingPromptKey(sender.tab.id);
  const pending = (await chrome.storage.local.get(key))[key];
  if (!pending || pending.provider !== senderProvider(sender)) return { ok: true, pending: null };
  if (Date.now() - pending.createdAt > MAX_PENDING_AGE) {
    await chrome.storage.local.remove(key);
    return { ok: true, pending: null };
  }
  if (message.type === 'peek-web-prompt') {
    return { ok: true, pending: pending.status === 'pending' ? pending : null };
  }
  if (pending.id !== message.id) return { ok: false };
  if (message.type === 'claim-web-prompt') {
    if (pending.status !== 'pending') return { ok: true, pending: null };
    await chrome.storage.local.set({ [key]: { ...pending, status: 'claimed' } });
    return { ok: true, pending };
  }
  await chrome.storage.local.remove(key);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const task = queue.then(() => handleMessage(message, sender));
  queue = task.catch(() => {});
  task.then(respond, (error) => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const task = queue.then(() => chrome.storage.local.remove(pendingPromptKey(tabId)));
  queue = task.catch(() => {});
});
