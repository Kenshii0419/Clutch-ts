// Shared browser-inspired navigation header and marketplace footer — rendered on every page.
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import { escapeHtml } from '/js/ui.js';

export function updateCartCount(count) {
  const n = parseInt(count || 0, 10) || 0;
  document.querySelectorAll('.cart-count').forEach((el) => {
    el.textContent = n;
    el.style.display = n > 0 ? 'flex' : 'none';
    el.setAttribute('aria-label', n + ' item' + (n !== 1 ? 's' : '') + ' in cart');
  });
}

let currentPage = 'home';
let currentRole = 'buyer';
let currentAuthed = false;
let dropdownOpen = false;
let mobileMenuOpen = false;
let globalListenersWired = false;

const PUBLIC_LINKS = [
  { href: 'index.html', label: 'Home', page: 'home' },
  { href: 'shop.html', label: 'Shop', page: 'shop' },
  { href: 'favorites.html', label: 'Favorites', page: 'favorites' },
  { href: 'cart.html', label: 'Cart', page: 'cart' }
];

const AUTHD_LINKS = [
  { href: 'orders.html', label: 'Orders', page: 'orders', roles: ['buyer', 'seller', 'admin'] },
  { href: 'seller-dashboard.html', label: 'Seller Studio', page: 'seller', roles: ['buyer', 'seller'] },
  { href: 'admin.html', label: 'Admin', page: 'admin', roles: ['admin'] }
];

const DROPDOWN_ITEMS = [
  { href: 'profile.html', label: 'My Profile', page: 'profile', roles: ['buyer', 'seller', 'admin'] },
  { href: 'orders.html', label: 'My Orders', page: 'orders', roles: ['buyer', 'seller', 'admin'] },
  { href: 'favorites.html', label: 'Favorites', page: 'favorites', roles: ['buyer', 'seller', 'admin'] },
  { href: 'seller-dashboard.html', label: 'Seller Studio', page: 'seller', roles: ['buyer', 'seller'] },
  { href: 'seller-products.html', label: 'My Products', page: 'seller-products', roles: ['seller'] },
  { href: 'seller-orders.html', label: 'Shop Orders', page: 'seller-orders', roles: ['seller'] },
  { href: 'admin.html', label: 'Administration', page: 'admin', roles: ['admin'] }
];

function isAuthPage() {
  const name = location.pathname.split('/').pop() || '';
  return /^(login|register|reset-password)\.html$/.test(name);
}

function linkTag(link) {
  const active = currentPage === link.page ? ' active' : '';
  return '<a href="' + link.href + '" class="nav-link' + active + '">' + link.label + '</a>';
}

function cartLink() {
  const active = currentPage === 'cart' ? ' active' : '';
  return '<a href="cart.html" class="nav-link cart-badge' + active + '" aria-label="Shopping cart">' +
    '<svg class="cart-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
    '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' +
    '</svg>' +
    '<span>Cart</span>' +
    '<span class="cart-count" style="display:none">0</span>' +
    '</a>';
}

function navLinksHTML(authed, role) {
  let html = '';
  for (const link of PUBLIC_LINKS) {
    if (link.page === 'cart') {
      html += '<li>' + cartLink() + '</li>';
      continue;
    }
    html += '<li>' + linkTag(link) + '</li>';
  }
  if (authed) {
    for (const link of AUTHD_LINKS) {
      if (!link.roles.includes(role)) continue;
      html += '<li>' + linkTag(link) + '</li>';
    }
  }
  return html;
}

function dropdownHTML(role) {
  let items = '';
  for (const it of DROPDOWN_ITEMS) {
    if (!it.roles.includes(role)) continue;
    items += '<a href="' + it.href + '" class="dropdown-item' + (currentPage === it.page ? ' active' : '') + '">' + it.label + '</a>';
  }
  items += '<hr class="dropdown-divider">' +
    '<button type="button" class="dropdown-item signout-btn">Sign out</button>';
  return items;
}

