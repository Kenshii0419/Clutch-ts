// Seller product management — create, edit, publish/unpublish, delete, and image uploads
import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import {
  formatMoney,
  escapeHtml,
  escapeAttr,
  showToast,
  openModal,
  closeModal,
  confirmDialog,
  apiFetch,
  checkDbStatus,
  getMainProductImage
} from '/js/ui.js';
import { renderAuthLinks, updateCartCount, refreshCartCount } from '/js/nav.js';

const cfg = window.SUPABASE_CONFIG || {};
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const requireAuthEl = document.getElementById('seller-products-require-auth');
const wrap = document.getElementById('seller-products-wrap');
const tableWrap = document.getElementById('products-table-wrap');
const emptyEl = document.getElementById('products-empty');
const modal = document.getElementById('product-modal');
const form = document.getElementById('product-form');
const modalTitle = document.getElementById('modal-title');
const prodId = document.getElementById('prod-id');
const prodName = document.getElementById('prod-name');
const prodDesc = document.getElementById('prod-desc');
const prodPrice = document.getElementById('prod-price');
const prodQty = document.getElementById('prod-qty');
const prodSku = document.getElementById('prod-sku');
const prodCategory = document.getElementById('prod-category');
const prodMaterials = document.getElementById('prod-materials');
const prodDimensions = document.getElementById('prod-dimensions');
const prodProcessing = document.getElementById('prod-processing');
const prodPersonalization = document.getElementById('prod-personalization');
const prodTags = document.getElementById('prod-tags');
const prodPublish = document.getElementById('prod-publish');
const prodImageInput = document.getElementById('prod-image');
const imagesList = document.getElementById('images-list');
const btnSave = document.getElementById('prod-save');
const btnCancel = document.getElementById('modal-cancel');
const saveError = document.getElementById('prod-save-error');

let images = []; // { id, url, storage_path, is_main, sort_order, file, removed }
let editingId = null;
let sellerProducts = [];

async function getSessionToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? session.access_token : '';
}

async function getShopId() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) return null;
  const { data: shops, error } = await supabase.from('shops').select('id').eq('owner_id', user.id).limit(1);
  if (error) throw new Error(error.message);
  return (shops && shops[0]) ? shops[0].id : null;
}

async function loadCategories() {
  const res = await apiFetch('/api/categories', { auth: false });
  const cats = res.ok ? (res.data || []) : [];
  prodCategory.innerHTML = '<option value="">Uncategorized</option>' +
    cats.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`).join('');
}

async function loadProducts() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase
    .from('products')
    .select('*, categories(name), product_images(*)')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    tableWrap.innerHTML = `<div class="empty-state"><h3>Unable to load products</h3><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }
  sellerProducts = data || [];
  renderProductsTable(sellerProducts);
}

