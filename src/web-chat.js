/** Supported web-chat destinations and the short-lived hand-off queue. */

export const PENDING_WEB_PROMPT_KEY = 'nt_pending_web_prompt';
export const WEB_CHAT_PROVIDERS = {
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  kimi: { label: 'Kimi', url: 'https://www.kimi.com/' },
  mimo: { label: 'MiMo', url: 'https://aistudio.xiaomimimo.com/' },
  glm: { label: '智谱清言', url: 'https://chatglm.cn/' },
};

export function webChatProvider(key) {
  return WEB_CHAT_PROVIDERS[key] || WEB_CHAT_PROVIDERS.deepseek;
}

export async function openWebChat(providerKey, prompt) {
  const provider = webChatProvider(providerKey);
  const pending = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    provider: providerKey in WEB_CHAT_PROVIDERS ? providerKey : 'deepseek',
    prompt: String(prompt || '').trim(),
    createdAt: Date.now(),
  };
  if (!pending.prompt) return false;
  await chrome.storage.local.set({ [PENDING_WEB_PROMPT_KEY]: pending });
  window.open(provider.url, '_blank', 'noopener');
  return true;
}
