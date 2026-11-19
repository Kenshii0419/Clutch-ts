// Shopping cart (bound to the signed-in user's account)
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  escapeHtml,
  escapeAttr,
  showToast,
  confirmDialog,
  checkDbStatus,
  getMainProductImage
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount } from '/js/nav.js';

const params = new URLSearchParams(window.location.search);
const addOnLoad = params.get('add');

const wrapEl = document.getElementById('cart-wrap');
const itemsWrap = document.getElementById('cart-items-wrap');
const emptyEl = document.getElementById('cart-empty');
const loadingEl = document.getElementById('cart-loading');
const requireLoginEl = document.getElementById('cart-require-login');
const pendingNoticeEl = document.getElementById('cart-pending-notice');
const subtotalEl = document.getElementById('cart-subtotal');
const totalEl = document.getElementById('cart-total');
const countLabelEl = document.getElementById('cart-count-label');
const stockWarnEl = document.getElementById('cart-stock-warning');
const proceedBtn = document.getElementById('proceed-checkout-btn');
const sortSelect = document.getElementById('cart-sort');

let cartRows = [];
let userApprovalStatus = 'approved';

function cmp(a, b, key, dir) {
  let av = a[key], bv = b[key];
  if (typeof av === 'string') av = av.toLowerCase();
  if (typeof bv === 'string') bv = bv.toLowerCase();
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
}

function sortedCart(rows, mode) {
  const list = rows.map(r => ({
    ...r,
    _name: r.products?.name || '',
    _price: r.products?.price_cents || 0,
    _qty: r.quantity || 0,
    _added: r.created_at || r.id || ''
  }));
  if (mode === 'added-asc') list.sort((a, b) => cmp(a, b, '_added', 1));
  else if (mode === 'alpha-asc') list.sort((a, b) => cmp(a, b, '_name', 1));
  else if (mode === 'price-asc') list.sort((a, b) => cmp(a, b, '_price', 1));
  else if (mode === 'price-desc') list.sort((a, b) => cmp(a, b, '_price', -1));
  else list.sort((a, b) => cmp(a, b, '_added', -1));
  return list;
}

async function ensureCart(userId) {
  let { data: cart } = await supabase.from('carts').select('id').eq('user_id', userId).maybeSingle();
  if (!cart) {
    const { data: created } = await supabase.from('carts').insert([{ user_id: userId }]).select().single();
    return created?.id || null;
  }
  return cart.id;
}

async function loadCart(userId) {
  try {
    const cartId = await ensureCart(userId);
    if (!cartId) {
      cartRows = [];
      renderCart(cartRows);
      return;
    }

    const { data: items } = await supabase
      .from('cart_items')
      .select('*, products(*, product_images(url, is_main), shops(name, slug))')
      .eq('cart_id', cartId);

    cartRows = items || [];

    if (addOnLoad && !cartRows.some(r => r.product_id === addOnLoad)) {
      const { data: prod } = await supabase
        .from('products')
        .select('quantity, status, moderation_status')
        .eq('id', addOnLoad)
        .maybeSingle();
      if (prod && prod.status === 'published' && prod.moderation_status === 'approved' && (prod.quantity || 0) > 0) {
        const { error } = await supabase.from('cart_items').insert([{ cart_id: cartId, product_id: addOnLoad, quantity: 1 }]);
        if (!error) {
          window.history.replaceState(null, '', 'cart.html');
          showToast('Added to cart!');
          return loadCart(userId);
        }
      }
    }

    renderCart(cartRows);
  } catch (err) {
    loadingEl.style.display = 'none';
    showToast(err.message || 'Could not load cart.', 'error');
  }
}

