// Public seller storefront page
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  escapeHtml,
  escapeAttr,
  renderStars,
  showToast,
  apiFetch,
  checkDbStatus,
  renderProductCard,
  fetchUserFavoritesSet,
  wireFavoriteButtons
} from '/js/ui.js';
import { renderAuthLinks, refreshCartCount } from '/js/nav.js';

const slug = new URLSearchParams(window.location.search).get('slug');
const loadingEl = document.getElementById('shop-loading');
const contentEl = document.getElementById('shop-content');
const notFoundEl = document.getElementById('shop-not-found');
const catPillsEl = document.getElementById('shop-category-pills');
const gridEl = document.getElementById('shop-products');
const countEl = document.getElementById('shop-product-count');

let shopData = null;
let shopProducts = [];
let activeCategory = '';
let favoritedIds = new Set();

function renderShopProducts() {
  const filtered = activeCategory
    ? shopProducts.filter(p => p.categories?.slug === activeCategory)
    : shopProducts;

  if (countEl) {
    countEl.textContent = filtered.length + ' creation' + (filtered.length !== 1 ? 's' : '');
  }
  if (!filtered.length) {
    gridEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><h3>No listings in this view</h3><p>This maker will publish new creations soon.</p></div>';
    return;
  }
  gridEl.innerHTML = filtered.map(p => renderProductCard(
    { ...p, shops: { name: shopData.name, slug: shopData.slug } },
    { favoritedIds }
  )).join('');
}

function renderShopCategories() {
  const seen = new Map();
  for (const p of shopProducts) {
    if (p.categories?.slug && p.categories?.name) {
      seen.set(p.categories.slug, p.categories.name);
    }
  }
  if (seen.size <= 1) {
    catPillsEl.style.display = 'none';
    return;
  }
  catPillsEl.style.display = 'flex';
  let html = `<button type="button" class="cat-pill${!activeCategory ? ' active' : ''}" data-cat="">All (${shopProducts.length})</button>`;
  for (const [cSlug, cName] of seen.entries()) {
    html += `<button type="button" class="cat-pill${activeCategory === cSlug ? ' active' : ''}" data-cat="${escapeAttr(cSlug)}">${escapeHtml(cName)}</button>`;
  }
  catPillsEl.innerHTML = html;
}

async function loadShopRating(products) {
  const ids = products.map(p => p.id);
  if (!ids.length) return;
  try {
    const { data } = await supabase.from('reviews').select('rating').in('product_id', ids);
    const revs = data || [];
    if (!revs.length) return;
    const avg = revs.reduce((s, r) => s + r.rating, 0) / revs.length;
    document.getElementById('shop-rating').innerHTML = `${renderStars(avg, true)} · ${revs.length} review${revs.length !== 1 ? 's' : ''}`;
  } catch (_) {}
}

async function loadShop() {
  if (!slug) {
    loadingEl.style.display = 'none';
    notFoundEl.style.display = 'block';
    return;
  }
  const { data: shop, error } = await supabase
    .from('shops')
    .select('*, profiles:public_profiles(*)')
    .eq('slug', slug)
    .single();

  loadingEl.style.display = 'none';
  if (error || !shop) {
    notFoundEl.style.display = 'block';
    return;
  }

  shopData = shop;
  contentEl.style.display = 'block';
  document.title = shop.name + ' — YouMadeIt';
  document.getElementById('shop-name').textContent = shop.name;
  document.getElementById('shop-seller').textContent = 'by ' + (shop.profiles?.display_name || 'Local Maker');
  document.getElementById('shop-desc').textContent = shop.description || shop.profiles?.bio || 'Handcrafted goods made with care.';
  document.getElementById('shop-processing-text').textContent = shop.processing_time || '1–3 business days';
  document.getElementById('shop-shipping-text').textContent = shop.shipping_info || 'Local Iloilo delivery & nationwide shipping';
  document.getElementById('shop-return-text').textContent = shop.return_policy || 'Contact the shop within 7 days for item concerns';

  const locEl = document.getElementById('shop-location');
  if (shop.location) {
    locEl.textContent = shop.location;
    locEl.style.display = 'inline-flex';
  }
  const logoEl = document.getElementById('shop-logo');
  logoEl.src = shop.logo_url || shop.profiles?.avatar_url || '/images/YouMadeIt_-removebg-preview.png';
  logoEl.onerror = () => { logoEl.src = '/images/YouMadeIt_-removebg-preview.png'; };

  const bannerImgWrap = document.getElementById('shop-banner-img');
  if (shop.banner_url) {
    bannerImgWrap.style.display = 'block';
    bannerImgWrap.innerHTML = `<img src="${escapeAttr(shop.banner_url)}" alt="${escapeAttr(shop.name)} banner" style="width:100%;max-height:220px;object-fit:cover;border-radius:var(--radius-md);border:2px solid var(--border)">`;
  }

  const { data: products } = await supabase
    .from('products')
    .select('*, product_images(*), categories(name, slug)')
    .eq('shop_id', shop.id)
    .eq('status', 'published')
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: false });

  shopProducts = products || [];
  renderShopCategories();
  renderShopProducts();
  loadShopRating(shopProducts);
}

catPillsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-pill[data-cat]');
  if (!btn) return;
  activeCategory = btn.dataset.cat || '';
  renderShopCategories();
  renderShopProducts();
});

document.getElementById('share-link')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Shop link copied!');
  } catch (_) {
    showToast('Copy the URL from the address bar to share this shop.', 'info');
  }
});

const inqPanel = document.getElementById('shop-inquiry-panel');
document.getElementById('shop-message-btn')?.addEventListener('click', async () => {
  const { currentUser } = await import('/js/init.js');
  if (!currentUser) {
    window.location.href = 'login.html?next=' + encodeURIComponent('seller-shop.html?slug=' + (slug || ''));
    return;
  }
  inqPanel.style.display = inqPanel.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('shop-inq-cancel')?.addEventListener('click', () => {
  inqPanel.style.display = 'none';
});
document.getElementById('shop-inq-send')?.addEventListener('click', async () => {
  const subject = document.getElementById('shop-inq-subject').value.trim();
  const message = document.getElementById('shop-inq-message').value.trim();
  if (!subject || !message) {
    showToast('Please enter both a subject and message.', 'error');
    return;
  }
  const btn = document.getElementById('shop-inq-send');
  btn.disabled = true;
  const res = await apiFetch('/api/seller-inquiries', {
    method: 'POST',
    body: { shop_id: shopData.id, subject, message }
  });
  btn.disabled = false;
  if (!res.ok) {
    showToast(res.error, 'error');
    return;
  }
  showToast('Message sent to ' + shopData.name + '!');
  document.getElementById('shop-inq-subject').value = '';
  document.getElementById('shop-inq-message').value = '';
  inqPanel.style.display = 'none';
});

wireFavoriteButtons(document, { favoritedIds });

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  refreshCartCount();
  if (user) {
    favoritedIds = await fetchUserFavoritesSet();
    if (shopData) renderShopProducts();
  } else {
    favoritedIds = new Set();
  }
});

checkDbStatus();
loadShop();
