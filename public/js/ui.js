// Shared UI helpers — formatting, escaping, toasts, modals, product cards, API requests.
import { supabase } from '/js/init.js';

export function formatMoney(cents, currency = 'PHP') {
  const safeCents = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const cur = (currency || 'PHP').toUpperCase();
  const units = safeCents / 100;
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(units);
  } catch (_) {
    return '₱' + units.toFixed(2);
  }
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return iso;
  }
}

export function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (_) {
    return iso;
  }
}

export function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeAttr(text) {
  return escapeHtml(text);
}

export function renderStars(rating, showCount = false) {
  const numeric = Number(rating || 0);
  const filledCount = Math.max(0, Math.min(5, Math.round(numeric)));
  let html = '<span class="stars-row" aria-label="' + numeric.toFixed(1) + ' out of 5 stars">';
  for (let i = 1; i <= 5; i++) {
    html += '<span class="star' + (i <= filledCount ? ' filled' : '') + '" aria-hidden="true">' + (i <= filledCount ? '&#9733;' : '&#9734;') + '</span>';
  }
  html += '</span>';
  if (showCount) {
    html += '<span class="rating-count">(' + numeric.toFixed(1) + ')</span>';
  }
  return html;
}

let toastTimer = null;
export function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<span class="toast-message">' + escapeHtml(message) + '</span>';
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 4000);
}

export function showError(form, fieldId, message) {
  clearErrors(form);
  const field = document.getElementById(fieldId);
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    const hint = document.createElement('p');
    hint.className = 'form-error';
    hint.textContent = message;
    field.parentNode.insertBefore(hint, field.nextSibling);
    field.focus();
  } else {
    showToast(message, 'error');
  }
}

export function clearErrors(form) {
  if (!form) return;
  form.querySelectorAll('[aria-invalid="true"]').forEach(f => f.removeAttribute('aria-invalid'));
  form.querySelectorAll('.form-error').forEach(e => e.remove());
}

export function openModal(el) {
  if (!el) return;
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (!el._escBound) {
    el._escBound = true;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal(el);
    });
  }
}

export function closeModal(el) {
  if (!el) return;
  el.style.display = 'none';
  document.body.style.overflow = '';
}

export function confirmDialog({
  title = 'Please confirm',
  message = 'Are you sure you want to continue?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="modal" style="max-width: 440px;">
        <div class="modal-header">
          <h3 style="margin:0; font-size:1.25rem;">${escapeHtml(title)}</h3>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin:0; line-height:1.6;">${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const cleanup = (result) => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      backdrop.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('.modal-close').addEventListener('click', () => cleanup(false));
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => cleanup(false));
    backdrop.querySelector('[data-confirm]').addEventListener('click', () => cleanup(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(false);
    });
    document.body.style.overflow = 'hidden';
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-confirm]').focus();
  });
}

export async function apiFetch(path, options = {}) {
  const { method = 'GET', body, headers = {}, auth = true } = options;
  const reqHeaders = { ...headers };
  if (body !== undefined && !(body instanceof FormData) && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  if (auth && supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      reqHeaders.Authorization = 'Bearer ' + session.access_token;
    }
  }
  const response = await fetch(path, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? (body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error || payload.message || 'Request failed (' + response.status + ')',
      data: payload
    };
  }
  return { ok: true, status: response.status, data: payload, error: null };
}

export async function checkDbStatus() {
  const banner = document.getElementById('setup-banner');
  if (!banner) return;
  try {
    const cachedAt = Number(sessionStorage.getItem('ym_db_ok_at') || 0);
    if (cachedAt && (Date.now() - cachedAt) < 60000) return;
  } catch (_) {}

  try {
    const res = await fetch('/api/db/status');
    const status = await res.json();
    const missing = Object.entries(status).filter(([, v]) => !v.exists).map(([k]) => k);
    if (missing.length) {
      banner.innerHTML = '<strong>Setup needed:</strong> Database tables not found: ' +
        escapeHtml(missing.join(', ')) +
        '. Run <code>schema.sql</code> in your Supabase SQL Editor to enable the marketplace.';
      banner.style.display = 'block';
    } else {
      try { sessionStorage.setItem('ym_db_ok_at', String(Date.now())); } catch (_) {}
    }
  } catch (_) {}
}

