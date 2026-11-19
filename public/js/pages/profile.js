// Profile page: edit details, upload avatar with validation & preview, view notifications & admin messages
import { supabase, getCurrentProfile, clearProfileCache, onAuthState } from '/js/init.js';
import {
  formatDateTime,
  escapeHtml,
  showToast,
  apiFetch,
  checkDbStatus
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const cfg = window.SUPABASE_CONFIG || {};
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const form = document.getElementById('profile-form');
const wrap = document.getElementById('profile-wrap');
const requireLoginEl = document.getElementById('profile-require-login');
const approvalBannerEl = document.getElementById('profile-approval-banner');
const notifsListEl = document.getElementById('profile-notifications-list');

async function loadAdminMessages() {
  const list = document.getElementById('admin-messages-list');
  const res = await apiFetch('/api/account/admin-messages');
  if (!res.ok) {
    list.innerHTML = `<p class="text-secondary">${escapeHtml(res.error)}</p>`;
    return;
  }
  const messages = res.data || [];
  if (!messages.length) {
    list.innerHTML = '<div class="empty-state" style="padding:1.25rem 0"><p>No messages from administration.</p></div>';
    return;
  }
  list.innerHTML = messages.map(m => `
    <article class="admin-queue-card">
      <div class="admin-queue-head">
        <h4 style="margin:0">${escapeHtml(m.subject)}</h4>
        <span class="text-secondary" style="font-size:0.8rem">${formatDateTime(m.created_at)}</span>
      </div>
      <p class="admin-message-body">${escapeHtml(m.body)}</p>
      ${m.read_at
        ? '<span class="badge badge-success">Read</span>'
        : `<button type="button" class="btn btn-sm btn-outline" data-message-read="${m.id}">Mark as read</button>`}
    </article>
  `).join('');
}

async function loadNotifications() {
  const res = await apiFetch('/api/notifications');
  if (!res.ok) {
    notifsListEl.innerHTML = '<p class="text-secondary">Unable to load notifications.</p>';
    return;
  }
  const rows = res.data || [];
  if (!rows.length) {
    notifsListEl.innerHTML = '<div class="empty-state" style="padding:1.25rem 0"><p>No notifications yet.</p></div>';
    return;
  }
  notifsListEl.innerHTML = rows.slice(0, 8).map(n => `
    <div class="notification-item${n.read ? '' : ' unread'}">
      <div style="min-width:0">
        <strong style="font-size:0.92rem">${escapeHtml(n.title)}</strong>
        <div class="text-secondary" style="font-size:0.84rem">${escapeHtml(n.body || '')}</div>
        <div class="text-secondary" style="font-size:0.76rem;margin-top:0.2rem">${formatDateTime(n.created_at)}</div>
      </div>
      <div class="flex" style="gap:0.35rem;flex-shrink:0">
        ${n.link ? `<a href="${escapeHtml(n.link.replace(/^\//, ''))}" class="btn btn-ghost btn-sm">View</a>` : ''}
        ${!n.read ? `<button type="button" class="btn btn-outline btn-sm" data-read-notif="${n.id}">Read</button>` : ''}
      </div>
    </div>
  `).join('');
}

document.getElementById('admin-messages-list')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-message-read]');
  if (!button) return;
  button.disabled = true;
  const res = await apiFetch('/api/account/admin-messages/' + encodeURIComponent(button.dataset.messageRead) + '/read', { method: 'PATCH' });
  if (!res.ok) {
    button.disabled = false;
    showToast(res.error, 'error');
    return;
  }
  loadAdminMessages();
});

notifsListEl?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-read-notif]');
  if (!button) return;
  button.disabled = true;
  const res = await apiFetch('/api/notifications/' + encodeURIComponent(button.dataset.readNotif) + '/read', { method: 'PATCH' });
  if (!res.ok) {
    button.disabled = false;
    showToast(res.error, 'error');
    return;
  }
  loadNotifications();
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { currentUser } = await import('/js/init.js');
  if (!currentUser) return;
  const saveBtn = document.getElementById('profile-save-btn');
  saveBtn.disabled = true;

  const updates = {
    display_name: document.getElementById('profile-name').value.trim(),
    email: document.getElementById('profile-email').value.trim(),
    bio: document.getElementById('profile-bio').value.trim()
  };
  const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);
  saveBtn.disabled = false;
  if (error) {
    showToast('Could not save: ' + error.message, 'error');
    return;
  }
  clearProfileCache();
  const updated = await getCurrentProfile(true);
  renderAuthLinks(currentUser, updated);
  showToast('Profile saved!');
});

