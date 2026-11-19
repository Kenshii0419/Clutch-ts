// Product detail page: gallery, inventory-safe cart & buy-now, maker inquiry, reviews, reporting, related products
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  formatDateTime,
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

const params = new URLSearchParams(window.location.search);
const productId = params.get('id');

const loadingEl = document.getElementById('product-loading');
const contentEl = document.getElementById('product-content');
const notFoundEl = document.getElementById('product-not-found');

let currentProduct = null;
let favoritedIds = new Set();

function renderGallery(product) {
  const images = (product.product_images || [])
    .filter(img => img.url)
    .sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0) || (a.sort_order || 0) - (b.sort_order || 0));

  const mainEl = document.getElementById('product-gallery-main');
  const thumbEl = document.getElementById('product-gallery-thumbs');

  const setMain = (idx) => {
    const chosen = images[idx];
    const url = chosen ? chosen.url : '/images/placeholder.svg';
    mainEl.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(product.name)}" style="width:100%;height:100%;object-fit:cover" onerror="this.src='/images/placeholder.svg'">`;
    thumbEl.querySelectorAll('.gallery-thumb').forEach((btn, i) => {
      btn.classList.toggle('active', i === idx);
    });
  };

  if (!images.length) {
    setMain(-1);
    thumbEl.innerHTML = '';
    return;
  }

  thumbEl.innerHTML = images.length > 1
    ? images.map((img, i) => `
        <button type="button" class="gallery-thumb${i === 0 ? ' active' : ''}" data-img-index="${i}" aria-label="View image ${i + 1}">
          <img src="${escapeAttr(img.url)}" alt="" loading="lazy" onerror="this.src='/images/placeholder.svg'">
        </button>
      `).join('')
    : '';

  thumbEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.gallery-thumb[data-img-index]');
    if (!btn) return;
    setMain(parseInt(btn.dataset.imgIndex, 10) || 0);
  });

  setMain(0);
}

function renderAttributes(p) {
  const attrs = [];
  if (p.materials) attrs.push({ label: 'Materials', value: p.materials });
  if (p.dimensions) attrs.push({ label: 'Dimensions', value: p.dimensions });
  if (p.weight) attrs.push({ label: 'Weight', value: p.weight });
  if (p.color) attrs.push({ label: 'Color', value: p.color });
  if (p.style) attrs.push({ label: 'Style', value: p.style });
  if (p.personalization) attrs.push({ label: 'Personalization', value: p.personalization });
  if (p.processing_time) attrs.push({ label: 'Processing time', value: p.processing_time });
  if (p.shipping_info) attrs.push({ label: 'Shipping', value: p.shipping_info });

  const attrEl = document.getElementById('product-attrs');
  if (!attrs.length) {
    attrEl.innerHTML = '<p class="text-secondary" style="margin:0; font-size:0.9rem">Handmade in small batches. Message the maker if you have custom requests!</p>';
    return;
  }
  attrEl.innerHTML = '<h4 style="margin:0 0 0.6rem">Craft Details</h4>' + attrs.map(a => `
    <div style="display:flex;justify-content:space-between;padding:0.48rem 0;border-bottom:1px dashed var(--border);gap:1rem;font-size:0.9rem">
      <span class="text-secondary" style="font-weight:700">${escapeHtml(a.label)}</span>
      <span style="text-align:right;max-width:65%">${escapeHtml(a.value)}</span>
    </div>`).join('');
}

