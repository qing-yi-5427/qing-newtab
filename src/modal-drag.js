/** Move a dialog by its header without allowing its controls off screen. */
export function initModalDrag(modal, panel, handle) {
  let drag = null;
  const inset = 8;

  function place(left, top) {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(inset, window.innerWidth - rect.width - inset);
    const maxTop = Math.max(inset, window.innerHeight - rect.height - inset);
    panel.style.left = `${Math.max(inset, Math.min(maxLeft, left))}px`;
    panel.style.top = `${Math.max(inset, Math.min(maxTop, top))}px`;
  }
  function stop() {
    const pointerId = drag?.pointerId;
    drag = null;
    panel.classList.remove('is-dragging');
    if (pointerId !== undefined && handle.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
  }
  function reset() {
    stop();
    // Recentring should not replay the entrance scale animation.
    panel.style.animation = 'none';
    panel.classList.remove('is-positioned');
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
  }
  function isControl(target) {
    return !!target.closest('button, a, input, select, textarea');
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false || isControl(event.target)) return;
    event.preventDefault();
    // Finish the entrance animation before measuring the panel's position.
    panel.getAnimations?.().forEach((animation) => animation.finish());
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    panel.classList.add('is-positioned', 'is-dragging');
    place(rect.left, rect.top);
    handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  handle.addEventListener('dblclick', (event) => { if (!isControl(event.target)) reset(); });
  window.addEventListener('blur', stop);
  window.addEventListener('resize', () => {
    stop();
    if (modal.classList.contains('hidden') || !panel.classList.contains('is-positioned')) return;
    const rect = panel.getBoundingClientRect();
    place(rect.left, rect.top);
  });
  return reset;
}
