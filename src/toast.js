/** Small non-blocking status message shared by page-level actions. */

let toastElement = null;
let hideTimer = null;

export function initToast() {
  toastElement = document.getElementById('page-toast');
}

export function showToast(message, isError = false) {
  if (!toastElement) return;
  clearTimeout(hideTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle('error', isError);
  toastElement.classList.remove('hidden');
  hideTimer = setTimeout(() => toastElement?.classList.add('hidden'), 2600);
}