function renderProductsTable(rows) {
  if (!rows || !rows.length) {
    wrap.style.display = 'block';
    tableWrap.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  wrap.style.display = 'block';
  tableWrap.style.display = 'block';
  emptyEl.style.display = 'none';

  const bodyHtml = rows.map(p => {
    const imgUrl = getMainProductImage(p);
    const stock = p.quantity || 0;
    const stockClass = stock <= 0 ? 'out' : stock <= 2 ? 'low' : 'ok';
    const stockLabel = stock <= 0 ? 'Sold out' : stock <= 2 ? `Low (${stock})` : `${stock} in stock`;
    const modBadge = p.moderation_status === 'approved'
      ? 'badge-success'
      : (p.moderation_status === 'rejected' ? 'badge-coral' : 'badge-outline');

    return `
      <tr data-product-id="${escapeAttr(p.id)}">
        <td><img src="${escapeAttr(imgUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-sm);border:1.5px solid var(--border)" onerror="this.src='/images/placeholder.svg'"></td>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.moderation_note ? `<div class="text-secondary" style="font-size:0.78rem">Note: ${escapeHtml(p.moderation_note)}</div>` : ''}
        </td>
        <td>${escapeHtml(p.categories?.name || '—')}</td>
        <td><strong>${formatMoney(p.price_cents, p.currency)}</strong></td>
        <td><span class="product-stock ${stockClass}">${stockLabel}</span></td>
        <td><span class="badge ${p.status === 'published' ? 'badge-success' : 'badge-draft'}">${escapeHtml(p.status)}</span></td>
        <td><span class="badge ${modBadge}">${escapeHtml(p.moderation_status || 'pending')}</span></td>
        <td>
          <div class="flex" style="gap:0.35rem">
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${escapeAttr(p.id)}">Edit</button>
            <button type="button" class="btn btn-ghost btn-sm" data-toggle-status="${escapeAttr(p.id)}" data-next-status="${p.status === 'published' ? 'draft' : 'published'}">
              ${p.status === 'published' ? 'Unpublish' : 'Publish'}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-delete="${escapeAttr(p.id)}" data-name="${escapeAttr(p.name)}" style="color:var(--danger)">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Photo</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Review</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
}

function renderImages() {
  const visible = images.map((img, idx) => ({ img, idx })).filter(x => !x.img.removed);
  if (!visible.length) {
    imagesList.innerHTML = '<p class="form-hint" style="margin:0">No images yet. Add at least one photo (JPEG, PNG, or WebP).</p>';
    return;
  }
  imagesList.innerHTML = visible.map(({ img, idx }) => {
    const isMain = !!img.is_main;
    return `
      <div class="upload-thumb" style="border-color:${isMain ? 'var(--color-sage-deep)' : 'var(--border)'}">
        <img src="${escapeAttr(img.url)}" alt="">
        <span style="position:absolute;top:4px;left:4px;background:rgba(64,86,58,0.85);color:#fff;font-size:0.68rem;padding:0.1rem 0.4rem;border-radius:999px">
          ${isMain ? 'Main' : 'Photo'}
        </span>
        ${!isMain ? `<button type="button" data-main-img="${idx}" style="position:absolute;bottom:4px;left:4px;right:4px;background:var(--color-paper);color:var(--color-ink);border:1.5px solid var(--border-strong);border-radius:999px;font-size:0.7rem;font-weight:700;padding:0.15rem;cursor:pointer">Set Main</button>` : ''}
        <button type="button" class="upload-remove" data-remove-img="${idx}" aria-label="Remove image">&times;</button>
      </div>
    `;
  }).join('');
}

function openProductModal(product = null) {
  saveError.textContent = '';
  saveError.style.display = 'none';
  editingId = product ? product.id : null;
  images = (product?.product_images || []).slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(img => ({
      id: img.id,
      url: img.url,
      storage_path: img.storage_path,
      is_main: !!img.is_main,
      sort_order: img.sort_order || 0,
      file: null,
      removed: false
    }));
  if (images.length && !images.some(i => i.is_main)) images[0].is_main = true;

  form.reset();
  if (product) {
    modalTitle.textContent = 'Edit Product';
    prodId.value = product.id;
    prodName.value = product.name || '';
    prodDesc.value = product.description || '';
    prodPrice.value = product.price_cents != null ? (product.price_cents / 100).toFixed(2) : '';
    prodQty.value = String(product.quantity ?? 0);
    prodSku.value = product.sku || '';
    prodCategory.value = product.category_id || '';
    prodMaterials.value = product.materials || '';
    prodDimensions.value = product.dimensions || '';
    prodProcessing.value = product.processing_time || '';
    prodPersonalization.value = product.personalization || '';
    prodTags.value = (product.tags || []).join(', ');
    prodPublish.checked = product.status === 'published';
  } else {
    modalTitle.textContent = 'Add a Product';
    prodId.value = '';
    prodQty.value = '1';
    prodPublish.checked = true;
  }
  renderImages();
  openModal(modal);
}

async function syncImages(productId) {
  const token = await getSessionToken();

  // Remove deleted images
  for (const img of images.filter(i => i.removed && i.id)) {
    if (img.storage_path && !img.storage_path.startsWith('demo/')) {
      await fetch(cfg.url + '/storage/v1/object/product-images/' + img.storage_path, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      }).catch(() => {});
    }
    const { error } = await supabase.from('product_images').delete().eq('id', img.id);
    if (error) throw new Error('Could not remove image record: ' + error.message);
  }

  const active = images.filter(i => !i.removed);
  let order = 0;
  let uploadedCount = 0;
  const totalUploads = active.filter(i => i.file).length;

  for (const img of active) {
    if (img.file) {
      uploadedCount++;
      btnSave.textContent = `Uploading photo ${uploadedCount}/${totalUploads}…`;
      const safeName = img.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `products/${productId}/${Date.now()}-${safeName}`;
      const res = await fetch(cfg.url + '/storage/v1/object/product-images/' + path, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'x-upsert': 'true',
          'Content-Type': img.file.type
        },
        body: img.file
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Image upload failed: ' + (txt || res.statusText));
      }
      img.storage_path = path;
      img.url = cfg.url + '/storage/v1/object/public/product-images/' + path;
      img.file = null;
    }

    const rowPayload = {
      product_id: productId,
      storage_path: img.storage_path,
      url: img.url,
      is_main: !!img.is_main,
      sort_order: order++
    };
    const result = img.id
      ? await supabase.from('product_images').update(rowPayload).eq('id', img.id)
      : await supabase.from('product_images').insert([rowPayload]);
    if (result.error) throw new Error('Image details could not be saved: ' + result.error.message);
  }
}

async function saveProduct() {
  if (btnSave.disabled) return;
  saveError.textContent = '';
  saveError.style.display = 'none';
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';

  try {
    const name = prodName.value.trim();
    if (!name) throw new Error('Product name is required.');
    const price = Number(prodPrice.value);
    if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid non-negative PHP price.');
    const quantity = Number(prodQty.value);
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Enter a valid whole number for stock quantity.');

    const shopId = await getShopId();
    if (!shopId) throw new Error('No seller shop is linked to this account. Open your shop from Seller Studio first.');

    const payload = {
      shop_id: shopId,
      category_id: prodCategory.value || null,
      name,
      description: prodDesc.value.trim(),
      price,
      currency: 'PHP',
      status: prodPublish.checked ? 'published' : 'draft',
      sku: prodSku.value.trim() || null,
      quantity,
      materials: prodMaterials.value.trim() || null,
      dimensions: prodDimensions.value.trim() || null,
      processing_time: prodProcessing.value.trim() || null,
      personalization: prodPersonalization.value.trim() || null,
      tags: prodTags.value.split(',').map(t => t.trim()).filter(Boolean)
    };

    const res = editingId
      ? await apiFetch('/api/products/' + encodeURIComponent(editingId), { method: 'PATCH', body: payload })
      : await apiFetch('/api/products', { method: 'POST', body: payload });
    if (!res.ok) throw new Error(res.error);

    const product = res.data;
    editingId = product.id;
    prodId.value = product.id;

    await syncImages(product.id);
    showToast(product.moderation_status === 'pending'
      ? 'Product saved and submitted for admin review!'
      : 'Product saved!');
    closeModal(modal);
    await loadProducts();
  } catch (err) {
    saveError.textContent = err.message || 'Product could not be saved.';
    saveError.style.display = 'block';
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Save Product';
  }
}

document.getElementById('btn-add-product')?.addEventListener('click', () => openProductModal());
document.getElementById('add-first')?.addEventListener('click', () => openProductModal());
btnCancel?.addEventListener('click', () => closeModal(modal));
document.getElementById('modal-close')?.addEventListener('click', () => closeModal(modal));
modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
btnSave?.addEventListener('click', saveProduct);
form?.addEventListener('submit', (e) => { e.preventDefault(); saveProduct(); });

prodImageInput?.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      showToast(`${file.name}: please upload JPEG, PNG, or WebP images.`, 'error');
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name}: image must be 4 MB or smaller.`, 'error');
      continue;
    }
    images.push({
      id: null,
      url: URL.createObjectURL(file),
      storage_path: null,
      is_main: false,
      sort_order: images.length,
      file,
      removed: false
    });
  }
  const active = images.filter(i => !i.removed);
  if (active.length && !active.some(i => i.is_main)) active[0].is_main = true;
  e.target.value = '';
  renderImages();
});