function renderActions(p) {
  const stock = p.quantity == null ? 0 : Number(p.quantity);
  const isAvailable = p.status === 'published' && p.moderation_status === 'approved' && stock > 0;
  const isFav = favoritedIds.has(p.id);
  const actionsDiv = document.getElementById('product-actions');

  actionsDiv.innerHTML = `
    <div class="flex" style="gap:0.75rem; align-items:center;">
      <div class="qty-stepper" aria-label="Quantity selector">
        <button type="button" id="qty-dec" aria-label="Decrease quantity" ${!isAvailable ? 'disabled' : ''}>&minus;</button>
        <input type="number" id="product-qty" value="1" min="1" max="${Math.max(1, stock)}" ${!isAvailable ? 'disabled' : ''} aria-label="Quantity">
        <button type="button" id="qty-inc" aria-label="Increase quantity" ${!isAvailable ? 'disabled' : ''}>+</button>
      </div>
      ${isAvailable
        ? `<button type="button" id="product-add-cart" class="btn btn-primary">Add to Cart</button>
           <button type="button" id="product-buy-now" class="btn btn-coral">Buy Now</button>`
        : `<button type="button" class="btn btn-ghost" disabled>${stock <= 0 ? 'Sold out' : 'Unavailable'}</button>`}
      <button type="button" class="fav-btn${isFav ? ' active' : ''}" id="product-fav" data-product-id="${escapeAttr(p.id)}" aria-label="Toggle favorite" style="position:static">
        <svg class="fav-icon" width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
      ${p.shops ? `<button type="button" id="toggle-inquiry-btn" class="btn btn-outline btn-sm">Message Maker</button>` : ''}
    </div>
  `;

  const qtyInput = document.getElementById('product-qty');
  const clampQty = () => {
    let val = parseInt(qtyInput.value, 10) || 1;
    val = Math.max(1, Math.min(Math.max(1, stock), val));
    qtyInput.value = String(val);
    return val;
  };
  document.getElementById('qty-dec')?.addEventListener('click', () => {
    qtyInput.value = String(Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1));
  });
  document.getElementById('qty-inc')?.addEventListener('click', () => {
    qtyInput.value = String(Math.min(stock, (parseInt(qtyInput.value, 10) || 1) + 1));
  });
  qtyInput?.addEventListener('change', clampQty);

  document.getElementById('product-add-cart')?.addEventListener('click', async () => {
    const qty = clampQty();
    const { currentUser } = await import('/js/init.js');
    if (!currentUser) {
      window.location.href = 'login.html?next=' + encodeURIComponent('product.html?id=' + p.id);
      return;
    }
    const profile = await getCurrentProfile();
    if (profile && profile.role !== 'admin' && profile.approval_status !== 'approved') {
      showToast('Your account must be approved by an admin before adding items to cart.', 'error');
      return;
    }

    const btn = document.getElementById('product-add-cart');
    btn.disabled = true;
    try {
      let { data: cart, error: cartErr } = await supabase.from('carts').select('id').eq('user_id', currentUser.id).maybeSingle();
      if (cartErr) throw cartErr;
      if (!cart) {
        const { data: created, error: createErr } = await supabase.from('carts').insert([{ user_id: currentUser.id }]).select().single();
        if (createErr) throw createErr;
        cart = created;
      }
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', cart.id)
        .eq('product_id', p.id)
        .maybeSingle();

      const nextQty = (existing ? existing.quantity : 0) + qty;
      if (nextQty > stock) {
        showToast(`Cannot exceed available stock (${stock} left; you already have ${existing?.quantity || 0} in cart).`, 'error');
        return;
      }
      if (existing) {
        const { error } = await supabase.from('cart_items').update({ quantity: nextQty }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cart_items').insert([{ cart_id: cart.id, product_id: p.id, quantity: qty }]);
        if (error) throw error;
      }
      showToast(`${p.name} added to cart!`);
      refreshCartCount();
    } catch (err) {
      showToast(err.message || 'Could not add item to cart.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('product-buy-now')?.addEventListener('click', async () => {
    const qty = clampQty();
    const { currentUser } = await import('/js/init.js');
    if (!currentUser) {
      window.location.href = 'login.html?next=' + encodeURIComponent('product.html?id=' + p.id);
      return;
    }
    const profile = await getCurrentProfile();
    if (profile && profile.role !== 'admin' && profile.approval_status !== 'approved') {
      showToast('Your account must be approved before placing an order.', 'error');
      return;
    }
    window.location.href = `checkout.html?buyNow=${encodeURIComponent(p.id)}&qty=${qty}`;
  });
}

function wireInquiryForm(p) {
  const slot = document.getElementById('product-inquiry-slot');
  if (!slot || !p.shops) return;
  slot.innerHTML = `
    <div id="inquiry-form-wrap" class="sticky-note" style="display:none; margin-bottom: 1rem;">
      <h4 style="margin-top:0">Message ${escapeHtml(p.shops.name)}</h4>
      <div class="form-group">
        <label for="inquiry-subject">Subject</label>
        <input type="text" id="inquiry-subject" class="form-input" placeholder="Question about materials, pickup in Iloilo, or personalization">
      </div>
      <div class="form-group">
        <label for="inquiry-message">Message</label>
        <textarea id="inquiry-message" class="form-textarea" style="min-height:86px" placeholder="Write your note to the maker…"></textarea>
      </div>
      <p id="inquiry-message-msg" class="form-error" style="display:none"></p>
      <div class="flex">
        <button type="button" class="btn btn-primary btn-sm" id="inquiry-submit">Send message</button>
        <button type="button" class="btn btn-ghost btn-sm" id="inquiry-cancel">Cancel</button>
      </div>
    </div>
  `;

  const wrap = document.getElementById('inquiry-form-wrap');
  const errEl = document.getElementById('inquiry-message-msg');
  document.getElementById('toggle-inquiry-btn')?.addEventListener('click', async () => {
    const { currentUser } = await import('/js/init.js');
    if (!currentUser) {
      window.location.href = 'login.html?next=' + encodeURIComponent('product.html?id=' + p.id);
      return;
    }
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('inquiry-cancel')?.addEventListener('click', () => {
    wrap.style.display = 'none';
  });
  document.getElementById('inquiry-submit')?.addEventListener('click', async () => {
    const subject = document.getElementById('inquiry-subject').value.trim();
    const message = document.getElementById('inquiry-message').value.trim();
    errEl.style.display = 'none';
    if (!subject || !message) {
      errEl.textContent = 'Please enter both a subject and message.';
      errEl.style.display = 'block';
      return;
    }
    const submitBtn = document.getElementById('inquiry-submit');
    submitBtn.disabled = true;
    const res = await apiFetch('/api/seller-inquiries', {
      method: 'POST',
      body: { shop_id: p.shops.id, product_id: p.id, subject, message }
    });
    submitBtn.disabled = false;
    if (!res.ok) {
      errEl.textContent = res.error;
      errEl.style.display = 'block';
      return;
    }
    showToast('Inquiry sent to the maker!');
    document.getElementById('inquiry-subject').value = '';
    document.getElementById('inquiry-message').value = '';
    wrap.style.display = 'none';
  });
}

async function loadReviewsAndForm(p) {
  const el = document.getElementById('product-reviews');
  const { data } = await supabase
    .from('reviews')
    .select('*, profiles:public_profiles(display_name, avatar_url)')
    .eq('product_id', p.id)
    .order('created_at', { ascending: false });

  const rows = data || [];
  let html = '';
  if (!rows.length) {
    html = '<p class="text-secondary">No reviews yet. Verified buyers can leave a review after confirming delivery.</p>';
  } else {
    const avg = rows.reduce((s, r) => s + r.rating, 0) / rows.length;
    html = `
      <div class="flex" style="margin-bottom: 1rem;">
        <div style="font-size:1.35rem">${renderStars(avg, true)}</div>
        <span class="text-secondary" style="font-size:0.9rem">${rows.length} review${rows.length !== 1 ? 's' : ''}</span>
      </div>
      ${rows.map(r => `
        <article class="order-card" style="background:var(--color-cream)">
          <div class="flex-between" style="margin-bottom:0.35rem">
            <div><strong>${escapeHtml(r.profiles?.display_name || 'Verified Buyer')}</strong> ${renderStars(r.rating)}</div>
            <span class="text-secondary" style="font-size:0.82rem">${formatDateTime(r.created_at)}</span>
          </div>
          <p style="margin:0">${escapeHtml(r.comment || '')}</p>
          ${r.seller_response ? `
            <div style="margin-top:0.65rem; padding:0.6rem 0.85rem; background:var(--surface-card); border-left:3px solid var(--color-sage); border-radius:var(--radius-sm); font-size:0.88rem">
              <strong>Maker reply:</strong> ${escapeHtml(r.seller_response)}
            </div>` : ''}
        </article>
      `).join('')}
    `;
  }
  el.innerHTML = html;

  // Check verified purchase eligibility
  const { currentUser } = await import('/js/init.js');
  if (!currentUser) return;

  const { data: mine } = await supabase
    .from('reviews')
    .select('id, created_at')
    .eq('product_id', p.id)
    .eq('buyer_id', currentUser.id)
    .limit(1);

  if (mine && mine.length) {
    el.insertAdjacentHTML('beforeend', '<p class="form-hint">You reviewed this creation on ' + formatDateTime(mine[0].created_at) + '.</p>');
    return;
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('id, orders!inner(status, buyer_id, created_at)')
    .eq('product_id', p.id)
    .eq('orders.buyer_id', currentUser.id)
    .eq('orders.status', 'completed')
    .limit(1);

  const eligible = (items || [])[0];
  if (!eligible) return;

  el.insertAdjacentHTML('beforeend', `
    <div class="sticky-note" style="margin-top:1.25rem">
      <h4 style="margin-top:0">Leave a Verified Review</h4>
      <div class="flex" style="margin-bottom:0.75rem">
        <span style="font-weight:700">Your rating:</span>
        <div id="review-stars" style="display:flex;gap:0.25rem;font-size:1.5rem"></div>
      </div>
      <textarea id="review-comment" class="form-textarea" placeholder="Share how this handmade piece turned out…" style="min-height:92px"></textarea>
      <p id="review-message" class="form-error" style="display:none"></p>
      <div style="margin-top:0.75rem">
        <button type="button" class="btn btn-primary btn-sm" id="review-submit">Submit Review</button>
      </div>
    </div>
  `);

  let ratingValue = 0;
  const starsEl = document.getElementById('review-stars');
  const drawStars = () => {
    starsEl.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = i <= ratingValue ? '★' : '☆';
      btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1.5rem;padding:0;color:' + (i <= ratingValue ? '#E2A03F' : 'var(--text-tertiary)');
      btn.setAttribute('aria-label', `Rate ${i} star${i > 1 ? 's' : ''}`);
      btn.addEventListener('click', () => { ratingValue = i; drawStars(); });
      starsEl.appendChild(btn);
    }
  };
  drawStars();

  document.getElementById('review-submit')?.addEventListener('click', async () => {
    const comment = document.getElementById('review-comment').value.trim();
    const msgEl = document.getElementById('review-message');
    msgEl.style.display = 'none';
    if (!ratingValue) {
      msgEl.textContent = 'Please select a star rating.';
      msgEl.style.display = 'block';
      return;
    }
    if (!comment) {
      msgEl.textContent = 'Please write a short review.';
      msgEl.style.display = 'block';
      return;
    }
    const submitBtn = document.getElementById('review-submit');
    submitBtn.disabled = true;
    const { error } = await supabase.from('reviews').insert([{
      product_id: p.id,
      order_item_id: eligible.id,
      buyer_id: currentUser.id,
      rating: ratingValue,
      comment
    }]);
    if (error) {
      submitBtn.disabled = false;
      msgEl.textContent = error.message || 'Could not submit review.';
      msgEl.style.display = 'block';
      return;
    }
    showToast('Thank you for reviewing this maker’s work!');
    loadReviewsAndForm(p);
  });
}

async function loadRelated(categoryId, excludeId) {
  const el = document.getElementById('product-related');
  let query = supabase
    .from('products')
    .select('*, product_images(*), categories(name, slug), shops(name, slug)')
    .eq('status', 'published')
    .eq('moderation_status', 'approved')
    .neq('id', excludeId)
    .order('created_at', { ascending: false })
    .limit(4);
  if (categoryId) query = query.eq('category_id', categoryId);

  const { data } = await query;
  const rows = data || [];
  if (!rows.length) {
    el.innerHTML = '<p class="text-secondary" style="grid-column:1/-1">Explore more creations in the <a href="shop.html">full shop</a>.</p>';
    return;
  }
  el.innerHTML = rows.map(p => renderProductCard(p, { favoritedIds })).join('');
}

document.getElementById('report-listing-btn')?.addEventListener('click', async () => {
  const { currentUser } = await import('/js/init.js');
  if (!currentUser) {
    window.location.href = 'login.html?next=' + encodeURIComponent('product.html?id=' + productId);
    return;
  }
  const reason = window.prompt('Briefly describe the issue with this listing (e.g., misleading item, policy concern):');
  if (!reason || !reason.trim()) return;
  const { error } = await supabase.from('reports').insert([{
    reporter_id: currentUser.id,
    product_id: currentProduct.id,
    reason: reason.trim().slice(0, 500)
  }]);
  if (error) {
    showToast(error.message || 'Unable to submit report.', 'error');
    return;
  }
  showToast('Report submitted for marketplace review.');
});

async function loadProduct() {
  if (!supabase || !productId) {
    loadingEl.style.display = 'none';
    notFoundEl.style.display = 'block';
    return;
  }
  const { data, error } = await supabase
    .from('products')
    .select('*, product_images(*), categories(name, slug), shops(*)')
    .eq('id', productId)
    .single();

  loadingEl.style.display = 'none';
  if (error || !data) {
    notFoundEl.style.display = 'block';
    return;
  }

  currentProduct = data;
  document.title = data.name + ' — YouMadeIt';
  document.getElementById('product-name').textContent = data.name;
  document.getElementById('product-description').textContent = data.description || 'Handmade in small batches.';
  document.getElementById('product-price').textContent = formatMoney(data.price_cents, data.currency);

  const sellerLink = document.getElementById('product-seller-link');
  const locEl = document.getElementById('product-seller-location');
  if (data.shops) {
    sellerLink.textContent = data.shops.name;
    sellerLink.href = 'seller-shop.html?slug=' + encodeURIComponent(data.shops.slug);
    if (data.shops.location) locEl.textContent = ' · ' + data.shops.location;
  } else {
    sellerLink.textContent = 'Local Maker';
  }

  const meta = [];
  if (data.categories?.name) meta.push(`<span class="product-category">${escapeHtml(data.categories.name)}</span>`);
  if (data.status !== 'published') meta.push('<span class="badge badge-draft">Draft</span>');
  if (data.moderation_status && data.moderation_status !== 'approved') {
    meta.push(`<span class="badge badge-outline">Review: ${escapeHtml(data.moderation_status)}</span>`);
  }
  document.getElementById('product-meta').innerHTML = meta.join('');

  const stock = data.quantity == null ? 0 : Number(data.quantity);
  const stockEl = document.getElementById('product-stock');
  if (stock <= 0) stockEl.innerHTML = '<span class="product-stock">Currently sold out</span>';
  else if (stock <= 3) stockEl.innerHTML = `<span class="product-stock low">Only ${stock} left in stock</span>`;
  else stockEl.innerHTML = `<span class="product-stock ok">${stock} available</span>`;

  renderGallery(data);
  renderAttributes(data);
  renderActions(data);
  wireInquiryForm(data);

  contentEl.style.display = 'block';
  loadReviewsAndForm(data);
  loadRelated(data.category_id, data.id);
}

wireFavoriteButtons(document, { favoritedIds });

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  refreshCartCount();
  if (user) {
    favoritedIds = await fetchUserFavoritesSet();
    if (currentProduct) {
      renderActions(currentProduct);
      loadReviewsAndForm(currentProduct);
    }
  } else {
    favoritedIds = new Set();
  }
});

checkDbStatus();
loadProduct();
