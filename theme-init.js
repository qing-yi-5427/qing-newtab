/** Apply the cached explicit theme before CSS paints dynamic content. */
try {
  const theme = localStorage.getItem('nt_theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch {
  // Storage can be unavailable in restricted browser contexts.
}
