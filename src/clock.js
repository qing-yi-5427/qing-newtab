/**
 * clock.js
 *
 * Renders the clock aligned to the minute boundary. Instead of a fixed
 * `setInterval`, it schedules a `setTimeout` to the next minute and then
 * re-schedules after each tick, so the displayed time is always correct to the
 * minute with no drift and minimal wake-ups. While the tab is hidden the timer
 * is fully cleared (zero CPU); on return it corrects immediately and restarts.
 */

const DAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** @type {number|null} */
let timer = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Paint the current time + date into the DOM. */
function update() {
  const now = new Date();
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  if (timeEl) {
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  if (dateEl) {
    dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${DAYS[now.getDay()]}`;
  }
}

/** Single self-rescheduling tick that lands exactly on each minute. */
function tick() {
  update();
  const now = new Date();
  // ms remaining until the next minute, plus a tiny safety buffer.
  const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
  timer = setTimeout(tick, delay);
}

function start() {
  if (timer) return;
  tick();
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Wire up the clock. Safe to call once on init. */
export function initClock() {
  start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
}