export function formatAddress(addr) {
  if (!addr || typeof addr !== 'object') return 'No shipping address provided.';
  const parts = [];
  if (addr.name) parts.push(addr.name);
  if (addr.phone) parts.push(addr.phone);
  if (addr.email) parts.push(addr.email);
  const lineParts = [addr.address, addr.barangay].filter(Boolean).join(', ');
  if (lineParts) parts.push(lineParts);
  const cityLine = [addr.city, addr.province, addr.postal].filter(Boolean).join(', ');
  if (cityLine) parts.push(cityLine);
  if (addr.country) parts.push(addr.country);
  return parts.join('\n') || 'No shipping address provided.';
}

export function categoryIconSvg(slug = '') {
  const s = String(slug).toLowerCase();
  if (s.includes('ceramic') || s.includes('pottery')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8l-1 4c2.5 1.5 3.5 4.2 3 7.5-.4 2.5-2.3 4.5-6 4.5s-5.6-2-6-4.5C5.5 12.2 6.5 9.5 9 8L8 4z"/><path d="M9 8h6"/></svg>';
  }
  if (s.includes('textile') || s.includes('fiber')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 7.5c3.5 1 6.5 4 7.5 7.5"/><path d="M5.5 13c3.5-.5 7.5-2.5 10-5.5"/><path d="M16 19l4-4"/></svg>';
  }
  if (s.includes('jewelry')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 12L2 9l4-6z"/><path d="M2 9h20"/><path d="M12 21L8 9l4-6 4 6-4 12z"/></svg>';
  }
  if (s.includes('print') || s.includes('art') || s.includes('illustration')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-4 4-2-2-7 7"/></svg>';
  }
  if (s.includes('candle') || s.includes('home')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1.5 2 2 3.2 1 4.5-.6.8-1.4.8-2 0C10 5.2 10.5 4 12 2z"/><rect x="7" y="10" width="10" height="11" rx="2"/><path d="M12 7v3"/></svg>';
  }
  if (s.includes('wood')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L5 12h4l-3 7h12l-3-7h4L12 2z"/><path d="M12 19v3"/></svg>';
  }
  if (s.includes('beauty') || s.includes('wellness')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c4 3 6 6.5 6 10a6 6 0 1 1-12 0c0-3.5 2-7 6-10z"/><path d="M12 10v7"/></svg>';
  }
  if (s.includes('stationery') || s.includes('paper')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>';
  }
  if (s.includes('accessor')) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>';
  }
  return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.2 4.8L19.5 9l-3.8 3.7.9 5.3L12 15.5 7.4 18l.9-5.3L4.5 9l5.3-1.2L12 3z"/></svg>';
}

export function getMainProductImage(product) {
  const imgs = Array.isArray(product?.product_images) ? product.product_images : [];
  const main = imgs.find(i => i.is_main && i.url) || imgs.find(i => i.url) || null;
  return main ? main.url : '/images/placeholder.svg';
}

