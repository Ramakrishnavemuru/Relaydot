// Independent of the application bundle: failed chunks must not leave an empty root.
(() => {
  let failed = false;
  const recover = () => {
    if (failed) return;
    failed = true;
    const root = document.getElementById('root');
    if (!root) return;
    const mounted = document.documentElement.dataset.reactMounted === 'true';
    if (!mounted) root.replaceChildren();
    const panel = document.createElement('main');
    panel.className = 'startup-recovery';
    const heading = document.createElement('h1');
    heading.textContent = 'Relaydot could not finish loading';
    const text = document.createElement('p');
    text.textContent = 'Check your connection, then reload to get the latest version.';
    const reload = document.createElement('a');
    reload.href = location.pathname + location.search + location.hash;
    reload.textContent = 'Reload Relaydot';
    panel.append(heading, text, reload);
    if (mounted) {
      panel.setAttribute('role', 'alert');
      panel.className += ' startup-overlay';
      document.body.append(panel);
    } else root.append(panel);
  };
  window.addEventListener('vite:preloadError', event => { event.preventDefault(); recover(); });
  window.addEventListener('error', event => {
    if (event.target instanceof HTMLScriptElement || (event.target === window && !document.documentElement.dataset.appReady)) recover();
  }, true);
  setTimeout(() => { if (!document.documentElement.dataset.appReady) recover(); }, 20000);
})();
