// Seller studio dashboard — onboarding, real metrics, recent orders, storefront settings, inquiries, notifications
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  formatDateTime,
  escapeHtml,
  showToast,
  apiFetch,
  checkDbStatus
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const onboardEl = document.getElementById('seller-onboard');
const pendingPanel = document.getElementById('seller-account-pending');
const requireAuthEl = document.getElementById('seller-require-auth');
const dashboardHeader = document.getElementById('seller-dashboard-header');
const workspaceEl = document.getElementById('seller-workspace');
const statsEl = document.getElementById('seller-stats');
const recentEl = document.getElementById('seller-recent-orders');
const storefrontLink = document.getElementById('view-storefront-link');
const notifsEl = document.getElementById('seller-notifications');
const notifBadgeEl = document.getElementById('seller-notif-badge');
const inquiriesEl = document.getElementById('seller-inquiries-list');
const inqCountEl = document.getElementById('seller-inq-count');
const settingsForm = document.getElementById('shop-settings-form');

let myShop = null;

function showSellerWorkspace(visible) {
  dashboardHeader.style.display = visible ? 'flex' : 'none';
  workspaceEl.style.display = visible ? 'block' : 'none';
}

async function loadStatsAndShop(userId) {
  const [{ data: products }, ordersRes, { data: shops }] = await Promise.all([
    supabase.from('products').select('id, status, moderation_status, quantity').eq('seller_id', userId),
    apiFetch('/api/orders?scope=seller'),
    supabase.from('shops').select('*').eq('owner_id', userId).limit(1)
  ]);

  const rows = products || [];
  const published = rows.filter(r => r.status === 'published' && r.moderation_status === 'approved').length;
  const pendingReview = rows.filter(r => r.moderation_status === 'pending').length;
  const lowStock = rows.filter(r => r.status === 'published' && (r.quantity || 0) > 0 && (r.quantity || 0) <= 2).length;
  const soldOut = rows.filter(r => r.status === 'published' && (r.quantity || 0) <= 0).length;

  const myOrders = ordersRes.ok ? (ordersRes.data || []) : [];
  let revenue = 0;
  let revenueCurrency = 'PHP';
  for (const o of myOrders) {
    if (['paid', 'processing', 'shipped', 'completed'].includes(o.status)) {
      if (o.currency) revenueCurrency = o.currency;
      for (const oi of (o.order_items || [])) {
        if (oi.seller_id === userId) revenue += oi.price_cents * oi.quantity;
      }
    }
  }

  statsEl.innerHTML = `
    <div class="metric-card">
      <div class="label">Products Listed</div>
      <div class="value">${rows.length}</div>
      <div class="delta ok">${published} live · ${pendingReview} pending review</div>
    </div>
    <div class="metric-card">
      <div class="label">Orders Received</div>
      <div class="value">${myOrders.length}</div>
      <div class="delta">${soldOut} sold out listing${soldOut !== 1 ? 's' : ''}</div>
    </div>
    <div class="metric-card">
      <div class="label">Low Stock (&le;2)</div>
      <div class="value">${lowStock}</div>
      <div class="delta ${lowStock > 0 ? 'bad' : 'ok'}">${lowStock > 0 ? 'Needs restocking' : 'Inventory healthy'}</div>
    </div>
    <div class="metric-card">
      <div class="label">Gross Sales (Paid+)</div>
      <div class="value">${formatMoney(revenue, revenueCurrency)}</div>
      <div class="delta ok">Your item subtotal</div>
    </div>
  `;

  if (!myOrders.length) {
    recentEl.innerHTML = '<div class="empty-state" style="padding:1.5rem 0"><p>No orders yet. Once customers buy from your shop, orders appear here.</p></div>';
  } else {
    const statusMap = {
      pending_payment: 'status-pending',
      paid: 'status-paid',
      processing: 'status-paid',
      shipped: 'status-shipped',
      completed: 'status-completed',
      cancelled: 'status-cancelled',
      refunded: 'status-cancelled'
    };
    recentEl.innerHTML = myOrders.slice(0, 6).map(o => {
      const mine = (o.order_items || []).filter(oi => oi.seller_id === userId);
      const mineTotal = mine.reduce((s, oi) => s + oi.price_cents * oi.quantity, 0);
      return `
        <div class="order-card" style="background:var(--color-cream); margin-bottom:0.65rem">
          <div class="flex-between">
            <div>
              <strong>Order #${escapeHtml(o.order_number)}</strong>
              <div class="text-secondary" style="font-size:0.84rem">${mine.map(oi => escapeHtml(oi.product_name_snapshot) + ' ×' + oi.quantity).join(', ')}</div>
            </div>
            <div class="flex">
              <span class="status-chip ${statusMap[o.status] || 'status-pending'}">${escapeHtml(String(o.status).replace('_', ' '))}</span>
              <strong>${formatMoney(mineTotal, o.currency)}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  myShop = (shops && shops[0]) || null;
  if (myShop) {
    storefrontLink.href = 'seller-shop.html?slug=' + encodeURIComponent(myShop.slug);
    storefrontLink.style.display = 'inline-flex';
    document.getElementById('edit-shop-name').value = myShop.name || '';
    document.getElementById('edit-shop-location').value = myShop.location || '';
    document.getElementById('edit-shop-desc').value = myShop.description || '';
    document.getElementById('edit-shop-processing').value = myShop.processing_time || '';
    document.getElementById('edit-shop-shipping').value = myShop.shipping_info || '';
    document.getElementById('edit-shop-return').value = myShop.return_policy || '';
    document.getElementById('edit-shop-email').value = myShop.social_links?.email || '';
  }
}

async function loadNotifications() {
  const res = await apiFetch('/api/notifications');
  if (!res.ok) {
    notifsEl.innerHTML = '<p class="text-secondary">Could not load notifications.</p>';
    return;
  }
  const rows = res.data || [];
  const unreadCount = rows.filter(n => !n.read).length;
  notifBadgeEl.textContent = unreadCount + ' unread';
  if (!rows.length) {
    notifsEl.innerHTML = '<div class="empty-state" style="padding:1.5rem 0"><p>No notifications yet.</p></div>';
    return;
  }
  notifsEl.innerHTML = rows.slice(0, 8).map(n => `
    <div class="notification-item${n.read ? '' : ' unread'}">
      <div style="min-width:0">
        <div style="font-weight:700; font-size:0.92rem">${escapeHtml(n.title)}</div>
        <div class="text-secondary" style="font-size:0.85rem">${escapeHtml(n.body || '')}</div>
        <div class="text-secondary" style="font-size:0.78rem; margin-top:0.2rem">${formatDateTime(n.created_at)}</div>
      </div>
      <div class="flex" style="gap:0.35rem; flex-shrink:0">
        ${n.link ? `<a href="${escapeHtml(n.link.replace(/^\//, ''))}" class="btn btn-ghost btn-sm">Open</a>` : ''}
        ${!n.read ? `<button type="button" class="btn btn-outline btn-sm" data-read-notif="${n.id}">Mark read</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function loadInquiries() {
  const res = await apiFetch('/api/seller-inquiries');
  if (!res.ok) {
    inquiriesEl.innerHTML = '<p class="text-secondary">Unable to load buyer inquiries.</p>';
    return;
  }
  const rows = res.data || [];
  inqCountEl.textContent = rows.length + ' message' + (rows.length !== 1 ? 's' : '');
  if (!rows.length) {
    inquiriesEl.innerHTML = '<div class="empty-state" style="padding:1.5rem 0"><p>No buyer inquiries yet.</p></div>';
    return;
  }
  inquiriesEl.innerHTML = rows.slice(0, 8).map(inq => `
    <article class="admin-queue-card">
      <div class="flex-between">
        <strong>${escapeHtml(inq.subject)}</strong>
        <span class="text-secondary" style="font-size:0.8rem">${formatDateTime(inq.created_at)}</span>
      </div>
      <div class="text-secondary" style="font-size:0.84rem; margin-bottom:0.35rem">
        From ${escapeHtml(inq.profiles?.display_name || 'Shopper')}
        ${inq.products?.name ? ' · About ' + escapeHtml(inq.products.name) : ''}
      </div>
      <p style="margin:0; font-size:0.9rem; white-space:pre-wrap">${escapeHtml(inq.message)}</p>
    </article>
  `).join('');
}

notifsEl?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-read-notif]');
  if (!btn) return;
  btn.disabled = true;
  const res = await apiFetch('/api/notifications/' + encodeURIComponent(btn.dataset.readNotif) + '/read', { method: 'PATCH' });
  if (!res.ok) {
    btn.disabled = false;
    showToast(res.error, 'error');
    return;
  }
  loadNotifications();
});

settingsForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!myShop) return;
  const saveBtn = document.getElementById('shop-settings-save');
  saveBtn.disabled = true;
  const email = document.getElementById('edit-shop-email').value.trim();
  const payload = {
    name: document.getElementById('edit-shop-name').value.trim(),
    location: document.getElementById('edit-shop-location').value.trim(),
    description: document.getElementById('edit-shop-desc').value.trim(),
    processing_time: document.getElementById('edit-shop-processing').value.trim(),
    shipping_info: document.getElementById('edit-shop-shipping').value.trim(),
    return_policy: document.getElementById('edit-shop-return').value.trim(),
    social_links: email ? { ...(myShop.social_links || {}), email } : { ...(myShop.social_links || {}) }
  };
  const res = await apiFetch('/api/shops/' + encodeURIComponent(myShop.id), {
    method: 'PATCH',
    body: payload
  });
  saveBtn.disabled = false;
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  myShop = res.data;
  showToast('Storefront settings saved!');
});

// Auto-generate clean URL slug from shop name during onboarding
const onboardName = document.getElementById('shop-name');
const onboardSlug = document.getElementById('shop-slug');
let slugManuallyEdited = false;
onboardSlug?.addEventListener('input', () => { slugManuallyEdited = true; });
onboardName?.addEventListener('input', () => {
  if (!slugManuallyEdited && onboardSlug) {
    onboardSlug.value = onboardName.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }
});

const onboardForm = document.getElementById('onboard-form');
onboardForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('shop-name').value.trim();
  const slug = document.getElementById('shop-slug').value.trim().toLowerCase();
  const location = document.getElementById('shop-location').value.trim();
  const description = document.getElementById('shop-desc').value.trim();
  if (!name || !slug) {
    showToast('Shop name and URL slug are required.', 'error');
    return;
  }
  const btn = document.getElementById('onboard-submit');
  btn.disabled = true;
  const res = await apiFetch('/api/shops', {
    method: 'POST',
    body: { name, slug, location, description }
  });
  btn.disabled = false;
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  showToast('Shop created! Welcome to Seller Studio.');
  onboardEl.style.display = 'none';
  const { currentUser } = await import('/js/init.js');
  const updatedProfile = await getCurrentProfile(true);
  renderAuthLinks(currentUser, updatedProfile);
  showSellerWorkspace(true);
  if (currentUser) {
    loadStatsAndShop(currentUser.id);
    loadNotifications();
    loadInquiries();
  }
});

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);

  if (!user) {
    requireAuthEl.style.display = 'block';
    onboardEl.style.display = 'none';
    pendingPanel.style.display = 'none';
    showSellerWorkspace(false);
    updateCartCount(0);
    return;
  }

  requireAuthEl.style.display = 'none';
  refreshCartCount();

  const role = profile?.role || 'buyer';
  if (role === 'admin') {
    window.location.replace('admin.html');
    return;
  }

  const approval = profile?.approval_status || 'pending';
  if (approval !== 'approved') {
    onboardEl.style.display = 'none';
    showSellerWorkspace(false);
    pendingPanel.style.display = 'block';
    document.getElementById('seller-account-pending-copy').textContent = approval === 'rejected'
      ? 'Your account application was not approved. Please contact support if you believe this is an error.'
      : 'Your account needs administrator approval before you can open a shop or place orders.';
    return;
  }

  pendingPanel.style.display = 'none';
  if (role === 'buyer') {
    showSellerWorkspace(false);
    onboardEl.style.display = 'block';
    return;
  }

  onboardEl.style.display = 'none';
  showSellerWorkspace(true);
  loadStatsAndShop(user.id);
  loadNotifications();
  loadInquiries();
});

checkDbStatus();
