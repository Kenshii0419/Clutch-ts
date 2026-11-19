// Seller order management — uses authenticated API endpoints so notifications and sales events are recorded
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  formatDateTime,
  formatAddress,
  escapeHtml,
  escapeAttr,
  showToast,
  openModal,
  closeModal,
  apiFetch,
  checkDbStatus
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const requireAuthEl = document.getElementById('seller-orders-require-auth');
const wrap = document.getElementById('seller-orders-wrap');
const loadingEl = document.getElementById('orders-loading');
const tableWrap = document.getElementById('orders-table-wrap');
const shipModal = document.getElementById('ship-modal');
const shipForm = document.getElementById('ship-form');
const contentBox = document.getElementById('orders-content-box');
const sortSelect = document.getElementById('seller-orders-sort');

let orderRows = [];
let meId = null;
let myStudioName = 'Your Maker Studio';

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

function renderSellerOrders() {
  const rows = sortedOrders(orderRows, sortSelect?.value || 'date-desc');
  contentBox.style.display = 'block';
  if (!rows.length) {
    tableWrap.innerHTML = '<div class="empty-state"><h3>No orders yet</h3><p>Orders will appear here once buyers purchase from your shop.</p></div>';
    return;
  }

  const bodyHtml = rows.map(o => {
    const mine = (o.order_items || []).filter(oi => oi.seller_id === meId);
    const mineTotal = mine.reduce((s, oi) => s + oi.price_cents * oi.quantity, 0);
    const qtyTotal = mine.reduce((s, oi) => s + oi.quantity, 0);
    const canProcess = o.status === 'paid';
    const canShip = o.status === 'paid' || o.status === 'processing';
    const addr = o.shipping_address || {};
    const buyerSummary = addr.name ? `${addr.name}${addr.city ? ' · ' + addr.city : ''}` : 'Buyer';

    return `
      <tr>
        <td><strong>#${escapeHtml(o.order_number)}</strong></td>
        <td>${mine.map(oi => escapeHtml(oi.product_name_snapshot) + ' &times;' + oi.quantity).join('<br>') || '—'}</td>
        <td>${qtyTotal}</td>
        <td title="${escapeAttr(formatAddress(addr))}">${escapeHtml(buyerSummary)}</td>
        <td>${escapeHtml(o.delivery_method || 'standard')}</td>
        <td>${formatDateTime(o.created_at)}</td>
        <td><strong>${formatMoney(mineTotal, o.currency)}</strong></td>
        <td>${statusChip(o.status)}</td>
        <td>
          <div class="flex" style="gap:0.35rem">
            ${canProcess ? `<button type="button" class="btn btn-outline btn-sm" data-process-id="${escapeAttr(o.id)}">Prepare</button>` : ''}
            ${canShip ? `<button type="button" class="btn btn-primary btn-sm" data-ship-id="${escapeAttr(o.id)}">Ship</button>` : ''}
            ${o.tracking_number ? `<span class="text-secondary" style="font-size:0.78rem">Track: ${escapeHtml(o.tracking_number)}</span>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Order</th><th>Items</th><th>Qty</th><th>Buyer</th><th>Delivery</th><th>Date</th><th>Your Share</th><th>Status</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
}

async function loadOrders() {
  loadingEl.style.display = 'none';
  contentBox.style.display = 'block';
  tableWrap.innerHTML = '<div class="skeleton-lg"></div>';

  const res = await apiFetch('/api/orders?scope=seller');
  if (!res.ok) {
    tableWrap.innerHTML = `<div class="empty-state"><h3>Unable to load orders</h3><p>${escapeHtml(res.error)}</p></div>`;
    return;
  }
  orderRows = res.data || [];
  renderSellerOrders();
}

tableWrap?.addEventListener('click', async (e) => {
  const procBtn = e.target.closest('[data-process-id]');
  if (procBtn) {
    procBtn.disabled = true;
    const res = await apiFetch('/api/orders/' + encodeURIComponent(procBtn.dataset.processId) + '/process', { method: 'PATCH' });
    if (!res.ok) {
      procBtn.disabled = false;
      showToast(res.error, 'error');
      return;
    }
    showToast('Order marked as preparing/processing.');
    loadOrders();
    return;
  }

  const shipBtn = e.target.closest('[data-ship-id]');
  if (shipBtn) {
    const order = orderRows.find(o => o.id === shipBtn.dataset.shipId);
    if (!order) return;
    shipForm.dataset.orderId = order.id;
    document.getElementById('ship-tracking').value = order.tracking_number || '';
    document.getElementById('ship-note').value = '';
    document.getElementById('ship-seller').value = myStudioName;
    openModal(shipModal);
  }
});

shipForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const orderId = shipForm.dataset.orderId;
  if (!orderId) return;
  const confirmBtn = document.getElementById('ship-confirm');
  confirmBtn.disabled = true;

  const res = await apiFetch('/api/orders/' + encodeURIComponent(orderId) + '/ship', {
    method: 'PATCH',
    body: {
      tracking_number: document.getElementById('ship-tracking').value.trim(),
      note: document.getElementById('ship-note').value.trim()
    }
  });
  confirmBtn.disabled = false;
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  showToast('Order marked as shipped and buyer notified!');
  closeModal(shipModal);
  loadOrders();
});

document.getElementById('ship-modal-close')?.addEventListener('click', () => closeModal(shipModal));
document.getElementById('ship-cancel')?.addEventListener('click', () => closeModal(shipModal));
shipModal?.addEventListener('click', (e) => { if (e.target === shipModal) closeModal(shipModal); });
sortSelect?.addEventListener('change', renderSellerOrders);

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);

  if (!user) {
    requireAuthEl.style.display = 'block';
    wrap.style.display = 'none';
    updateCartCount(0);
    return;
  }

  requireAuthEl.style.display = 'none';
  refreshCartCount();
  const role = profile?.role || 'buyer';
  if (role !== 'seller' && role !== 'admin') {
    wrap.innerHTML = '<div class="empty-state content-box"><h3>Only sellers can manage shop orders</h3><a href="seller-dashboard.html" class="btn btn-primary">Go to Seller Studio</a></div>';
    wrap.style.display = 'block';
    return;
  }

  meId = user.id;
  const { data: shop } = await supabase.from('shops').select('name').eq('owner_id', user.id).limit(1).maybeSingle();
  if (shop?.name) myStudioName = shop.name;
  wrap.style.display = 'block';
  loadOrders();
});

checkDbStatus();
