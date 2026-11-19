// Buyer order history + order detail + delivery confirmation
import { getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  formatDateTime,
  formatAddress,
  escapeHtml,
  escapeAttr,
  showToast,
  confirmDialog,
  apiFetch,
  checkDbStatus
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const params = new URLSearchParams(window.location.search);
const viewId = params.get('id');
const paid = params.get('paid');

const listEl = document.getElementById('orders-list');
const detailEl = document.getElementById('orders-detail');
const loadingEl = document.getElementById('orders-loading');
const requireLoginEl = document.getElementById('orders-require-login');
const contentBox = document.getElementById('orders-content-box');
const sortSelect = document.getElementById('orders-sort');
let orderRows = [];

function cmp(a, b, key, dir) {
  let av = a[key], bv = b[key];
  if (key === 'created_at') { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
  if (typeof av === 'string') av = av.toLowerCase();
  if (typeof bv === 'string') bv = bv.toLowerCase();
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
}

function sortedOrders(rows, mode) {
  const list = rows.slice();
  if (mode === 'date-asc') list.sort((a, b) => cmp(a, b, 'created_at', 1));
  else if (mode === 'total-desc') list.sort((a, b) => cmp(a, b, 'total_cents', -1));
  else if (mode === 'total-asc') list.sort((a, b) => cmp(a, b, 'total_cents', 1));
  else if (mode === 'alpha-asc') list.sort((a, b) => cmp(a, b, 'order_number', 1));
  else list.sort((a, b) => cmp(a, b, 'created_at', -1));
  return list;
}

function statusChip(status) {
  const map = {
    pending_payment: 'status-pending',
    paid: 'status-paid',
    processing: 'status-paid',
    shipped: 'status-shipped',
    completed: 'status-completed',
    cancelled: 'status-cancelled',
    refunded: 'status-cancelled'
  };
  return `<span class="status-chip ${map[status] || 'status-pending'}">${escapeHtml(String(status || '').replace('_', ' '))}</span>`;
}

function renderOrderList() {
  const rows = sortedOrders(orderRows, sortSelect?.value || 'date-desc');
  if (!rows.length) {
    contentBox.style.display = 'block';
    listEl.innerHTML = '<div class="empty-state"><h3>No orders yet</h3><p>Explore creations from local Iloilo artists and crafters.</p><a href="shop.html" class="btn btn-primary">Browse Handmade Goods</a></div>';
    return;
  }
  contentBox.style.display = 'block';
  listEl.innerHTML = rows.map(o => `
    <article class="order-card">
      <div class="flex-between">
        <div>
          <div style="font-weight:800">Order #${escapeHtml(o.order_number)}</div>
          <div class="text-secondary" style="font-size:0.86rem">${formatDateTime(o.created_at)}</div>
          ${o.order_items?.length ? `<div class="text-secondary" style="font-size:0.9rem;margin-top:0.25rem">${o.order_items.map(oi => escapeHtml(oi.product_name_snapshot) + ' &times;' + oi.quantity).join(', ')}</div>` : ''}
        </div>
        <div class="flex">
          ${statusChip(o.status)}
          <strong>${formatMoney(o.total_cents, o.currency)}</strong>
          <a href="orders.html?id=${encodeURIComponent(o.id)}" class="btn btn-outline btn-sm">Details</a>
        </div>
      </div>
    </article>
  `).join('');
}

async function loadOrders() {
  const res = await apiFetch('/api/orders?scope=buyer');
  loadingEl.style.display = 'none';
  if (!res.ok) {
    contentBox.style.display = 'block';
    listEl.innerHTML = `<div class="empty-state"><h3>Unable to load orders</h3><p>${escapeHtml(res.error)}</p></div>`;
    return;
  }
  orderRows = res.data || [];
  renderOrderList();
}

async function loadOrderDetail(id) {
  const res = await apiFetch('/api/orders/' + encodeURIComponent(id));
  loadingEl.style.display = 'none';
  contentBox.style.display = 'none';
  detailEl.style.display = 'block';

  if (!res.ok) {
    detailEl.innerHTML = `<div class="empty-state"><h3>Unable to load order</h3><p>${escapeHtml(res.error)}</p><a href="orders.html" class="btn btn-outline">Back to orders</a></div>`;
    return;
  }

  if (paid === '1') showToast('Sandbox order placed and confirmed!');
  const o = res.data;

  const itemsHtml = (o.order_items || []).map(oi => `
    <tr>
      <td>
        ${oi.product_id
          ? `<a href="product.html?id=${encodeURIComponent(oi.product_id)}">${escapeHtml(oi.product_name_snapshot)}</a>`
          : escapeHtml(oi.product_name_snapshot)}
      </td>
      <td>${oi.quantity}</td>
      <td>${formatMoney(oi.price_cents, o.currency)}</td>
      <td>${formatMoney(oi.price_cents * oi.quantity, o.currency)}</td>
      ${o.status === 'completed' && oi.product_id
        ? `<td><a href="product.html?id=${encodeURIComponent(oi.product_id)}#reviews" class="btn btn-outline btn-sm">Leave Review</a></td>`
        : '<td></td>'}
    </tr>
  `).join('');

  let actions = '<a href="orders.html" class="btn btn-ghost btn-sm">&larr; All orders</a>';
  if (o.status === 'pending_payment' || o.status === 'paid') {
    actions += ` <button type="button" class="btn btn-outline btn-sm" data-cancel-order="${escapeAttr(o.id)}" style="color:var(--danger);border-color:var(--danger)">Cancel Order</button>`;
  }
  if (o.status === 'shipped') {
    actions += ` <button type="button" class="btn btn-primary btn-sm" data-complete-order="${escapeAttr(o.id)}">Confirm Order Received</button>`;
  }

  detailEl.innerHTML = `
    <div class="flex-between" style="margin-bottom:0.75rem">
      <div>
        <h2 style="margin:0">Order #${escapeHtml(o.order_number)}</h2>
        <p class="text-secondary" style="margin:0.25rem 0 0">${formatDateTime(o.created_at)} &middot; ${statusChip(o.status)}</p>
      </div>
      ${o.tracking_number ? `<span class="badge badge-purple">Tracking: ${escapeHtml(o.tracking_number)}</span>` : ''}
    </div>

    <div class="table-wrap" style="margin:1rem 0">
      <table>
        <thead><tr><th>Creation</th><th>Qty</th><th>Unit Price</th><th>Line Total</th><th></th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>

    <div class="flex-between" style="padding:0.75rem 0;border-top:2px dashed var(--border);border-bottom:2px dashed var(--border)">
      <span style="font-weight:800">Order Total</span>
      <strong style="font-size:1.25rem;color:var(--color-sage-deep)">${formatMoney(o.total_cents, o.currency)}</strong>
    </div>

    <div class="sticky-note" style="margin-top:1.25rem">
      <h4 style="margin-top:0">Shipping Address &amp; Delivery</h4>
      <p style="margin:0;white-space:pre-wrap;font-size:0.92rem">${escapeHtml(formatAddress(o.shipping_address))}</p>
      ${o.notes ? `<p class="text-secondary" style="margin:0.65rem 0 0;font-size:0.88rem"><strong>Notes:</strong> ${escapeHtml(o.notes)}</p>` : ''}
    </div>

    <div class="flex" style="margin-top:1.25rem">${actions}</div>
  `;
}

detailEl?.addEventListener('click', async (e) => {
  const cancelBtn = e.target.closest('[data-cancel-order]');
  if (cancelBtn) {
    const ok = await confirmDialog({
      title: 'Cancel this order?',
      message: 'Stock will be restored to the maker for items in this order.',
      confirmText: 'Cancel Order',
      danger: true
    });
    if (!ok) return;
    cancelBtn.disabled = true;
    const res = await apiFetch('/api/orders/' + encodeURIComponent(cancelBtn.dataset.cancelOrder) + '/cancel', { method: 'PATCH' });
    if (!res.ok) {
      cancelBtn.disabled = false;
      showToast(res.error, 'error');
      return;
    }
    showToast('Order cancelled and stock restored.');
    loadOrderDetail(cancelBtn.dataset.cancelOrder);
    return;
  }

  const completeBtn = e.target.closest('[data-complete-order]');
  if (completeBtn) {
    const ok = await confirmDialog({
      title: 'Confirm order received?',
      message: 'Confirming delivery marks this order complete and lets you leave a verified review for the maker.',
      confirmText: 'Confirm Received'
    });
    if (!ok) return;
    completeBtn.disabled = true;
    const res = await apiFetch('/api/orders/' + encodeURIComponent(completeBtn.dataset.completeOrder) + '/complete', { method: 'PATCH' });
    if (!res.ok) {
      completeBtn.disabled = false;
      showToast(res.error, 'error');
      return;
    }
    showToast('Order marked as received! You can now review your items.');
    loadOrderDetail(completeBtn.dataset.completeOrder);
  }
});

sortSelect?.addEventListener('change', renderOrderList);

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);

  if (!user) {
    requireLoginEl.style.display = 'block';
    loadingEl.style.display = 'none';
    contentBox.style.display = 'none';
    detailEl.style.display = 'none';
    updateCartCount(0);
    return;
  }

  requireLoginEl.style.display = 'none';
  refreshCartCount();
  if (viewId) loadOrderDetail(viewId);
  else loadOrders();
});

checkDbStatus();
