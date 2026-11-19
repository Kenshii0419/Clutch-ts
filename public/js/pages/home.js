// Homepage: featured products, categories, featured local shops, and recently added creations
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  escapeHtml,
  checkDbStatus,
  categoryIconSvg,
  renderProductCard,
  fetchUserFavoritesSet,
  wireFavoriteButtons
} from '/js/ui.js';
import { renderAuthLinks, refreshCartCount } from '/js/nav.js';

const featuredGrid = document.getElementById('featured-grid');
const categoryGrid = document.getElementById('category-grid');
const shopsGrid = document.getElementById('featured-shops-grid');
const recentGrid = document.getElementById('recent-grid');
const recentSection = document.getElementById('recent-section');
const featuredSort = document.getElementById('featured-sort');
const categorySort = document.getElementById('category-sort');

let allProducts = [];
let categoryRows = [];
let favoritedIds = new Set();

function compareValues(a, b, key, dir) {
  let av = a[key], bv = b[key];
  if (key === 'created_at') { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
  if (typeof av === 'string') av = av.toLowerCase();
  if (typeof bv === 'string') bv = bv.toLowerCase();
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
}

function sortProducts(rows, mode) {
  const list = rows.slice();
  if (mode === 'oldest') list.sort((a, b) => compareValues(a, b, 'created_at', 1));
  else if (mode === 'alpha-asc') list.sort((a, b) => compareValues(a, b, 'name', 1));
  else if (mode === 'alpha-desc') list.sort((a, b) => compareValues(a, b, 'name', -1));
  else if (mode === 'price-asc') list.sort((a, b) => compareValues(a, b, 'price_cents', 1));
  else if (mode === 'price-desc') list.sort((a, b) => compareValues(a, b, 'price_cents', -1));
  else list.sort((a, b) => compareValues(a, b, 'created_at', -1));
  return list;
}

function sortCategories(rows, mode) {
  const list = rows.slice();
  if (mode === 'newest') list.sort((a, b) => compareValues(a, b, 'created_at', -1));
  else if (mode === 'alpha-desc') list.sort((a, b) => compareValues(a, b, 'name', -1));
  else list.sort((a, b) => compareValues(a, b, 'name', 1));
  return list;
}

function renderFeatured() {
  if (!featuredGrid) return;
  if (!allProducts.length) {
    featuredGrid.innerHTML = `
      <div class="empty-state content-box" style="grid-column:1/-1">
        <h3>No published listings yet</h3>
        <p>Be among the first Iloilo makers to share your handmade creations.</p>
        <a href="seller-dashboard.html" class="btn btn-primary">Start Selling</a>
      </div>`;
    return;
  }
  const featured = sortProducts(allProducts.slice(0, 8), featuredSort?.value || 'newest');
  featuredGrid.innerHTML = featured.map(p => renderProductCard(p, { favoritedIds })).join('');
}

function renderRecent() {
  if (!recentGrid || !recentSection) return;
  if (!allProducts.length) {
    recentSection.style.display = 'none';
    return;
  }
  recentSection.style.display = '';
  const recent = allProducts.length > 8 ? allProducts.slice(8, 12) : allProducts.slice(0, 4);
  recentGrid.innerHTML = recent.map(p => renderProductCard(p, { favoritedIds })).join('');
}

function renderCategories() {
  if (!categoryGrid) return;
  if (!categoryRows.length) {
    categoryGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Categories coming soon.</p></div>';
    return;
  }
  categoryGrid.innerHTML = sortCategories(categoryRows, categorySort?.value || 'alpha-asc').map(c => `
    <a href="shop.html?category=${encodeURIComponent(c.slug)}" class="category-card">
      <div class="category-card-icon" aria-hidden="true">${categoryIconSvg(c.slug)}</div>
      <div class="category-card-content">
        <h3>${escapeHtml(c.name)}</h3>
        <p>${escapeHtml(c.description || 'Explore handmade items')}</p>
      </div>
      <svg class="category-card-arrow" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M7.5 15L12.5 10L7.5 5"/>
      </svg>
    </a>
  `).join('');
}

async function loadProducts() {
  if (!supabase || !featuredGrid) return;
  featuredGrid.innerHTML = '<div class="skeleton-lg" style="grid-column:1/-1"></div>';
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_images(*), categories(name, slug), shops(id, name, slug, location)')
      .eq('status', 'published')
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false })
      .limit(16);
    if (error) throw error;
    allProducts = data || [];
    renderFeatured();
    renderRecent();
  } catch (err) {
    featuredGrid.innerHTML = '<div class="empty-state content-box" style="grid-column:1/-1"><h3>Unable to load creations</h3><p>' + escapeHtml(err.message) + '</p></div>';
  }
}

