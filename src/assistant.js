/** Compact OpenAI-compatible chat client for the new-tab page. */

import * as storage from './storage.js';
import * as state from './state.js';
import { openSettings } from './settings.js';
import { openWebChat, WEB_CHAT_PROVIDERS, webChatProvider } from './web-chat.js';

let messages = [];
let sending = false;
const MAX_MESSAGES = 40;

function addMessage(message) {
  messages.push(message);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
}

export function chatCompletionsUrl(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const clean = parsed.href.replace(/\/$/, '');
    return /\/chat\/completions$/i.test(clean) ? clean : `${clean}/chat/completions`;
  } catch {
    return '';
  }
}

function contentFromResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('').trim();
  return '';
}

async function requestOriginPermission(endpoint) {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return true;
  const url = new URL(endpoint);
  const origin = `${url.origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

function renderMessages(container, clearButton) {
  container.innerHTML = '';
  messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = `assistant-message ${message.role}`;
    const label = document.createElement('span');
    label.textContent = message.role === 'user' ? '你' : '助手';
    const content = document.createElement('p');
    content.textContent = message.content;
    item.append(label, content);
    container.appendChild(item);
  });
  const hasMessages = messages.length > 0;
  container.classList.toggle('hidden', !hasMessages);
  clearButton.classList.toggle('hidden', !hasMessages);
  if (hasMessages) container.scrollTop = container.scrollHeight;
}

export function initAssistant() {
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('assistant-input');
  const send = document.getElementById('assistant-send');
  const status = document.getElementById('assistant-status');
  const container = document.getElementById('assistant-messages');
  const clearButton = document.getElementById('assistant-clear');
  const webLink = document.getElementById('assistant-web');
  const title = document.getElementById('assistant-title');
  const providerSwitch = document.getElementById('assistant-provider-switch');
  const providerMenu = document.getElementById('assistant-provider-menu');

  function closeProviderMenu({ restoreFocus = false } = {}) {
    providerMenu.classList.add('hidden');
    providerSwitch.setAttribute('aria-expanded', 'false');
    if (restoreFocus) providerSwitch.focus();
  }

  async function syncWebLink() {
    const settings = await storage.getSettings();
    providerMenu.querySelectorAll('.assistant-provider-option').forEach((option) => {
      const active = option.dataset.provider === settings.llmProvider;
      option.classList.toggle('active', active);
      option.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (settings.llmProvider !== 'api') {
      const provider = webChatProvider(settings.llmProvider);
      title.textContent = provider.label;
      webLink.href = provider.url;
      webLink.textContent = `打开 ${provider.label}`;
      webLink.classList.remove('hidden');
      return;
    }
    title.textContent = '自定义接口';
    try {
      const url = new URL(settings.llmWebUrl || '');
      const valid = ['http:', 'https:'].includes(url.protocol);
      webLink.href = valid ? url.href : '';
      webLink.classList.toggle('hidden', !valid);
    } catch {
      webLink.classList.add('hidden');
    }
  }

  providerSwitch.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = providerMenu.classList.toggle('hidden') === false;
    providerSwitch.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  providerMenu.querySelectorAll('.assistant-provider-option').forEach((option) => {
    option.addEventListener('click', async () => {
      const settings = await storage.getSettings();
      settings.llmProvider = option.dataset.provider;
      await storage.saveSettings(settings);
      closeProviderMenu();
      state.notifySettingsChanged(['llmProvider']);
      input.focus();
    });
  });
  providerMenu.addEventListener('keydown', (event) => {
    const options = Array.from(providerMenu.querySelectorAll('.assistant-provider-option'));
    const current = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      options[(current + direction + options.length) % options.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeProviderMenu({ restoreFocus: true });
    }
  });
  providerSwitch.addEventListener('keydown', (event) => {
    if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    providerMenu.classList.remove('hidden');
    providerSwitch.setAttribute('aria-expanded', 'true');
    providerMenu.querySelector('.assistant-provider-option')?.focus();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#assistant-provider-wrap')) closeProviderMenu();
  });

  async function submit() {
    if (sending) return;
    const prompt = input.value.trim();
    if (!prompt) return;
    const settings = await storage.getSettings();
    if (settings.llmProvider !== 'api' && Object.hasOwn(WEB_CHAT_PROVIDERS, settings.llmProvider)) {
      const provider = webChatProvider(settings.llmProvider);
      sending = true;
      send.disabled = true;
      status.textContent = `正在转到 ${provider.label} 并自动发送…`;
      try {
        await openWebChat(settings.llmProvider, prompt);
        input.value = '';
        input.style.height = '';
        status.textContent = '';
      } catch {
        status.textContent = `无法打开 ${provider.label}，请检查浏览器权限。`;
      } finally {
        sending = false;
        send.disabled = false;
      }
      return;
    }
    const endpoint = chatCompletionsUrl(settings.llmBaseUrl);
    if (!endpoint || !settings.llmApiKey || !settings.llmModel) {
      status.textContent = '请先在设置中填写接口地址、密钥和模型。';
      openSettings();
      return;
    }

    sending = true;
    send.disabled = true;
    status.textContent = '正在思考…';
    addMessage({ role: 'user', content: prompt });
    input.value = '';
    input.style.height = '';
    renderMessages(container, clearButton);

    try {
      if (!(await requestOriginPermission(endpoint))) throw new Error('未授予接口访问权限');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.llmApiKey}`,
        },
        body: JSON.stringify({
          model: settings.llmModel,
          messages: messages.slice(-12),
          stream: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `请求失败（${response.status}）`);
      const answer = contentFromResponse(data);
      if (!answer) throw new Error('接口没有返回可显示的内容');
      addMessage({ role: 'assistant', content: answer });
      status.textContent = '';
    } catch (error) {
      status.textContent = error?.message || '对话请求失败，请检查设置与网络。';
    } finally {
      sending = false;
      send.disabled = false;
      renderMessages(container, clearButton);
      input.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  clearButton.addEventListener('click', () => {
    messages = [];
    status.textContent = '';
    renderMessages(container, clearButton);
  });
  state.subscribe((changedKeys) => {
    if (!changedKeys || changedKeys.includes('llmProvider') || changedKeys.includes('llmWebUrl')) syncWebLink();
  });
  syncWebLink();
}
