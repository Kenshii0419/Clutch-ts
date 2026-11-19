// Product catalog: search, category pills, filters, popularity sorting, pagination
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  escapeHtml,
  escapeAttr,
  checkDbStatus,
  renderProductCard,
  fetchUserFavoritesSet,
  wireFavoriteButtons
} from '/js/ui.js';
import { renderAuthLinks, refreshCartCount } from '/js/nav.js';

const grid = document.getElementById('shop-grid');
const paginationEl = document.getElementById('shop-pagination');
const resultsMetaEl = document.getElementById('shop-results-meta');
const form = document.getElementById('search-form');
const qInput = document.getElementById('search-q');
const clearBtn = document.getElementById('clear-search');
const categoryPillsEl = document.getElementById('category-pills');
const filtersPanel = document.getElementById('filters-panel');
const filtersContent = document.getElementById('filters-content');
const activeFiltersEl = document.getElementById('active-filters');
const toggleFilters = document.getElementById('toggle-filters');
const applyFilters = document.getElementById('apply-filters');
const resetFilters = document.getElementById('reset-filters');
const shopSort = document.getElementById('shop-sort');

const PAGE_SIZE = 20;
let state = {
  q: '', category: '', shop: '', min: '', max: '', availability: 'all', sort: 'newest', page: 1
};
let categories = [];
let favoritedIds = new Set();
let lastItems = [];

function paramsFromState() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category) p.set('category', state.category);
  if (state.shop) p.set('shop', state.shop);
  if (state.min) p.set('min', state.min);
  if (state.max) p.set('max', state.max);
  if (state.availability !== 'all') p.set('availability', state.availability);
  if (state.sort !== 'newest') p.set('sort', state.sort);
  if (state.page > 1) p.set('page', state.page);
  return p;
}

function pushState() {
  const qs = paramsFromState().toString();
  window.history.pushState(null, '', qs ? ('?' + qs) : 'shop.html');
}

function readParams() {
  const p = new URLSearchParams(window.location.search);
  state.q = p.get('q') || '';
  state.category = p.get('category') || '';
  state.shop = p.get('shop') || '';
  state.min = p.get('min') || '';
  state.max = p.get('max') || '';
  state.availability = p.get('availability') || 'all';
  state.sort = p.get('sort') || 'newest';
  state.page = Math.max(1, parseInt(p.get('page'), 10) || 1);
  if (qInput) qInput.value = state.q;
  if (shopSort) shopSort.value = state.sort;
}

function renderCategoryPills() {
  if (!categoryPillsEl) return;
  const allActive = !state.category ? ' active' : '';
  let html = `<button type="button" class="cat-pill${allActive}" data-cat="">All Creations</button>`;
  html += categories.map(c => {
    const active = state.category === c.slug ? ' active' : '';
    return `<button type="button" class="cat-pill${active}" data-cat="${escapeAttr(c.slug)}">${escapeHtml(c.name)}</button>`;
  }).join('');
  categoryPillsEl.innerHTML = html;
}

function renderFilters() {
  if (!filtersContent) return;
  let html = '<div class="form-group" style="margin:0"><label for="f-category">Category</label><select id="f-category" class="form-select"><option value="">All categories</option>' +
    categories.map(c => '<option value="' + escapeAttr(c.slug) + '">' + escapeHtml(c.name) + '</option>').join('') +
    '</select></div>';
  html += '<div class="form-group" style="margin:0"><label>Price range (₱)</label>' +
    '<div class="flex" style="gap:0.5rem; flex-wrap:nowrap">' +
    '<input type="number" id="f-min" name="min" class="form-input" min="0" placeholder="Min ₱">' +
    '<input type="number" id="f-max" name="max" class="form-input" min="0" placeholder="Max ₱">' +
    '</div></div>';
  html += '<div class="form-group" style="margin:0"><label for="f-availability">Availability</label><select id="f-availability" class="form-select">' +
    '<option value="all">All items</option><option value="available">In stock only</option><option value="soldout">Sold out</option></select></div>';
  filtersContent.innerHTML = html;
  document.getElementById('f-category').value = state.category;
  document.getElementById('f-min').value = state.min;
  document.getElementById('f-max').value = state.max;
  document.getElementById('f-availability').value = state.availability;
}

async function loadCategories() {
  try {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) throw error;
    categories = data || [];
    renderCategoryPills();
    renderFilters();
  } catch (_) {
    if (filtersContent) filtersContent.innerHTML = '<p class="text-secondary">Unable to load categories.</p>';
  }
}

function renderActiveFilters() {
  const chips = [];
  if (state.q) chips.push({ key: 'q', label: 'Search: ' + state.q });
  if (state.category) {
    const cat = categories.find(x => x.slug === state.category);
    chips.push({ key: 'category', label: 'Category: ' + (cat ? cat.name : state.category) });
  }
  if (state.shop) chips.push({ key: 'shop', label: 'Shop: ' + state.shop });
  if (state.min) chips.push({ key: 'min', label: 'Min ₱' + state.min });
  if (state.max) chips.push({ key: 'max', label: 'Max ₱' + state.max });
  if (state.availability !== 'all') {
    chips.push({ key: 'availability', label: state.availability === 'available' ? 'In stock only' : 'Sold out' });
  }

  if (!chips.length) {
    activeFiltersEl.style.display = 'none';
    activeFiltersEl.innerHTML = '';
    return;
  }
  activeFiltersEl.style.display = 'flex';
  activeFiltersEl.innerHTML = '<span style="font-size:0.86rem; font-weight:700">Active filters:</span> ' + chips.map(ch =>
    `<span class="badge badge-purple" style="gap:0.35rem">${escapeHtml(ch.label)} <button type="button" data-clear-filter="${escapeAttr(ch.key)}" aria-label="Remove filter" style="background:none;border:none;color:inherit;cursor:pointer;font-weight:800;padding:0 0.2rem">&times;</button></span>`
  ).join('');
}

