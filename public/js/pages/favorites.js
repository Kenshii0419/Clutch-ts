// Favorites page
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  checkDbStatus,
  renderProductCard,
  wireFavoriteButtons
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const grid = document.getElementById('fav-grid');
const emptyEl = document.getElementById('fav-empty');
const loadingEl = document.getElementById('fav-loading');
const requireLoginEl = document.getElementById('fav-require-login');
const contentBox = document.getElementById('fav-content-box');
const sortSelect = document.getElementById('fav-sort');
const sortWrap = document.getElementById('fav-sort-wrap');

let favRows = [];
let favoritedIds = new Set();

function cmp(a, b, key, dir) {
  let av = a[key], bv = b[key];
  if (typeof av === 'string') av = av.toLowerCase();
  if (typeof bv === 'string') bv = bv.toLowerCase();
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
}

function sortedFav(rows, mode) {
  const list = rows
    .map(r => ({
      favId: r.id,
      p: r.products,
      _name: r.products?.name || '',
      _price: r.products?.price_cents || 0,
      _saved: r.created_at || ''
    }))
    .filter(x => x.p && x.p.status === 'published' && x.p.moderation_status === 'approved');

  if (mode === 'saved-asc') list.sort((a, b) => cmp(a, b, '_saved', 1));
  else if (mode === 'alpha-asc') list.sort((a, b) => cmp(a, b, '_name', 1));
  else if (mode === 'price-asc') list.sort((a, b) => cmp(a, b, '_price', 1));
  else if (mode === 'price-desc') list.sort((a, b) => cmp(a, b, '_price', -1));
  else list.sort((a, b) => cmp(a, b, '_saved', -1));
  return list;
}

function renderFavorites() {
  const rows = sortedFav(favRows, sortSelect?.value || 'saved-desc');
  if (!rows.length) {
    if (contentBox) contentBox.style.display = 'none';
    if (sortWrap) sortWrap.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  if (sortWrap) sortWrap.style.display = 'inline-flex';
  if (contentBox) contentBox.style.display = 'block';
  favoritedIds = new Set(rows.map(x => x.p.id));
  grid.innerHTML = rows.map(x => renderProductCard(x.p, { favoritedIds })).join('');
}

async function loadFavorites(userId) {
  const { data, error } = await supabase
    .from('favorites')
    .select('id, created_at, products(*, product_images(url, is_main), categories(name, slug), shops(name, slug))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  loadingEl.style.display = 'none';
  if (error || !data) {
    favRows = [];
    renderFavorites();
    return;
  }
  favRows = data;
  renderFavorites();
}

wireFavoriteButtons(document, {
  onChange: (productId, active) => {
    if (!active) {
      favRows = favRows.filter(r => r.products?.id !== productId);
      renderFavorites();
    }
  }
});

if (sortSelect) sortSelect.addEventListener('change', renderFavorites);

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  if (!user) {
    requireLoginEl.style.display = 'block';
    loadingEl.style.display = 'none';
    if (contentBox) contentBox.style.display = 'none';
    if (sortWrap) sortWrap.style.display = 'none';
    emptyEl.style.display = 'none';
    updateCartCount(0);
    return;
  }
  requireLoginEl.style.display = 'none';
  refreshCartCount();
  loadFavorites(user.id);
});

checkDbStatus();