function mobileMenuHTML(authed, role) {
  let html = '';
  for (const link of PUBLIC_LINKS) {
    html += '<li>' + linkTag(link) + '</li>';
  }
  if (authed) {
    for (const it of DROPDOWN_ITEMS) {
      if (!it.roles.includes(role)) continue;
      html += '<li><a href="' + it.href + '" class="' + (currentPage === it.page ? 'active' : '') + '">' + it.label + '</a></li>';
    }
    html += '<li><button type="button" class="signout-mobile">Sign out</button></li>';
  } else if (!isAuthPage()) {
    html += '<li><a href="login.html">Sign in</a></li>';
    html += '<li><a href="register.html">Create account</a></li>';
  }
  return html;
}

function currentRouteDisplay() {
  const file = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/i, '');
  const map = {
    index: 'youmadeit.ph/iloilo',
    shop: 'youmadeit.ph/iloilo/shop',
    product: 'youmadeit.ph/iloilo/creation',
    cart: 'youmadeit.ph/iloilo/cart',
    checkout: 'youmadeit.ph/iloilo/checkout',
    orders: 'youmadeit.ph/iloilo/orders',
    favorites: 'youmadeit.ph/iloilo/favorites',
    profile: 'youmadeit.ph/iloilo/profile',
    'seller-dashboard': 'youmadeit.ph/iloilo/studio',
    'seller-products': 'youmadeit.ph/iloilo/studio/products',
    'seller-orders': 'youmadeit.ph/iloilo/studio/orders',
    'seller-shop': 'youmadeit.ph/iloilo/makers',
    admin: 'youmadeit.ph/iloilo/admin'
  };
  return map[file] || ('youmadeit.ph/iloilo/' + file);
}

async function handleSignOut() {
  try { await supabase.auth.signOut(); } catch (_) {}
  window.location.href = 'index.html';
}

function closeAllMenus() {
  dropdownOpen = false;
  mobileMenuOpen = false;
  const dropdown = document.getElementById('account-dropdown');
  const menuBtn = document.getElementById('account-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileBtn = document.getElementById('mobile-menu-btn');
  if (dropdown) dropdown.style.display = 'none';
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  if (mobileMenu) mobileMenu.style.display = 'none';
  if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'false');
}

function wireHeaderInteractions(header) {
  const menuBtn = header.querySelector('#account-menu-btn');
  const dropdown = header.querySelector('#account-dropdown');
  const mobileBtn = header.querySelector('#mobile-menu-btn');
  const mobileMenu = header.querySelector('#mobile-menu');
  const searchForm = header.querySelector('#header-search-form');
  const backBtn = header.querySelector('#browser-back-btn');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = 'index.html';
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (header.querySelector('#header-search-input')?.value || '').trim();
      window.location.href = q ? 'shop.html?q=' + encodeURIComponent(q) : 'shop.html';
    });
  }

  if (menuBtn && dropdown) {
    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdownOpen = !dropdownOpen;
      dropdown.style.display = dropdownOpen ? 'block' : 'none';
      menuBtn.setAttribute('aria-expanded', dropdownOpen ? 'true' : 'false');
      if (dropdownOpen && mobileMenu) {
        mobileMenu.style.display = 'none';
        mobileMenuOpen = false;
        mobileBtn?.setAttribute('aria-expanded', 'false');
      }
    });
    dropdown.addEventListener('click', (e) => {
      if (e.target.closest('.signout-btn')) {
        e.preventDefault();
        handleSignOut();
      }
      e.stopPropagation();
    });
  }

  if (mobileBtn && mobileMenu) {
    mobileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      mobileMenuOpen = !mobileMenuOpen;
      mobileMenu.style.display = mobileMenuOpen ? 'block' : 'none';
      mobileBtn.setAttribute('aria-expanded', mobileMenuOpen ? 'true' : 'false');
      if (mobileMenuOpen && dropdown) {
        dropdown.style.display = 'none';
        dropdownOpen = false;
        menuBtn?.setAttribute('aria-expanded', 'false');
      }
    });
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.closest('.signout-mobile')) {
        e.preventDefault();
        handleSignOut();
      }
      e.stopPropagation();
    });
  }

  if (!globalListenersWired) {
    globalListenersWired = true;
    document.addEventListener('click', closeAllMenus);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllMenus();
    });
  }
}

