// Checkout — sandbox test payment flow (supports cart checkout and ?buyNow=<productId>&qty=<n>)
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  escapeHtml,
  showToast,
  showError,
  clearErrors,
  apiFetch,
  checkDbStatus
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const params = new URLSearchParams(window.location.search);
const buyNowId = params.get('buyNow');
const buyNowQty = Math.max(1, parseInt(params.get('qty'), 10) || 1);

const form = document.getElementById('checkout-form');
const submitBtn = document.getElementById('checkout-submit');
const itemsEl = document.getElementById('checkout-items');
const totalEl = document.getElementById('checkout-total');
const errorEl = document.getElementById('checkout-error');
const requireLoginEl = document.getElementById('checkout-require-login');
const pendingNoticeEl = document.getElementById('checkout-pending-notice');
const loadingEl = document.getElementById('checkout-loading');
const formWrap = document.getElementById('checkout-form-wrap');
const emptyEl = document.getElementById('checkout-empty');

let checkoutTotal = 0;
let checkoutCurrency = 'PHP';
let checkoutItems = [];
let hasStockProblem = false;

async function ensureCart(userId) {
  let { data: cart } = await supabase.from('carts').select('id').eq('user_id', userId).maybeSingle();
  if (!cart) {
    const { data: created } = await supabase.from('carts').insert([{ user_id: userId }]).select().single();
    return created?.id || null;
  }
  return cart.id;
}

function renderSummary(rows) {
  loadingEl.style.display = 'none';
  if (!rows.length) {
    emptyEl.style.display = 'block';
    formWrap.style.display = 'none';
    return;
  }

  formWrap.style.display = 'block';
  emptyEl.style.display = 'none';
  checkoutTotal = 0;
  checkoutItems = [];
  hasStockProblem = false;
  checkoutCurrency = rows[0]?.products?.currency || 'PHP';

  let html = '';
  for (const r of rows) {
    const p = r.products;
    if (!p || p.status !== 'published' || p.moderation_status !== 'approved' || (p.quantity || 0) < r.quantity) {
      hasStockProblem = true;
      html += `<div class="form-error" style="margin-bottom:0.65rem">${escapeHtml(p?.name || 'Item')} (Qty ${r.quantity}) is unavailable or out of stock. Update your cart first.</div>`;
      continue;
    }
    const line = p.price_cents * r.quantity;
    checkoutTotal += line;
    checkoutItems.push({ product_id: r.product_id, quantity: r.quantity });
    html += `
      <div class="flex-between" style="margin-bottom:0.75rem;padding-bottom:0.75rem;border-bottom:1px dashed var(--border);font-size:0.92rem">
        <div>
          <div style="font-weight:700">${escapeHtml(p.name)}</div>
          <div class="text-secondary" style="font-size:0.82rem">Qty ${r.quantity} &times; ${formatMoney(p.price_cents, p.currency)}</div>
        </div>
        <strong>${formatMoney(line, p.currency)}</strong>
      </div>
    `;
  }

  itemsEl.innerHTML = html;
  const totalUnits = checkoutItems.reduce((s, r) => s + r.quantity, 0);
  totalEl.innerHTML = `<span style="font-weight:800">Total (${totalUnits} item${totalUnits !== 1 ? 's' : ''})</span><strong style="font-size:1.2rem;color:var(--color-sage-deep)">${formatMoney(checkoutTotal, checkoutCurrency)}</strong>`;
  submitBtn.disabled = hasStockProblem || !checkoutItems.length;
}