async function loadCategories() {
  if (!supabase || !categoryGrid) return;
  try {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) throw error;
    categoryRows = data || [];
    renderCategories();
  } catch (_) {
    categoryGrid.innerHTML = '<p class="text-secondary">Categories could not be loaded.</p>';
  }
}

async function loadFeaturedShops() {
  if (!supabase || !shopsGrid) return;
  shopsGrid.innerHTML = '<div class="skeleton-lg" style="grid-column:1/-1"></div>';
  try {
    const { data, error } = await supabase
      .from('shops')
      .select('id, name, slug, description, location, logo_url, profiles:public_profiles(display_name, avatar_url)')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(6);
    if (error) throw error;
    const shops = data || [];
    if (!shops.length) {
      shopsGrid.innerHTML = `
        <div class="empty-state content-box" style="grid-column:1/-1">
          <h3>Maker shops are opening soon</h3>
          <p>Are you an artist or craftsperson in Iloilo? Open your storefront today.</p>
          <a href="seller-dashboard.html" class="btn btn-primary">Open a Maker Shop</a>
        </div>`;
      return;
    }
    shopsGrid.innerHTML = shops.map(shop => {
      const avatar = shop.logo_url || shop.profiles?.avatar_url || '/images/YouMadeIt_-removebg-preview.png';
      return `
        <article class="shop-card">
          <div class="shop-card-head">
            <img src="${escapeHtml(avatar)}" alt="${escapeHtml(shop.name)}" class="shop-avatar" loading="lazy" onerror="this.src='/images/YouMadeIt_-removebg-preview.png'">
            <div style="min-width:0">
              <h3 style="margin:0; font-size:1.1rem">${escapeHtml(shop.name)}</h3>
              <div class="text-secondary" style="font-size:0.86rem">by ${escapeHtml(shop.profiles?.display_name || 'Local Maker')}</div>
            </div>
          </div>
          ${shop.location ? `<div><span class="shop-location-pill">${escapeHtml(shop.location)}</span></div>` : ''}
          <p class="text-secondary" style="font-size:0.9rem; margin:0; flex:1">${escapeHtml(shop.description || 'Handmade goods crafted with care in small batches.')}</p>
          <div>
            <a href="seller-shop.html?slug=${encodeURIComponent(shop.slug)}" class="btn btn-outline btn-sm">Visit storefront &rarr;</a>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    shopsGrid.innerHTML = '<div class="empty-state content-box" style="grid-column:1/-1"><p>' + escapeHtml(err.message) + '</p></div>';
  }
}

if (featuredSort) featuredSort.addEventListener('change', renderFeatured);
if (categorySort) categorySort.addEventListener('change', renderCategories);

wireFavoriteButtons(document, {
  favoritedIds,
  onChange: () => {}
});

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  refreshCartCount();
  if (user) {
    favoritedIds = await fetchUserFavoritesSet();
    if (allProducts.length) {
      renderFeatured();
      renderRecent();
    }
  } else {
    favoritedIds = new Set();
  }
});

checkDbStatus();
loadProducts();
loadCategories();
loadFeaturedShops();