export function renderProductCard(product, { favoritedIds = null, showQuickView = true } = {}) {
  const imgUrl = getMainProductImage(product);
  const stock = product.quantity == null ? 0 : Number(product.quantity);
  const isFav = favoritedIds ? favoritedIds.has(product.id) : false;
  const shopName = product.shops?.name || 'Local Maker';
  const shopSlug = product.shops?.slug || '';
  const categoryName = product.categories?.name || product.category_name || 'Handmade';
  const stockBadge = stock <= 0
    ? '<span class="product-badge soldout">Sold out</span>'
    : (stock <= 3 ? '<span class="product-badge lowstock">Only ' + stock + ' left</span>' : '');

  return `
    <article class="product-card" data-product-id="${escapeAttr(product.id)}">
      <div class="product-card-media">
        <a href="product.html?id=${encodeURIComponent(product.id)}">
          <img src="${escapeAttr(imgUrl)}" alt="${escapeAttr(product.name || 'Handmade item')}" loading="lazy" decoding="async" onerror="this.src='/images/placeholder.svg'">
        </a>
        ${stockBadge}
        <button type="button" class="fav-btn${isFav ? ' active' : ''}" data-product-id="${escapeAttr(product.id)}" aria-label="${isFav ? 'Remove from favorites' : 'Save to favorites'}" aria-pressed="${isFav ? 'true' : 'false'}">
          <svg class="fav-icon" width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>
      <div class="product-card-content">
        <div class="product-card-top">
          <span class="product-category">${escapeHtml(categoryName)}</span>
        </div>
        <h3 class="product-card-title">
          <a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(product.name)}</a>
        </h3>
        <p class="product-card-seller">
          ${shopSlug
            ? 'by <a href="seller-shop.html?slug=' + encodeURIComponent(shopSlug) + '">' + escapeHtml(shopName) + '</a>'
            : 'by ' + escapeHtml(shopName)}
        </p>
        <div class="product-card-bottom">
          <div class="product-price">${formatMoney(product.price_cents, product.currency)}</div>
          ${stock > 0
            ? (showQuickView ? `<a href="product.html?id=${encodeURIComponent(product.id)}" class="product-card-link">View &rarr;</a>` : '')
            : `<span class="product-stock">Out of stock</span>`}
        </div>
      </div>
    </article>
  `;
}

export async function fetchUserFavoritesSet() {
  const { currentUser } = await import('/js/init.js');
  if (!supabase || !currentUser) return new Set();
  try {
    const { data } = await supabase
      .from('favorites')
      .select('product_id')
      .eq('user_id', currentUser.id);
    return new Set((data || []).map(r => r.product_id));
  } catch (_) {
    return new Set();
  }
}

export function wireFavoriteButtons(root = document, { favoritedIds = null, onChange = null } = {}) {
  if (!root) return;
  if (root._favDelegated) return;
  root._favDelegated = true;

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('.fav-btn[data-product-id]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const productId = btn.dataset.productId;
    const { currentUser } = await import('/js/init.js');
    if (!currentUser) {
      window.location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'shop.html');
      return;
    }

    btn.disabled = true;
    try {
      const { data: existing, error: readErr } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('product_id', productId)
        .maybeSingle();
      if (readErr) throw readErr;

      let active = false;
      if (existing) {
        const { error: delErr } = await supabase.from('favorites').delete().eq('id', existing.id);
        if (delErr) throw delErr;
        if (favoritedIds) favoritedIds.delete(productId);
        active = false;
        showToast('Removed from favorites.', 'info');
      } else {
        const { error: insErr } = await supabase
          .from('favorites')
          .insert([{ user_id: currentUser.id, product_id: productId }]);
        if (insErr) throw insErr;
        if (favoritedIds) favoritedIds.add(productId);
        active = true;
        showToast('Saved to favorites!');
      }

      document.querySelectorAll(`.fav-btn[data-product-id="${CSS.escape(productId)}"]`).forEach(el => {
        el.classList.toggle('active', active);
        el.setAttribute('aria-pressed', active ? 'true' : 'false');
        const svg = el.querySelector('svg');
        if (svg) svg.setAttribute('fill', active ? 'currentColor' : 'none');
      });
      if (typeof onChange === 'function') onChange(productId, active);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('row-level security')) {
        showToast('Your account is awaiting admin approval before saving favorites.', 'error');
      } else {
        showToast(msg || 'Could not update favorites.', 'error');
      }
    } finally {
      btn.disabled = false;
    }
  });
}
