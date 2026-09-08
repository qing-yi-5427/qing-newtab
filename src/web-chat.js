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

export const pendingPromptKey = (tabId) => `${PENDING_WEB_PROMPT_KEY}_${tabId}`;

export async function openWebChat(providerKey, prompt) {
  const text = String(prompt || '').trim();
  if (!text) return false;
  const result = await chrome.runtime.sendMessage({
    type: 'open-web-chat', provider: providerKey, prompt: text,
  });
  if (!result?.ok) throw new Error(result?.error || '无法打开对话');
  return true;
}