imagesList?.addEventListener('click', (e) => {
  const mainBtn = e.target.closest('[data-main-img]');
  if (mainBtn) {
    const idx = parseInt(mainBtn.dataset.mainImg, 10);
    images.forEach((img, i) => { img.is_main = i === idx; });
    renderImages();
    return;
  }
  const remBtn = e.target.closest('[data-remove-img]');
  if (remBtn) {
    const idx = parseInt(remBtn.dataset.removeImg, 10);
    const target = images[idx];
    if (!target) return;
    if (target.id) {
      target.removed = true;
    } else {
      images.splice(idx, 1);
    }
    const remaining = images.filter(i => !i.removed);
    if (remaining.length && !remaining.some(i => i.is_main)) remaining[0].is_main = true;
    renderImages();
  }
});

tableWrap?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    const id = editBtn.dataset.edit;
    const found = sellerProducts.find(p => p.id === id);
    if (found) openProductModal(found);
    return;
  }

  const toggleBtn = e.target.closest('[data-toggle-status]');
  if (toggleBtn) {
    const id = toggleBtn.dataset.toggleStatus;
    const nextStatus = toggleBtn.dataset.nextStatus;
    const ok = await confirmDialog({
      title: `${nextStatus === 'published' ? 'Publish' : 'Unpublish'} product?`,
      message: nextStatus === 'published'
        ? 'Publish this product? Approved listings become visible in the shop immediately.'
        : 'Move this product back to draft? Shoppers will no longer see it.',
      confirmText: nextStatus === 'published' ? 'Publish' : 'Move to Draft'
    });
    if (!ok) return;
    const res = await apiFetch('/api/products/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: { status: nextStatus }
    });
    if (!res.ok) {
      showToast(res.error, 'error');
      return;
    }
    showToast(nextStatus === 'published' && res.data.moderation_status === 'pending'
      ? 'Published & waiting for admin moderation approval.'
      : `Product ${nextStatus}.`);
    loadProducts();
    return;
  }

  const delBtn = e.target.closest('[data-delete]');
  if (delBtn) {
    const id = delBtn.dataset.delete;
    const name = delBtn.dataset.name || 'this product';
    const ok = await confirmDialog({
      title: 'Delete product?',
      message: `Permanently delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    const res = await apiFetch('/api/products/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) {
      showToast(res.error, 'error');
      return;
    }
    showToast('Product deleted.');
    loadProducts();
  }
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

  refreshCartCount();
  if (!profile || profile.role !== 'seller') {
    if (profile?.role === 'admin') {
      requireAuthEl.innerHTML = '<h2>Administrator workspace</h2><p>Product moderation lives in the Admin dashboard.</p><div class="seller-entry-actions"><a class="btn btn-primary" href="admin.html">Open Administration</a></div>';
    } else if (profile?.approval_status && profile.approval_status !== 'approved') {
      requireAuthEl.innerHTML = '<h2>Account review in progress</h2><p>Your account must be approved before you can open a shop or add listings.</p><div class="seller-entry-actions"><a class="btn btn-outline" href="profile.html">View Account</a></div>';
    } else {
      requireAuthEl.innerHTML = '<h2>Open a shop before listing products</h2><p>Set up your maker storefront first from Seller Studio.</p><div class="seller-entry-actions"><a class="btn btn-primary" href="seller-dashboard.html">Open Seller Studio</a></div>';
    }
    requireAuthEl.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }

  requireAuthEl.style.display = 'none';
  wrap.style.display = 'block';
  loadCategories();
  loadProducts();
});

checkDbStatus();
