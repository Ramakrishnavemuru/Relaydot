// Utility Helpers
const Utils = {
  // DOM Helpers
  $: (selector, parent = document) => parent.querySelector(selector),
  $$: (selector, parent = document) => Array.from(parent.querySelectorAll(selector)),

  // HTML escape to prevent XSS in chat messages
  escapeHTML: (str) => {
    if (!str) return '';
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
  },

  // Format timestamp for chat messages (e.g., 10:42 AM)
  formatMessageTime: (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  // Format date header for message separators
  formatDateHeader: (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },

  // Format last seen / presence
  formatLastSeen: (isOnline, lastSeenIso) => {
    if (isOnline) return 'Online';
    if (!lastSeenIso) return 'Offline';
    
    const date = new Date(lastSeenIso);
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Last seen just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `Last seen ${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return 'Last seen yesterday';
    return `Last seen on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  },

  // Format file size in bytes to KB/MB
  formatFileSize: (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  // Debounce function for live search and typing events
  debounce: (func, wait) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  // Toast Notification System
  showToast: (message, type = 'info', duration = 3500) => {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Icon based on type
    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ',
      warning: '⚠'
    };
    
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <span class="toast-message">${Utils.escapeHTML(message)}</span>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('show'));

    // Remove on click or timer
    const removeToast = () => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    };

    toast.addEventListener('click', removeToast);
    setTimeout(removeToast, duration);
  },

  // Modal Open / Close Helpers
  openModal: (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      const firstInput = modal.querySelector('input, textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 100);
    }
  },

  closeModal: (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  },

  // Format ticks for sent, delivered, read
  renderReceiptTicks: (status) => {
    if (status === 'READ') {
      return '<span class="status-ticks ticks-read" title="Read">✓✓</span>';
    } else if (status === 'DELIVERED') {
      return '<span class="status-ticks ticks-delivered" title="Delivered">✓✓</span>';
    }
    return '<span class="status-ticks ticks-sent" title="Sent">✓</span>';
  }
};
