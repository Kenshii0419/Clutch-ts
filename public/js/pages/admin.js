// Administration dashboard (admin-only; enforced server-side and by RLS)
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  formatDateTime,
  escapeHtml,
  escapeAttr,
  showToast,
  confirmDialog,
  apiFetch,
  checkDbStatus
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount } from '/js/nav.js';

const requireAuthEl = document.getElementById('admin-require-auth');
const wrap = document.getElementById('admin-wrap');
const reportsList = document.getElementById('reports-list');
const activityList = document.getElementById('activity-list');
const supportList = document.getElementById('support-messages-list');
const categoriesList = document.getElementById('admin-categories-list');
const categoryForm = document.getElementById('admin-category-form');
const productsEl = document.getElementById('admin-products');
const ordersEl = document.getElementById('admin-orders');
const catsEl = document.getElementById('admin-categories');
const reportsEl = document.getElementById('admin-reports');
const accountsEl = document.getElementById('admin-account-list');
const accountStatusFilter = document.getElementById('account-status-filter');
const productQueueEl = document.getElementById('admin-product-queue');
const productStatusFilter = document.getElementById('product-status-filter');
const pendingProductCount = document.getElementById('pending-product-count');

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

async function loadOverview() {
  const [{ data: products }, ordersRes, catsRes, { data: reports }, msgsRes] = await Promise.all([
    supabase.from('products').select('id'),
    apiFetch('/api/admin/orders'),
    apiFetch('/api/categories', { auth: false }),
    supabase.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: false }),
    apiFetch('/api/messages')
  ]);

  const orders = ordersRes.ok ? (ordersRes.data || []) : [];
  const cats = catsRes.ok ? (catsRes.data || []) : [];
  const openReports = reports || [];

  productsEl.textContent = String((products || []).length);
  ordersEl.textContent = String(orders.length);
  catsEl.textContent = String(cats.length);
  reportsEl.textContent = String(openReports.length);

  // Categories list
  if (!cats.length) {
    categoriesList.innerHTML = '<p class="text-secondary">No categories yet.</p>';
  } else {
    categoriesList.innerHTML = cats.map(c => `
      <div class="admin-queue-card" style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0.9rem">
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <span class="text-secondary" style="font-size:0.8rem;margin-left:0.4rem">/${escapeHtml(c.slug)}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-delete-cat="${escapeAttr(c.id)}" data-name="${escapeAttr(c.name)}" style="color:var(--danger)">Remove</button>
      </div>
    `).join('');
  }

  // Open reports
  if (!openReports.length) {
    reportsList.innerHTML = '<p class="text-secondary">No open reports.</p>';
  } else {
    reportsList.innerHTML = openReports.map(r => `
      <div class="admin-queue-card">
        <div class="flex-between">
          <div>
            <strong>Report</strong>
            <div class="text-secondary" style="font-size:0.82rem">${formatDateTime(r.created_at)}</div>
          </div>
          <div class="flex" style="gap:0.35rem">
            ${r.product_id ? `<a href="product.html?id=${encodeURIComponent(r.product_id)}" class="btn btn-ghost btn-sm">Inspect</a>` : ''}
            <button type="button" class="btn btn-outline btn-sm" data-report-id="${escapeAttr(r.id)}" data-report-status="resolved">Resolve</button>
            <button type="button" class="btn btn-ghost btn-sm" data-report-id="${escapeAttr(r.id)}" data-report-status="dismissed">Dismiss</button>
          </div>
        </div>
        <p style="margin:0.5rem 0 0;font-size:0.9rem">${escapeHtml(r.reason)}</p>
      </div>
    `).join('');
  }

  // Recent orders
  if (!orders.length) {
    activityList.innerHTML = '<p class="text-secondary">No marketplace orders yet.</p>';
  } else {
    activityList.innerHTML = orders.slice(0, 6).map(o => `
      <div class="admin-queue-card">
        <div class="flex-between">
          <div>
            <strong>Order #${escapeHtml(o.order_number)}</strong> ${statusChip(o.status)}
            <div class="text-secondary" style="font-size:0.84rem">${escapeHtml(o.profiles?.display_name || 'Buyer')} · ${(o.order_items || []).map(oi => escapeHtml(oi.product_name_snapshot)).join(', ') || 'Items'}</div>
          </div>
          <div style="text-align:right">
            <strong>${formatMoney(o.total_cents, o.currency)}</strong>
            <div class="text-secondary" style="font-size:0.78rem">${formatDateTime(o.created_at)}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Support messages
  const msgs = msgsRes.ok ? (msgsRes.data || []) : [];
  if (!msgs.length) {
    supportList.innerHTML = '<p class="text-secondary">No support messages received yet.</p>';
  } else {
    supportList.innerHTML = msgs.slice(0, 6).map(m => `
      <article class="admin-queue-card">
        <div class="flex-between">
          <strong>${escapeHtml(m.subject)}</strong>
          <span class="text-secondary" style="font-size:0.78rem">${formatDateTime(m.created_at)}</span>
        </div>
        <div class="text-secondary" style="font-size:0.84rem">${escapeHtml(m.name)} (${escapeHtml(m.email)})</div>
        <p style="margin:0.45rem 0 0;font-size:0.9rem;white-space:pre-wrap">${escapeHtml(m.content)}</p>
      </article>
    `).join('');
  }
}

async function loadAccounts() {
  accountsEl.innerHTML = '<p class="text-secondary">Loading accounts…</p>';
  const status = accountStatusFilter.value;
  const res = await apiFetch('/api/admin/accounts?status=' + encodeURIComponent(status));
  if (!res.ok) {
    accountsEl.innerHTML = `<p class="text-secondary">${escapeHtml(res.error)}</p>`;
    return;
  }
  const rows = res.data || [];
  if (!rows.length) {
    accountsEl.innerHTML = '<div class="empty-state" style="padding:1.5rem 0"><p>No accounts in this filter.</p></div>';
    return;
  }
  accountsEl.innerHTML = rows.map(account => `
    <article class="admin-queue-card">
      <div class="admin-queue-head">
        <div>
          <h4 style="margin:0">${escapeHtml(account.display_name || 'New maker')}</h4>
          <div class="text-secondary" style="font-size:0.84rem">${escapeHtml(account.email || 'No email')} · Joined ${formatDateTime(account.created_at)}</div>
        </div>
        <span class="badge ${account.approval_status === 'approved' ? 'badge-success' : account.approval_status === 'rejected' ? 'badge-coral' : 'badge-outline'}">${escapeHtml(account.approval_status)}</span>
      </div>
      <div class="text-secondary" style="font-size:0.84rem;margin-top:0.25rem">Role: ${escapeHtml(account.role)}</div>
      ${account.approval_status !== 'approved' ? `
        <div class="admin-queue-actions" style="margin-top:0.65rem">
          <button type="button" class="btn btn-sm btn-primary" data-account-action="approved" data-account-id="${escapeAttr(account.id)}">Approve</button>
          ${account.approval_status !== 'rejected' ? `<button type="button" class="btn btn-sm btn-ghost" data-account-action="rejected" data-account-id="${escapeAttr(account.id)}">Reject</button>` : ''}
        </div>` : ''}
    </article>
  `).join('');
}

async function loadProductQueue() {
  productQueueEl.innerHTML = '<p class="text-secondary">Loading listings…</p>';
  const status = productStatusFilter.value || 'pending';
  const res = await apiFetch('/api/admin/products?status=' + encodeURIComponent(status));
  if (!res.ok) {
    productQueueEl.innerHTML = `<p class="text-secondary">${escapeHtml(res.error)}</p>`;
    return;
  }
  const rows = res.data || [];
  pendingProductCount.textContent = `${rows.length} ${status === 'all' ? 'total' : status}`;
  if (!rows.length) {
    productQueueEl.innerHTML = '<div class="empty-state" style="padding:1.5rem 0"><p>No listings in this review view.</p></div>';
    return;
  }
  productQueueEl.innerHTML = rows.map(product => {
    const images = product.product_images || [];
    const mainImage = images.find(i => i.is_main) || images[0];
    const imageUrl = mainImage ? mainImage.url : '/images/placeholder.svg';
    return `
      <article class="admin-queue-card" data-product-id="${escapeAttr(product.id)}" data-seller-id="${escapeAttr(product.seller_id)}">
        <div class="admin-product-identity">
          <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(product.name)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
          <div style="min-width:0;flex:1">
            <div class="flex-between">
              <h4 style="margin:0">${escapeHtml(product.name)}</h4>
              <span class="badge ${product.moderation_status === 'approved' ? 'badge-success' : product.moderation_status === 'rejected' ? 'badge-coral' : 'badge-outline'}">${escapeHtml(product.moderation_status)}</span>
            </div>
            <div class="text-secondary" style="font-size:0.84rem">${escapeHtml(product.shops?.name || 'Shop')} · ${escapeHtml(product.profiles?.display_name || 'Seller')}</div>
            <div class="text-secondary" style="font-size:0.82rem">${escapeHtml(product.profiles?.email || 'No email')} · ${formatDateTime(product.created_at)}</div>
            <strong>${formatMoney(product.price_cents, product.currency)}</strong>
          </div>
        </div>
        <p style="margin:0.65rem 0;font-size:0.9rem">${escapeHtml(product.description || 'No description provided.')}</p>
        <label class="form-group" style="margin-bottom:0.5rem">Review note
          <textarea class="form-textarea" data-review-note maxlength="1000" style="min-height:68px" placeholder="Optional feedback for the seller">${escapeHtml(product.moderation_note || '')}</textarea>
        </label>
        <div class="admin-queue-actions">
          <button type="button" class="btn btn-sm btn-primary" data-product-decision="approved">Approve</button>
          <button type="button" class="btn btn-sm btn-outline" data-product-decision="rejected">Reject</button>
          ${product.status === 'published' ? `<button type="button" class="btn btn-sm btn-ghost" data-product-hide="${escapeAttr(product.id)}">Hide (Draft)</button>` : ''}
        </div>
        <form class="admin-message-form" data-message-form>
          <strong style="font-size:0.88rem">Direct message to seller</strong>
          <input class="form-input" name="subject" maxlength="160" required value="About your listing: ${escapeAttr(product.name)}" aria-label="Message subject">
          <textarea class="form-textarea" name="body" maxlength="5000" required style="min-height:68px" placeholder="Write a private message to this account…"></textarea>
          <button class="btn btn-sm btn-ghost" type="submit">Send Message</button>
        </form>
      </article>
    `;
  }).join('');
}

accountStatusFilter?.addEventListener('change', loadAccounts);
productStatusFilter?.addEventListener('change', loadProductQueue);

accountsEl?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-account-action]');
  if (!button) return;
  button.disabled = true;
  const res = await apiFetch('/api/admin/accounts/' + encodeURIComponent(button.dataset.accountId) + '/approval', {
    method: 'PATCH',
    body: { approval_status: button.dataset.accountAction }
  });
  if (!res.ok) {
    button.disabled = false;
    showToast(res.error, 'error');
    return;
  }
  showToast(button.dataset.accountAction === 'approved' ? 'Account approved.' : 'Account rejected.');
  loadAccounts();
});

productQueueEl?.addEventListener('click', async (event) => {
  const hideBtn = event.target.closest('[data-product-hide]');
  if (hideBtn) {
    hideBtn.disabled = true;
    const res = await apiFetch('/api/admin/products/' + encodeURIComponent(hideBtn.dataset.productHide) + '/hide', { method: 'PATCH' });
    if (!res.ok) {
      hideBtn.disabled = false;
      showToast(res.error, 'error');
      return;
    }
    showToast('Listing moved to draft.');
    loadProductQueue();
    return;
  }

  const button = event.target.closest('[data-product-decision]');
  if (!button) return;
  const card = button.closest('[data-product-id]');
  button.disabled = true;
  const res = await apiFetch('/api/admin/products/' + encodeURIComponent(card.dataset.productId) + '/review', {
    method: 'PATCH',
    body: {
      decision: button.dataset.productDecision,
      note: card.querySelector('[data-review-note]').value
    }
  });
  if (!res.ok) {
    button.disabled = false;
    showToast(res.error, 'error');
    return;
  }
  showToast(button.dataset.productDecision === 'approved' ? 'Listing approved!' : 'Listing rejected.');
  loadProductQueue();
  loadOverview();
});

productQueueEl?.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-message-form]');
  if (!form) return;
  event.preventDefault();
  const card = form.closest('[data-product-id]');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const res = await apiFetch('/api/admin/messages', {
    method: 'POST',
    body: {
      recipient_id: card.dataset.sellerId,
      product_id: card.dataset.productId,
      subject: form.elements.subject.value,
      body: form.elements.body.value
    }
  });
  button.disabled = false;
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  form.reset();
  showToast('Private message sent to the seller.');
});

categoryForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('cat-name').value.trim();
  const slug = document.getElementById('cat-slug').value.trim();
  if (!name) return;
  const res = await apiFetch('/api/admin/categories', { method: 'POST', body: { name, slug } });
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  categoryForm.reset();
  showToast('Category added!');
  loadOverview();
});

categoriesList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-cat]');
  if (!btn) return;
  const ok = await confirmDialog({
    title: 'Remove category?',
    message: `Delete category "${btn.dataset.name}"? Products in this category will become uncategorized.`,
    confirmText: 'Remove',
    danger: true
  });
  if (!ok) return;
  const res = await apiFetch('/api/admin/categories/' + encodeURIComponent(btn.dataset.deleteCat), { method: 'DELETE' });
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  showToast('Category removed.', 'info');
  loadOverview();
});

reportsList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-report-id]');
  if (!btn) return;
  btn.disabled = true;
  const res = await apiFetch('/api/admin/reports/' + encodeURIComponent(btn.dataset.reportId), {
    method: 'PATCH',
    body: { status: btn.dataset.reportStatus }
  });
  if (!res.ok) {
    btn.disabled = false;
    showToast(res.error, 'error');
    return;
  }
  showToast('Report updated.');
  loadOverview();
});

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
  updateCartCount(0);
  if (profile?.role !== 'admin') {
    wrap.innerHTML = '<div class="empty-state content-box"><h3>Administrator access required</h3><a href="index.html" class="btn btn-primary">Back to home</a></div>';
    wrap.style.display = 'block';
    return;
  }

  wrap.style.display = 'block';
  loadOverview();
  loadAccounts();
  loadProductQueue();
});

checkDbStatus();
