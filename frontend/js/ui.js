/* Shared presentation behavior. Business logic remains in the existing feature modules. */
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const getTheme = () => { try { return localStorage.getItem('relay-theme') || 'light'; } catch { return 'light'; } };
  const applyTheme = () => {
    const theme = getTheme();
    document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
    document.querySelectorAll('[data-theme-choice]').forEach(el => {
      el.classList.toggle('active', el.dataset.themeChoice === theme);
      el.setAttribute('aria-pressed', String(el.dataset.themeChoice === theme));
    });
  };
  const setTheme = theme => { try { localStorage.setItem('relay-theme', theme); } catch {} applyTheme(); };
  const node = ([tag, attrs, children = []]) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([key, val]) => el.setAttribute(key, val));
    children.forEach(child => el.appendChild(node(child)));
    return el;
  };
  const icon = name => {
    const data = window.RelayIcons?.[name] || window.RelayIcons?.message;
    if (!data) return '';
    const el = node(data); el.setAttribute('aria-hidden', 'true'); el.classList.add('ui-icon');
    el.setAttribute('stroke-width', '1.7'); return el.outerHTML;
  };
  const decorate = (root = document) => {
    root.querySelectorAll('[data-icon]:not([data-icon-ready])').forEach(el => {
      if (!window.RelayIcons) return;
      el.innerHTML = icon(el.dataset.icon); el.dataset.iconReady = 'true';
    });
    root.querySelectorAll('button[title]:not([aria-label])').forEach(el => el.setAttribute('aria-label', el.title));
    root.querySelectorAll('.modal-close:not([aria-label])').forEach(el => el.setAttribute('aria-label', 'Close dialog'));
    root.querySelectorAll('.form-group').forEach(group => {
      const label = group.querySelector('label'); const input = group.querySelector('input, textarea, select');
      if (label && input?.id && !label.htmlFor) label.htmlFor = input.id;
    });
  };
  const avatar = name => {
    const initial = String(name || '?').trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase().replace(/[<>&"']/g, '');
    const palette = [['#eee9df','#79664d'],['#e4e8fa','#555f96'],['#deeee8','#397a66'],['#f4e3e9','#a25d79']];
    const [bg,fg] = palette[Array.from(String(name || '')).reduce((n,c)=>n+c.charCodeAt(0),0)%palette.length];
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="28" fill="${bg}"/><text x="40" y="43" dy=".3em" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="600" fill="${fg}">${initial}</text></svg>`);
  };
  window.AppUI = { getTheme, setTheme, icon, decorate, avatar };
  applyTheme(); system.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    decorate();
    let scheduled = false;
    new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; decorate(); }); } }).observe(document.body, {childList:true,subtree:true});
    document.addEventListener('click', e => {
      if (e.target.closest('[data-theme-toggle]')) setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      const choice = e.target.closest('[data-theme-choice]'); if (choice) setTheme(choice.dataset.themeChoice);
      const modal = e.target.closest('.modal-overlay');
      if (e.target === modal) modal.classList.remove('active');
    });
    document.querySelectorAll('.modal-overlay').forEach((modal, i) => {
      const title = modal.querySelector('.modal-title');
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal','true');
      if (title) { title.id ||= `dialog-title-${i}`; modal.setAttribute('aria-labelledby',title.id); }
      let previous;
      new MutationObserver(() => {
        if (modal.classList.contains('active')) {
          previous = document.activeElement;
          const focusable = modal.querySelector('input:not([type=hidden]), textarea, button');
          setTimeout(() => focusable?.focus(), 50);
        } else if (previous?.isConnected) previous.focus();
      }).observe(modal, {attributes:true,attributeFilter:['class']});
    });
    document.addEventListener('keydown', e => {
      const modal = [...document.querySelectorAll('.modal-overlay.active')].at(-1);
      if (!modal) return;
      if (e.key === 'Escape') { modal.classList.remove('active'); return; }
      if (e.key === 'Tab') {
        const items = [...modal.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
        if (!items.length) return;
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('error', e => {
      if (e.target.tagName === 'IMG' && !e.target.src.startsWith('data:')) e.target.src = avatar(e.target.alt || 'User');
    }, true);
  });
})();
