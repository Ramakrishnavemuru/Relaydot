/* Shared presentation primitives; API and feature modules own application data. */
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const desktop = window.matchMedia('(min-width: 1200px)');
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const getTheme = () => { try { return localStorage.getItem('relay-theme') || 'system'; } catch { return 'system'; } };
  const applyTheme = () => {
    const theme = getTheme();
    document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
    document.querySelectorAll('[data-theme-choice]').forEach(el => {
      el.classList.toggle('active', el.dataset.themeChoice === theme);
      el.setAttribute('aria-pressed', String(el.dataset.themeChoice === theme));
    });
    document.querySelectorAll('[data-theme-toggle] [data-icon]').forEach(el => {
      el.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun');
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
    return el.outerHTML;
  };
  const avatar = name => {
    const initial = String(name || '?').trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase().replace(/[<>&"']/g, '');
    const palette = [['#eee9df','#79664d'],['#e4e8fa','#555f96'],['#deeee8','#397a66'],['#f4e3e9','#a25d79'],['#e9e4f5','#79609a']];
    const [bg,fg] = palette[Array.from(String(name || '')).reduce((n,c)=>n+c.charCodeAt(0),0)%palette.length];
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="28" fill="${bg}"/><text x="40" y="43" dy=".3em" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="600" fill="${fg}">${initial}</text></svg>`);
  };
  const avatarUrl = (url,name) => !url || /^https:\/\/api\.dicebear\.com\/[^/]+\/initials\//.test(url) ? avatar(name) : API.resolveUrl(url);
  const linkify = text => {
    const wrapper = document.createElement('span');
    let end = 0;
    for (const match of String(text || '').matchAll(/https?:\/\/[^\s<>]+/gi)) {
      const url = match[0].replace(/[.,!?;:)]+$/, '');
      wrapper.append(document.createTextNode(text.slice(end, match.index)));
      const a = document.createElement('a'); a.href = url; a.textContent = url;
      a.target = '_blank'; a.rel = 'noopener noreferrer'; wrapper.append(a);
      end = match.index + url.length;
    }
    wrapper.append(document.createTextNode(String(text || '').slice(end)));
    return wrapper.innerHTML;
  };
  const highlight = (text, query) => {
    const el = document.createElement('span');
    const value = String(text || ''); const q = String(query || '').toLowerCase();
    let start = 0, at;
    if (!q) { el.textContent = value; return el.innerHTML; }
    while ((at = value.toLowerCase().indexOf(q, start)) !== -1) {
      el.append(document.createTextNode(value.slice(start, at)));
      const mark = document.createElement('mark'); mark.textContent = value.slice(at, at + q.length); el.append(mark); start = at + q.length;
    }
    el.append(document.createTextNode(value.slice(start))); return el.innerHTML;
  };
  const focusable = root => [...root.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]'));
  const overlays = '.modal-overlay, .call-modal-overlay, .incoming-call-overlay, .story-viewer-overlay';
  const isPanel = el => el.classList.contains('details-panel') && desktop.matches;
  const syncInert = () => {
    const blocking = [...document.querySelectorAll(overlays)].some(el => el.classList.contains('active') && !isPanel(el));
    document.querySelectorAll('.chat-app-container, .auth-shell, .account-main, .account-topbar').forEach(el => el.inert = blocking);
  };
  const decorate = (root = document) => {
    root.querySelectorAll('[data-icon]:not([data-icon-ready])').forEach(el => {
      if (!window.RelayIcons) return;
      el.innerHTML = icon(el.dataset.icon); el.dataset.iconReady = 'true';
    });
    root.querySelectorAll('img:not([alt])').forEach(el => el.alt = '');
    root.querySelectorAll('button[title]:not([aria-label])').forEach(el => el.setAttribute('aria-label', el.title));
    root.querySelectorAll('.modal-close:not([aria-label])').forEach(el => { if (!el.textContent.trim()) el.setAttribute('aria-label', 'Close dialog'); });
    root.querySelectorAll('.form-group').forEach(group => {
      const label = group.querySelector('label'); const input = group.querySelector('input, textarea, select');
      if (label && input?.id && !label.htmlFor) label.htmlFor = input.id;
    });
    root.querySelectorAll('.switch-group').forEach(group => {
      const label = group.querySelector('.switch-title'); const input = group.querySelector('input');
      if (input && label && !input.hasAttribute('aria-label')) input.setAttribute('aria-label',label.textContent);
    });
    [...root.querySelectorAll(overlays)].filter(el => !el.dataset.dialogReady).forEach((modal, i) => {
      modal.dataset.dialogReady = 'true';
      const title = modal.querySelector('.modal-title');
      modal.setAttribute('role', isPanel(modal) ? 'complementary' : 'dialog');
      if (!isPanel(modal)) modal.setAttribute('aria-modal','true');
      if (!title && modal.id === 'incoming-call-overlay') modal.setAttribute('aria-labelledby','incoming-caller-name');
      if (!title && modal.id === 'call-modal-overlay') modal.setAttribute('aria-labelledby','call-peer-name');
      if (!title && modal.id === 'story-viewer-overlay') modal.setAttribute('aria-label','Story viewer');
      if (title) { title.id ||= `dialog-title-${modal.id || i}`; modal.setAttribute('aria-labelledby',title.id); }
      let previous, open = false;
      new MutationObserver(() => {
        const next = modal.classList.contains('active'); if (next === open) return; open = next;
        syncInert();
        if (open) {
          previous = document.activeElement;
          requestAnimationFrame(() => { if (open && !modal.contains(document.activeElement)) focusable(modal)[0]?.focus(); });
        } else {
          modal.dispatchEvent(new Event('dialogclose'));
          if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
        }
      }).observe(modal, {attributes:true,attributeFilter:['class']});
    });
  };
  const confirm = ({title, description, action = 'Confirm', danger = true, field}) => new Promise(resolve => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const card = document.createElement('div'); card.className = 'modal-card confirmation-card';
    card.innerHTML = `<div class="modal-header"><h2 class="modal-title"></h2><button class="icon-btn modal-close" aria-label="Cancel">${icon('x')}</button></div><div class="modal-body"><p class="confirmation-description"></p></div><div class="modal-footer"><button class="btn btn-secondary confirm-cancel">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-action"></button></div>`;
    card.querySelector('h2').textContent = title; card.querySelector('p').textContent = description; card.querySelector('.confirm-action').textContent = action;
    let input;
    if (field) {
      const group = document.createElement('div'); group.className = 'form-group';
      const label = document.createElement('label'); label.className = 'form-label'; label.textContent = field.label;
      input = document.createElement('input'); input.className = 'form-input'; input.type = field.type || 'text'; input.required = true; input.autocomplete = 'off';
      input.id = `dialog-input-${crypto.randomUUID()}`; label.htmlFor = input.id; group.append(label,input); card.querySelector('.modal-body').append(group);
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); card.querySelector('.confirm-action').click(); } };
    }
    overlay.append(card); document.body.append(overlay); decorate();
    let settled = false;
    const finish = result => { if (settled) return; settled = true; overlay.classList.remove('active'); resolve(result); setTimeout(() => overlay.remove(), 200); };
    card.querySelector('.confirm-action').onclick = () => { if (input && !input.reportValidity()) return; finish(input ? input.value : true); };
    card.querySelector('.confirm-cancel').onclick = () => finish(false);
    overlay.addEventListener('dialogclose', () => finish(false));
    requestAnimationFrame(() => overlay.classList.add('active'));
  });
  let menu;
  const closeMenu = () => { if (menu) { const trigger = menu.trigger; menu.remove(); menu = null; trigger?.setAttribute('aria-expanded','false'); } };
  const showMenu = (trigger, actions, captionText = 'Chat preferences stay on this browser') => {
    closeMenu(); menu = document.createElement('div'); menu.className = 'context-menu'; menu.setAttribute('role','menu'); menu.trigger = trigger;
    trigger.setAttribute('aria-expanded','true');
    actions.forEach(({label, icon: name, run, danger}) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role','menuitem');
      button.className = danger ? 'menu-danger' : ''; button.innerHTML = icon(name); const text = document.createElement('span'); text.textContent = label; button.append(text);
      button.onclick = () => { closeMenu(); trigger.focus(); Promise.resolve().then(run).catch(() => typeof Utils !== 'undefined' && Utils.showToast('Something went wrong. Please try again.', 'error')); };
      menu.append(button);
    });
    const caption = document.createElement('small'); caption.textContent = captionText; menu.append(caption);
    document.body.append(menu);
    const rect = trigger.getBoundingClientRect(); const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - box.width, innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - box.height - 8))}px`;
    focusable(menu)[0]?.focus();
  };
  window.AppUI = {getTheme, setTheme, icon, decorate, avatar, avatarUrl, linkify, highlight, read, write, confirm, requestInput: options => confirm({...options,field:{label:options.label,type:options.type}}), showMenu, closeMenu};
  applyTheme(); system.addEventListener('change', applyTheme);
  desktop.addEventListener('change', () => {
    document.querySelectorAll('.details-panel').forEach(el => { el.setAttribute('role', desktop.matches ? 'complementary' : 'dialog'); if (desktop.matches) el.removeAttribute('aria-modal'); else el.setAttribute('aria-modal','true'); }); syncInert();
  });
  document.addEventListener('DOMContentLoaded', () => {
    decorate(); applyTheme();
    let scheduled = false;
    new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; decorate(); }); } }).observe(document.body, {childList:true,subtree:true});
    document.addEventListener('click', e => {
      if (menu && !menu.contains(e.target) && !menu.trigger.contains(e.target)) closeMenu();
      if (e.target.closest('[data-theme-toggle]')) setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      const choice = e.target.closest('[data-theme-choice]'); if (choice) setTheme(choice.dataset.themeChoice);
      const modal = e.target.closest('.modal-overlay');
      if (e.target === modal || e.target.closest('.modal-close')) modal?.classList.remove('active');
    });
    document.addEventListener('keydown', e => {
      if (menu && ['Escape','ArrowDown','ArrowUp','Home','End','Tab'].includes(e.key)) {
        const items = focusable(menu); const index = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { const trigger = menu.trigger; closeMenu(); trigger.focus(); }
        else if (e.key === 'Tab') closeMenu();
        else { e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
        return;
      }
      const modal = [...document.querySelectorAll(overlays)].filter(el => el.classList.contains('active')).at(-1);
      if (!modal) return;
      if (e.key === 'Escape') {
        if (modal.id === 'story-viewer-overlay') modal.querySelector('#btn-close-story-viewer')?.click();
        else if (modal.id === 'call-modal-overlay') modal.querySelector('#btn-call-end')?.focus();
        else if (modal.id === 'incoming-call-overlay') modal.querySelector('#btn-decline-call')?.focus();
        else modal.classList.remove('active');
        return;
      }
      if (e.key === 'Tab' && !isPanel(modal)) {
        const items = focusable(modal); if (!items.length) return;
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('error', e => {
      if (e.target.tagName === 'IMG' && /avatar/i.test(e.target.className + e.target.id) && !e.target.src.startsWith('data:')) e.target.src = avatar(e.target.alt || 'User');
    }, true);
    document.querySelectorAll('.settings-nav').forEach(nav => {
      nav.setAttribute('role','tablist'); nav.setAttribute('aria-label','Settings categories');
      const tabs = [...nav.querySelectorAll('.settings-tab-btn')];
      const sync = () => tabs.forEach(tab => {
        tab.setAttribute('role','tab'); tab.setAttribute('aria-selected',String(tab.classList.contains('active')));
        tab.tabIndex = tab.classList.contains('active') ? 0 : -1; tab.id ||= `settings-tab-${tab.dataset.tab}`;
        const pane = document.getElementById(`pane-${tab.dataset.tab}`);
        if (pane) { tab.setAttribute('aria-controls',pane.id); pane.setAttribute('role','tabpanel'); pane.setAttribute('aria-labelledby',tab.id); }
      });
      sync(); nav.addEventListener('click', () => queueMicrotask(sync));
      // Standalone settings implements its own roving tabs.
      if (!document.body.classList.contains('account-page')) nav.addEventListener('keydown', e => {
        const at = tabs.indexOf(document.activeElement); if (at < 0) return;
        const offset = ['ArrowDown','ArrowRight'].includes(e.key) ? 1 : ['ArrowUp','ArrowLeft'].includes(e.key) ? -1 : 0;
        if (!offset) return; e.preventDefault(); const next = tabs[(at + offset + tabs.length) % tabs.length]; next.click(); next.focus();
      });
    });
  });
})();
