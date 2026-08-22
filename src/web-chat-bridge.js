/** Runs inside supported AI websites and submits one queued prompt. */

import { PENDING_WEB_PROMPT_KEY, WEB_CHAT_PROVIDERS } from './web-chat.js';

const MAX_PENDING_AGE = 30 * 60 * 1000;
const COMPOSER_SELECTORS = [
  'textarea:not([disabled])',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  '[role="textbox"]',
];

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 80 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden';
}

function providerForHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'chat.deepseek.com') return 'deepseek';
  if (host === 'www.kimi.com' || host === 'kimi.com' || host === 'kimi.moonshot.cn') return 'kimi';
  if (host === 'aistudio.xiaomimimo.com') return 'mimo';
  if (host === 'chatglm.cn' || host.endsWith('.chatglm.cn')) return 'glm';
  return '';
}

export function findComposer(root = document) {
  for (const selector of COMPOSER_SELECTORS) {
    const candidates = [...root.querySelectorAll(selector)].filter(isVisible);
    if (candidates.length) return candidates.at(-1);
  }
  return null;
}

export function setComposerValue(composer, prompt) {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const prototype = composer instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(composer, prompt);
    else composer.value = prompt;
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = typeof document.execCommand === 'function'
      && document.execCommand('insertText', false, prompt);
    if (!inserted) composer.textContent = prompt;
  }
  composer.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: prompt,
  }));
  composer.dispatchEvent(new Event('change', { bubbles: true }));
}

export function findSendButton(composer) {
  const labelled = [
    '[aria-label*="发送"]:not([disabled])',
    '[aria-label*="Send" i]:not([disabled])',
    '[title*="发送"]:not([disabled])',
    '[title*="Send" i]:not([disabled])',
    '[data-testid*="send" i]:not([disabled])',
    'button[type="submit"]:not([disabled])',
  ];
  for (let node = composer.parentElement, depth = 0; node && depth < 7; node = node.parentElement, depth += 1) {
    for (const selector of labelled) {
      const candidate = [...node.querySelectorAll(selector)].filter(isVisible).at(-1);
      if (candidate) return candidate;
    }
  }

  const inputRect = composer.getBoundingClientRect();
  let scope = composer.parentElement;
  for (let depth = 0; scope && depth < 6; scope = scope.parentElement, depth += 1) {
    const candidates = [...scope.querySelectorAll('button:not([disabled]),[role="button"]')]
      .filter(isVisible)
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => (
        rect.left >= inputRect.left + inputRect.width * 0.55
        && rect.top < inputRect.bottom + 28
        && rect.bottom > inputRect.top - 28
      ))
      .sort((left, right) => right.rect.right - left.rect.right);
    if (candidates.length) return candidates[0].button;
  }
  return null;
}

function pressEnter(composer) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    composer.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true,
    }));
  }
}

function waitForComposer(timeout = MAX_PENDING_AGE) {
  const immediate = findComposer();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const composer = findComposer();
      if (!composer) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(composer);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

async function deliverPendingPrompt() {
  const provider = providerForHost(location.hostname);
  if (!provider || !WEB_CHAT_PROVIDERS[provider]) return;
  const stored = await chrome.storage.local.get(PENDING_WEB_PROMPT_KEY);
  const pending = stored[PENDING_WEB_PROMPT_KEY];
  if (!pending || pending.provider !== provider) return;
  if (!pending.prompt || Date.now() - Number(pending.createdAt || 0) > MAX_PENDING_AGE) {
    await chrome.storage.local.remove(PENDING_WEB_PROMPT_KEY);
    return;
  }

  const composer = await waitForComposer();
  if (!composer) return;
  setComposerValue(composer, pending.prompt);
  await new Promise((resolve) => setTimeout(resolve, 450));
  const sendButton = findSendButton(composer);
  await chrome.storage.local.remove(PENDING_WEB_PROMPT_KEY);
  if (sendButton) sendButton.click();
  else pressEnter(composer);
}

if (typeof chrome !== 'undefined' && chrome.storage?.local) deliverPendingPrompt();