export function renderFooter() {
  if (document.querySelector('.site-footer')) return;
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <div class="footer-logo">
            <img src="/images/YouMadeIt_-removebg-preview.png" alt="YouMadeIt" class="brand-logo" loading="lazy">
            <span class="footer-brand-name">YouMadeIt</span>
          </div>
          <p class="footer-description">Made by local hands. Shared with the community. Iloilo's cozy marketplace for independent artists, crafters, and handmade makers.</p>
          <span class="footer-local-pill">Iloilo, Philippines · Prices in PHP (₱)</span>
        </div>
        <div class="footer-links">
          <div class="footer-column">
            <h4>Marketplace</h4>
            <ul>
              <li><a href="shop.html">Shop All Creations</a></li>
              <li><a href="favorites.html">Saved Favorites</a></li>
              <li><a href="seller-dashboard.html">Become a Seller</a></li>
              <li><a href="seller-guidelines.html">Seller Guidelines</a></li>
            </ul>
          </div>
          <div class="footer-column">
            <h4>Customer Care</h4>
            <ul>
              <li><a href="cart.html">Shopping Cart</a></li>
              <li><a href="orders.html">My Orders</a></li>
              <li><a href="shipping.html">Shipping Info</a></li>
              <li><a href="returns.html">Returns &amp; Refunds</a></li>
              <li><a href="faq.html">FAQ</a></li>
              <li><a href="contact.html">Contact Support</a></li>
            </ul>
          </div>
          <div class="footer-column">
            <h4>Community</h4>
            <ul>
              <li><a href="about.html">Our Story</a></li>
              <li><a href="privacy.html">Privacy Policy</a></li>
              <li><a href="terms.html">Terms of Service</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; ${new Date().getFullYear()} YouMadeIt — Iloilo Handmade Community Marketplace.</p>
        <p class="footer-sandbox-note">Checkout uses sandbox test mode only — no live charges are processed.</p>
      </div>
    </div>
  `;
  document.body.appendChild(footer);
}

export function renderHeader({ currentPage: page, autoAuth = false } = {}) {
  if (page) currentPage = page;
  const existing = document.querySelector('.site-header');
  if (existing) existing.remove();

  const header = document.createElement('header');
  header.className = 'site-header';
  const currentQ = new URLSearchParams(window.location.search).get('q') || '';

  header.innerHTML = `
    <div class="browser-chrome">
      <div class="container browser-tabs-row">
        <div class="browser-left-group">
          <div class="browser-dots" aria-hidden="true">
            <span class="browser-dot dot-coral"></span>
            <span class="browser-dot dot-yellow"></span>
            <span class="browser-dot dot-sage"></span>
          </div>
          <a href="index.html" class="brand" aria-label="YouMadeIt Home">
            <img src="/images/YouMadeIt_-removebg-preview.png" alt="" class="brand-logo">
            <span class="brand-wordmark">
              <strong>YouMadeIt</strong>
              <small>Iloilo Makers</small>
            </span>
          </a>
        </div>
        <nav aria-label="Main navigation">
          <ul class="nav-list"></ul>
        </nav>
        <div class="nav-actions">
          <a href="cart.html" class="mobile-cart-shortcut" aria-label="Cart">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            <span class="cart-count" style="display:none">0</span>
          </a>
          <div class="auth-menu" id="auth-menu">
            <a href="login.html" class="btn btn-sm btn-outline header-signin-link" id="header-signin-link">Sign in</a>
            <button type="button" class="menu-btn" id="account-menu-btn" aria-haspopup="true" aria-expanded="false" style="display:none">Account</button>
            <div class="dropdown" id="account-dropdown"></div>
          </div>
          <button type="button" class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Open menu" aria-expanded="false">&#9776;</button>
        </div>
      </div>
      <div class="browser-address-strip">
        <div class="container browser-address-inner">
          <div class="browser-nav-controls" aria-hidden="false">
            <button type="button" class="browser-icon-btn" id="browser-back-btn" title="Go back" aria-label="Go back">&larr;</button>
            <a href="index.html" class="browser-icon-btn" title="Home" aria-label="Go to homepage">&#8962;</a>
          </div>
          <form class="browser-address-bar" id="header-search-form" role="search">
            <span class="address-prefix" aria-hidden="true">${escapeHtml(currentRouteDisplay())}</span>
            <input type="search" id="header-search-input" value="${escapeHtml(currentQ)}" placeholder="Search Iloilo crafts, pottery, woven goods…" aria-label="Search marketplace">
            <button type="submit" class="address-go-btn">Find</button>
          </form>
          <a href="shop.html" class="address-quick-pill">Browse all</a>
        </div>
      </div>
    </div>
    <ul class="mobile-menu" id="mobile-menu"></ul>
  `;

  document.body.insertBefore(header, document.body.firstChild);
  header.querySelector('.nav-list').innerHTML = navLinksHTML(false, 'buyer');
  header.querySelector('#mobile-menu').innerHTML = mobileMenuHTML(false, 'buyer');

  if (isAuthPage()) {
    const signInLink = header.querySelector('#header-signin-link');
    if (signInLink) signInLink.style.display = 'none';
  }

  wireHeaderInteractions(header);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderFooter, { once: true });
  } else {
    renderFooter();
  }

  if (autoAuth && !window._navAutoAuthBound) {
    window._navAutoAuthBound = true;
    onAuthState(async (e) => {
      const user = e.detail?.user || null;
      const profile = user ? await getCurrentProfile() : null;
      renderAuthLinks(user, profile);
      refreshCartCount();
    });
  }
  return header;
}

export function renderAuthLinks(user, profile) {
  const header = document.querySelector('.site-header');
  if (!header) return;

  currentRole = (profile && profile.role) ? profile.role : 'buyer';
  currentAuthed = !!user;

  const navList = header.querySelector('.nav-list');
  if (navList) navList.innerHTML = navLinksHTML(currentAuthed, currentRole);

  const menuBtn = header.querySelector('#account-menu-btn');
  const signInLink = header.querySelector('#header-signin-link');
  const dropdown = header.querySelector('#account-dropdown');
  const mobileMenu = header.querySelector('#mobile-menu');

  if (currentAuthed) {
    if (signInLink) signInLink.style.display = 'none';
    if (menuBtn) {
      const label = profile?.display_name ? profile.display_name.split(' ')[0] : 'Account';
      menuBtn.textContent = label + ' ▾';
      menuBtn.style.display = 'inline-flex';
    }
    if (dropdown) {
      dropdown.innerHTML = dropdownHTML(currentRole);
      dropdown.style.display = 'none';
    }
  } else {
    if (dropdown) {
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
    }
    if (menuBtn) menuBtn.style.display = 'none';
    if (signInLink) signInLink.style.display = isAuthPage() ? 'none' : 'inline-flex';
  }

  if (mobileMenu) {
    mobileMenu.innerHTML = mobileMenuHTML(currentAuthed, currentRole);
    mobileMenu.style.display = 'none';
  }
  closeAllMenus();
}

export async function refreshCartCount() {
  try {
    const { currentUser } = await import('/js/init.js');
    if (!currentUser) { updateCartCount(0); return; }
    const { data: cart } = await supabase.from('carts').select('id').eq('user_id', currentUser.id).maybeSingle();
    if (!cart) { updateCartCount(0); return; }
    const { data: items } = await supabase.from('cart_items').select('quantity').eq('cart_id', cart.id);
    updateCartCount(items ? items.reduce((s, i) => s + (i.quantity || 0), 0) : 0);
  } catch (_) {
    updateCartCount(0);
  }
}