function renderProductsList() {
  if (!lastItems.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h3>No matching handmade pieces</h3>
        <p>Try clearing a filter or searching for another material or craft.</p>
        <button type="button" class="btn btn-outline btn-sm" id="empty-reset-btn">Show all creations</button>
      </div>`;
    document.getElementById('empty-reset-btn')?.addEventListener('click', resetAllFilters);
    return;
  }
  grid.innerHTML = lastItems.map(p => renderProductCard(p, { favoritedIds })).join('');
}

function renderPagination(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }
  let html = `<span class="text-secondary" style="font-size:0.9rem">Page ${state.page} of ${totalPages} (${total} item${total !== 1 ? 's' : ''})</span><div class="flex">`;
  if (state.page > 1) html += `<button type="button" class="btn btn-outline btn-sm" data-page="${state.page - 1}">&larr; Prev</button>`;
  if (state.page < totalPages) html += `<button type="button" class="btn btn-outline btn-sm" data-page="${state.page + 1}">Next &rarr;</button>`;
  html += '</div>';
  paginationEl.innerHTML = html;
}

async function loadProducts() {
  grid.innerHTML = '<div class="skeleton-lg" style="grid-column:1/-1"></div>';
  paginationEl.innerHTML = '';
  renderCategoryPills();
  renderActiveFilters();

  try {
    const query = new URLSearchParams();
    if (state.q) query.set('q', state.q);
    if (state.category) query.set('category', state.category);
    if (state.shop) query.set('shop', state.shop);
    if (state.min) query.set('min', state.min);
    if (state.max) query.set('max', state.max);
    if (state.availability !== 'all') query.set('availability', state.availability);
    query.set('sort', state.sort);
    query.set('page', String(state.page));
    query.set('limit', String(PAGE_SIZE));

    const res = await fetch('/api/products?' + query.toString());
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Could not load products');

    lastItems = payload.items || [];
    const total = Number(payload.total || 0);
    if (resultsMetaEl) {
      resultsMetaEl.textContent = total === 1 ? 'Showing 1 handmade creation' : `Showing ${lastItems.length} of ${total} handmade creations`;
    }
    renderProductsList();
    renderPagination(total);
  } catch (err) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><h3>Unable to load products</h3><p>' + escapeHtml(err.message) + '</p></div>';
  }
}

function resetAllFilters() {
  state = { q: '', category: '', shop: '', min: '', max: '', availability: 'all', sort: 'newest', page: 1 };
  if (qInput) qInput.value = '';
  if (shopSort) shopSort.value = 'newest';
  renderFilters();
  pushState();
  loadProducts();
}

if (categoryPillsEl) {
  categoryPillsEl.addEventListener('click', (e) => {
    const pill = e.target.closest('.cat-pill[data-cat]');
    if (!pill) return;
    state.category = pill.dataset.cat || '';
    state.page = 1;
    const fCat = document.getElementById('f-category');
    if (fCat) fCat.value = state.category;
    pushState();
    loadProducts();
  });
}

if (activeFiltersEl) {
  activeFiltersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clear-filter]');
    if (!btn) return;
    const key = btn.dataset.clearFilter;
    if (key === 'availability') state.availability = 'all';
    else state[key] = '';
    state.page = 1;
    if (key === 'q' && qInput) qInput.value = '';
    renderFilters();
    pushState();
    loadProducts();
  });
}

if (paginationEl) {
  paginationEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = parseInt(btn.dataset.page, 10) || 1;
    pushState();
    loadProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

toggleFilters?.addEventListener('click', () => {
  filtersPanel.style.display = filtersPanel.style.display === 'none' ? 'block' : 'none';
});

shopSort?.addEventListener('change', () => {
  state.sort = shopSort.value;
  state.page = 1;
  pushState();
  loadProducts();
});

applyFilters?.addEventListener('click', () => {
  state.category = document.getElementById('f-category').value;
  state.min = document.getElementById('f-min').value.trim();
  state.max = document.getElementById('f-max').value.trim();
  state.availability = document.getElementById('f-availability').value;
  state.page = 1;
  filtersPanel.style.display = 'none';
  pushState();
  loadProducts();
});

resetFilters?.addEventListener('click', () => {
  filtersPanel.style.display = 'none';
  resetAllFilters();
});

clearBtn?.addEventListener('click', resetAllFilters);

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = qInput.value.trim();
  state.page = 1;
  pushState();
  loadProducts();
});

wireFavoriteButtons(document, { favoritedIds });

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  refreshCartCount();
  if (user) {
    favoritedIds = await fetchUserFavoritesSet();
    if (lastItems.length) renderProductsList();
  } else {
    favoritedIds = new Set();
  }
});

readParams();
renderFilters();
window.addEventListener('popstate', () => { readParams(); renderFilters(); loadProducts(); });
checkDbStatus();
loadCategories();
loadProducts();