async function loadCheckoutItems(userId) {
  if (buyNowId) {
    const { data: prod } = await supabase
      .from('products')
      .select('id, name, price_cents, currency, quantity, status, moderation_status')
      .eq('id', buyNowId)
      .maybeSingle();
    if (!prod) {
      renderSummary([]);
      return;
    }
    renderSummary([{ product_id: prod.id, quantity: buyNowQty, products: prod }]);
    return;
  }

  const cartId = await ensureCart(userId);
  if (!cartId) {
    renderSummary([]);
    return;
  }
  const { data: items } = await supabase
    .from('cart_items')
    .select('product_id, quantity, products(id, price_cents, currency, name, quantity, status, moderation_status)')
    .eq('cart_id', cartId);
  renderSummary(items || []);
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  errorEl.style.display = 'none';

  if (hasStockProblem || !checkoutItems.length) {
    errorEl.textContent = 'Please resolve unavailable items before placing your order.';
    errorEl.style.display = 'block';
    return;
  }

  const shipping_address = {
    name: document.getElementById('ship-name').value.trim(),
    phone: document.getElementById('ship-phone').value.trim(),
    email: document.getElementById('ship-email').value.trim(),
    address: document.getElementById('ship-address').value.trim(),
    barangay: document.getElementById('ship-barangay').value.trim(),
    city: document.getElementById('ship-city').value.trim(),
    province: document.getElementById('ship-province').value.trim(),
    postal: document.getElementById('ship-postal').value.trim(),
    country: document.getElementById('ship-country').value
  };
  if (!shipping_address.name) return showError(form, 'ship-name', 'Please enter your full name.');
  if (!shipping_address.email) return showError(form, 'ship-email', 'Please enter your email address.');
  if (!shipping_address.address) return showError(form, 'ship-address', 'Please enter your street address.');
  if (!shipping_address.city) return showError(form, 'ship-city', 'Please enter your city or municipality.');
  if (!shipping_address.postal) return showError(form, 'ship-postal', 'Please enter your postal code.');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing sandbox order…';

  const intentRes = await apiFetch('/api/payments/create-intent', {
    method: 'POST',
    body: { amount_cents: checkoutTotal, currency: checkoutCurrency }
  });
  if (!intentRes.ok) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Complete Sandbox Order';
    errorEl.textContent = intentRes.error;
    errorEl.style.display = 'block';
    return;
  }

  const orderRes = await apiFetch('/api/orders', {
    method: 'POST',
    body: {
      items: checkoutItems,
      shipping_address,
      delivery_method: document.getElementById('ship-delivery').value,
      notes: document.getElementById('ship-notes').value.trim(),
      payment_intent_id: intentRes.data.intent_id,
      clear_cart: !buyNowId
    }
  });
  if (!orderRes.ok) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Complete Sandbox Order';
    errorEl.textContent = orderRes.error;
    errorEl.style.display = 'block';
    return;
  }

  const confirmRes = await apiFetch('/api/payments/confirm', {
    method: 'POST',
    body: { intent_id: intentRes.data.intent_id }
  });
  if (!confirmRes.ok) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Complete Sandbox Order';
    errorEl.textContent = confirmRes.error;
    errorEl.style.display = 'block';
    return;
  }

  await refreshCartCount();
  showToast('Sandbox order placed and confirmed!');
  window.location.href = 'orders.html?id=' + encodeURIComponent(orderRes.data.order.id) + '&paid=1';
});

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);

  if (!user) {
    requireLoginEl.style.display = 'block';
    loadingEl.style.display = 'none';
    formWrap.style.display = 'none';
    pendingNoticeEl.style.display = 'none';
    updateCartCount(0);
    return;
  }

  requireLoginEl.style.display = 'none';
  refreshCartCount();

  if (profile && profile.role !== 'admin' && profile.approval_status !== 'approved') {
    loadingEl.style.display = 'none';
    formWrap.style.display = 'none';
    pendingNoticeEl.style.display = 'block';
    pendingNoticeEl.innerHTML = `
      <strong>${profile.approval_status === 'rejected' ? 'Account not approved' : 'Account review in progress'}</strong>
      <p style="margin:0.35rem 0 0">${profile.approval_status === 'rejected'
        ? 'Your account was not approved for marketplace checkout.'
        : 'Your account must be approved by an administrator before placing orders.'}</p>
    `;
    return;
  }

  pendingNoticeEl.style.display = 'none';
  const nameField = document.getElementById('ship-name');
  const emailField = document.getElementById('ship-email');
  if (nameField && !nameField.value && profile?.display_name) nameField.value = profile.display_name;
  if (emailField && !emailField.value) emailField.value = profile?.email || user.email || '';

  loadCheckoutItems(user.id);
});

checkDbStatus();