function renderCart(rows) {
  loadingEl.style.display = 'none';
  if (!rows.length) {
    emptyEl.style.display = 'block';
    wrapEl.style.display = 'none';
    updateCartCount(0);
    return;
  }

  emptyEl.style.display = 'none';
  wrapEl.style.display = 'grid';

  const display = sortedCart(rows, sortSelect?.value || 'added-desc');
  let subtotal = 0;
  let hasIssue = false;

  const html = display.map((r) => {
    const p = r.products || {};
    const imgUrl = getMainProductImage(p);
    const price = p.price_cents || 0;
    const qty = r.quantity || 0;
    const line = price * qty;
    subtotal += line;
    const stock = p.quantity == null ? 0 : Number(p.quantity);
    const isAvailable = p.status === 'published' && p.moderation_status === 'approved' && stock > 0;
    const exceedsStock = isAvailable && qty > stock;
    if (!isAvailable || exceedsStock) hasIssue = true;

    const cur = p.currency || 'PHP';
    const shopSlug = p.shops?.slug || '';
    const shopName = p.shops?.name || 'Local Maker';

    return `
      <article class="cart-item-card" data-item-id="${escapeAttr(r.id)}">
        <div class="cart-item-media">
          <a href="product.html?id=${encodeURIComponent(p.id || '')}">
            <img src="${escapeAttr(imgUrl)}" alt="${escapeAttr(p.name || 'Product')}" onerror="this.src='/images/placeholder.svg'">
          </a>
        </div>
        <div>
          <h3 class="cart-item-title"><a href="product.html?id=${encodeURIComponent(p.id || '')}">${escapeHtml(p.name || 'Creation')}</a></h3>
          <p class="cart-item-meta">by ${shopSlug ? `<a href="seller-shop.html?slug=${encodeURIComponent(shopSlug)}">${escapeHtml(shopName)}</a>` : escapeHtml(shopName)}</p>
          ${!isAvailable ? '<p class="form-error" style="margin:0.25rem 0 0">This item is currently unavailable or sold out.</p>' : ''}
          ${exceedsStock ? `<p class="form-error" style="margin:0.25rem 0 0">Only ${stock} in stock — lower quantity to continue.</p>` : ''}
          <div class="cart-item-prices">
            <span>Unit: <strong>${formatMoney(price, cur)}</strong></span>
            <span>Line: <strong>${formatMoney(line, cur)}</strong></span>
          </div>
        </div>
        <div class="cart-item-actions">
          ${isAvailable ? `
            <div class="qty-stepper" aria-label="Quantity for ${escapeAttr(p.name || 'item')}">
              <button type="button" data-qty-delta="-1" data-id="${escapeAttr(r.id)}" data-max="${stock}" aria-label="Decrease quantity">&minus;</button>
              <input type="number" value="${qty}" min="1" max="${stock}" data-id="${escapeAttr(r.id)}" data-max="${stock}" class="cart-qty" aria-label="Quantity">
              <button type="button" data-qty-delta="1" data-id="${escapeAttr(r.id)}" data-max="${stock}" aria-label="Increase quantity">+</button>
            </div>
          ` : '<span class="product-stock">Unavailable</span>'}
          <button type="button" class="btn btn-ghost btn-sm" data-remove-id="${escapeAttr(r.id)}" data-name="${escapeAttr(p.name || 'item')}" style="color:var(--danger)">Remove</button>
        </div>
      </article>
    `;
  }).join('');

  itemsWrap.innerHTML = '<div class="cart-list">' + html + '</div>';

  const currency = rows[0]?.products?.currency || 'PHP';
  const count = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  if (countLabelEl) countLabelEl.textContent = `${count} item${count !== 1 ? 's' : ''} in your cart`;
  subtotalEl.innerHTML = `<span class="text-secondary">Subtotal (${count} item${count !== 1 ? 's' : ''})</span><strong>${formatMoney(subtotal, currency)}</strong>`;
  totalEl.innerHTML = `<span style="font-weight:800">Total</span><strong style="font-size:1.15rem;color:var(--color-sage-deep)">${formatMoney(subtotal, currency)}</strong>`;
  updateCartCount(count);

  if (hasIssue) {
    stockWarnEl.textContent = 'Remove unavailable items or adjust quantities to match available stock before checking out.';
    stockWarnEl.style.display = 'block';
    proceedBtn.classList.add('disabled');
    proceedBtn.setAttribute('aria-disabled', 'true');
    proceedBtn.style.pointerEvents = 'none';
    proceedBtn.style.opacity = '0.55';
  } else {
    stockWarnEl.style.display = 'none';
    proceedBtn.classList.remove('disabled');
    proceedBtn.removeAttribute('aria-disabled');
    proceedBtn.style.pointerEvents = '';
    proceedBtn.style.opacity = '';
  }
}