document.getElementById('profile-avatar-file')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    showToast('Please select a JPEG, PNG, or WebP image.', 'error');
    e.target.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Profile photo must be 2 MB or smaller.', 'error');
    e.target.value = '';
    return;
  }

  const { currentUser } = await import('/js/init.js');
  if (!currentUser) return;

  const avatarImg = document.getElementById('profile-avatar');
  const prevSrc = avatarImg.src;
  avatarImg.src = URL.createObjectURL(file);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `avatars/${currentUser.id}/${Date.now()}-${safeName}`;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(cfg.url + '/storage/v1/object/product-images/' + path, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + (session?.access_token || ''),
      'x-upsert': 'true',
      'Content-Type': file.type
    },
    body: file
  });
  if (!res.ok) {
    avatarImg.src = prevSrc;
    const txt = await res.text().catch(() => '');
    showToast('Upload failed: ' + (txt || res.statusText), 'error');
    return;
  }

  const url = cfg.url + '/storage/v1/object/public/product-images/' + path;
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', currentUser.id);
  if (error) {
    avatarImg.src = prevSrc;
    showToast('Could not save avatar URL: ' + error.message, 'error');
    return;
  }
  clearProfileCache();
  avatarImg.src = url;
  showToast('Profile photo updated!');
});

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile(true) : null;
  renderAuthLinks(user, profile);

  if (!user) {
    requireLoginEl.style.display = 'block';
    wrap.style.display = 'none';
    updateCartCount(0);
    return;
  }

  requireLoginEl.style.display = 'none';
  wrap.style.display = 'block';
  refreshCartCount();

  const p = profile || {};
  document.getElementById('profile-name').value = p.display_name || '';
  document.getElementById('profile-email').value = p.email || user.email || '';
  document.getElementById('profile-bio').value = p.bio || '';
  document.getElementById('profile-role').textContent = p.role || 'buyer';

  const approvalStatus = p.approval_status || 'pending';
  const badge = document.getElementById('profile-approval-status');
  badge.textContent = approvalStatus;
  badge.className = 'badge ' + (approvalStatus === 'approved' ? 'badge-success' : approvalStatus === 'rejected' ? 'badge-coral' : 'badge-outline');

  if (p.role !== 'admin' && approvalStatus !== 'approved') {
    approvalBannerEl.style.display = 'block';
    approvalBannerEl.innerHTML = approvalStatus === 'rejected'
      ? '<strong>Account application not approved:</strong> Please reach out via our <a href="contact.html">Contact page</a> if you need help.'
      : '<strong>Approval pending:</strong> An administrator reviews new accounts before shopping, favorites, and seller shop features unlock.';
  } else {
    approvalBannerEl.style.display = 'none';
  }

  document.getElementById('stat-member').textContent = p.created_at
    ? new Date(p.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short' })
    : '—';

  const avatar = document.getElementById('profile-avatar');
  avatar.src = p.avatar_url || '/images/YouMadeIt_-removebg-preview.png';
  avatar.onerror = () => { avatar.src = '/images/YouMadeIt_-removebg-preview.png'; };

  try {
    const [{ data: orders }, { data: favs }] = await Promise.all([
      supabase.from('orders').select('id').eq('buyer_id', user.id),
      supabase.from('favorites').select('id').eq('user_id', user.id)
    ]);
    document.getElementById('stat-orders').textContent = String((orders || []).length);
    document.getElementById('stat-favorites').textContent = String((favs || []).length);
  } catch (_) {}

  loadNotifications();
  loadAdminMessages();
});

checkDbStatus();