async function updateItemQty(itemId, nextQty, maxStock) {
  const clamped = Math.max(1, Math.min(maxStock || 1, Number(nextQty) || 1));
  const { error } = await supabase.from('cart_items').update({ quantity: clamped }).eq('id', itemId);
  if (error) {
    showToast(error.message || 'Could not update quantity.', 'error');
    return;
  }
  const target = cartRows.find(r => r.id === itemId);
  if (target) target.quantity = clamped;
  renderCart(cartRows);
}

async function removeItem(itemId, name) {
  const ok = await confirmDialog({
    title: 'Remove item from cart?',
    message: `Remove "${name}" from your shopping cart?`,
    confirmText: 'Remove',
    danger: true
  });
  if (!ok) return;
  const { error } = await supabase.from('cart_items').delete().eq('id', itemId);
  if (error) {
    showToast(error.message || 'Could not remove item.', 'error');
    return;
  }
  cartRows = cartRows.filter(r => r.id !== itemId);
  showToast('Item removed from cart.', 'info');
  renderCart(cartRows);
}

itemsWrap?.addEventListener('click', (e) => {
  const stepBtn = e.target.closest('[data-qty-delta]');
  if (stepBtn) {
    const id = stepBtn.dataset.id;
    const delta = parseInt(stepBtn.dataset.qtyDelta, 10) || 0;
    const max = parseInt(stepBtn.dataset.max, 10) || 1;
    const row = cartRows.find(r => r.id === id);
    if (!row) return;
    updateItemQty(id, (row.quantity || 1) + delta, max);
    return;
  }
  const remBtn = e.target.closest('[data-remove-id]');
  if (remBtn) {
    removeItem(remBtn.dataset.removeId, remBtn.dataset.name || 'item');
  }
});

itemsWrap?.addEventListener('change', (e) => {
  const inp = e.target.closest('.cart-qty[data-id]');
  if (!inp) return;
  const max = parseInt(inp.dataset.max, 10) || 1;
  updateItemQty(inp.dataset.id, parseInt(inp.value, 10) || 1, max);
});

sortSelect?.addEventListener('change', () => renderCart(cartRows));

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);

  if (!user) {
    requireLoginEl.style.display = 'block';
    loadingEl.style.display = 'none';
    wrapEl.style.display = 'none';
    emptyEl.style.display = 'none';
    pendingNoticeEl.style.display = 'none';
    updateCartCount(0);
    return;
  }

  requireLoginEl.style.display = 'none';
  userApprovalStatus = profile?.approval_status || 'pending';
  if (profile && profile.role !== 'admin' && userApprovalStatus !== 'approved') {
    loadingEl.style.display = 'none';
    wrapEl.style.display = 'none';
    emptyEl.style.display = 'none';
    pendingNoticeEl.style.display = 'block';
    pendingNoticeEl.innerHTML = `
      <strong>${userApprovalStatus === 'rejected' ? 'Account not approved' : 'Account review pending'}</strong>
      <p style="margin:0.35rem 0 0">${userApprovalStatus === 'rejected'
        ? 'Your account application was not approved. Please contact support for assistance.'
        : 'Once an administrator approves your account, your shopping cart and checkout will unlock automatically.'}</p>
    `;
    updateCartCount(0);
    return;
  }

  pendingNoticeEl.style.display = 'none';
  loadCart(user.id);
});

checkDbStatus();
