const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const supabaseBrowserSdk = fs.readFileSync(path.join(
  __dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'
), 'utf8');

// Supabase server client (anon key). User-scoped operations forward the
// caller's JWT so Row Level Security sees the real authenticated user.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
})); // Serves HTML/CSS/JS static files

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---------------------------------------------------------------------------
// Helpers & validation
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_CURRENCIES = new Set(['PHP', 'USD']);
const DEFAULT_CURRENCY = 'PHP';

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function cleanText(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function normalizeCurrency(value) {
  if (typeof value === 'string') {
    const upper = value.trim().toUpperCase();
    if (ALLOWED_CURRENCIES.has(upper)) return upper;
  }
  return DEFAULT_CURRENCY;
}

function sanitizePostgrestPattern(term) {
  // Strip characters that break PostgREST .or() filter syntax
  return String(term || '')
    .replace(/[%_,()"{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// Runtime config injected into the browser. The Supabase anon key is intended
// to be public; security is enforced by Row Level Security, not by secrecy.
app.get('/js/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(
    supabaseBrowserSdk + '\n' +
    'window.SUPABASE_CONFIG = {\n' +
    '  url: ' + JSON.stringify(process.env.SUPABASE_URL) + ',\n' +
    '  key: ' + JSON.stringify(process.env.SUPABASE_KEY) + '\n' +
    '};\n'
  );
});

app.get('/api/health', async (req, res) => {
  const { error } = await dbFor(req).from('profiles').select('id').limit(1);
  res.json({ ok: !error, database: !error ? 'connected' : error.message });
});

// Diagnostic: reports which required tables exist (parallelized + cached when healthy)
const REQUIRED_TABLES = [
  'profiles', 'categories', 'shops', 'products', 'product_images', 'carts',
  'cart_items', 'favorites', 'orders', 'order_items', 'payments', 'reviews',
  'notifications', 'sales_events', 'seller_inquiries', 'reports', 'messages',
  'admin_messages'
];

let cachedDbStatus = null;
let cachedDbStatusAt = 0;
const DB_STATUS_CACHE_MS = 60 * 1000;

app.get('/api/db/status', async (req, res) => {
  const forceFresh = req.query.fresh === '1';
  if (!forceFresh && cachedDbStatus && (Date.now() - cachedDbStatusAt) < DB_STATUS_CACHE_MS) {
    return res.json(cachedDbStatus);
  }
  const client = dbFor(req);
  const results = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const { error } = await client.from(table).select('id').limit(1);
      const missing = error && ['PGRST205', '42P01'].includes(error.code);
      return [table, {
        exists: !missing,
        queryOk: !error,
        ...(error ? { error: error.message, code: error.code } : {})
      }];
    })
  );
  const status = Object.fromEntries(results);
  const allExist = Object.values(status).every(v => v.exists);
  if (allExist) {
    cachedDbStatus = status;
    cachedDbStatusAt = Date.now();
  }
  res.json(status);
});

// Build a Supabase client that carries the caller's JWT for RLS.
function serverSupabase(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    global: { headers: { Authorization: token ? `Bearer ${token}` : '' } }
  });
}

function dbFor(req) {
  return req.db || supabase;
}

async function requireUser(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session' });
  req.user = user;
  req.db = serverSupabase(req);
  next();
}

function requireRole(allowed) {
  return async (req, res, next) => {
    const { data: profile } = await dbFor(req)
      .from('profiles').select('role').eq('id', req.user.id).single();
    if (!profile || !allowed.includes(profile.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

async function requireApproved(req, res, next) {
  const { data: profile, error } = await dbFor(req)
    .from('profiles')
    .select('role, approval_status')
    .eq('id', req.user.id)
    .single();
  if (error || !profile) return res.status(403).json({ error: 'Account profile is unavailable' });
  if (profile.role !== 'admin' && profile.approval_status !== 'approved') {
    return res.status(403).json({
      error: profile.approval_status === 'rejected' ? 'Account application was not approved' : 'Account approval is pending',
      approval_status: profile.approval_status
    });
  }
  req.profile = profile;
  next();
}

// ---------------------------------------------------------------------------
// Support / contact messages
// ---------------------------------------------------------------------------
app.get('/api/messages', requireUser, requireRole(['admin']), async (req, res) => {
  const { data, error } = await dbFor(req)
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/messages', async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 200);
  const subject = cleanText(body.subject, 200);
  const content = cleanText(body.content || body.message, 5000);
  if (!name || !email || !subject || !content) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  const { data, error } = await dbFor(req).from('messages').insert([{
    name, email, subject, content
  }]).select('id, created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Success', data });
});

// ---------------------------------------------------------------------------
// Public read APIs (no auth required)
// ---------------------------------------------------------------------------
app.get('/api/categories', async (_req, res) => {
  const { data, error } = await supabase
    .from('categories').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/shops', async (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const { data, error } = await supabase
    .from('shops')
    .select('*, profiles:public_profiles(display_name, avatar_url, bio)')
    .eq('is_active', true)
    .order('name')
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/shops/:slug', async (req, res) => {
  const slug = cleanText(req.params.slug, 100).toLowerCase();
  if (!slug) return res.status(400).json({ error: 'Invalid shop slug' });
  const { data: shop, error } = await supabase
    .from('shops')
    .select('*, profiles:public_profiles(*)')
    .eq('slug', slug)
    .single();
  if (error || !shop) return res.status(404).json({ error: 'Shop not found' });
  const { data: products } = await supabase
    .from('products')
    .select('*, product_images(*), categories(name, slug)')
    .eq('shop_id', shop.id)
    .eq('status', 'published')
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: false });
  res.json({ shop, products: products || [] });
});

// Public catalog endpoint supporting search, filters, pagination, and popularity sort
app.get('/api/products', async (req, res) => {
  const q = sanitizePostgrestPattern(req.query.q);
  const categorySlug = cleanText(req.query.category, 100).toLowerCase();
  const shopSlug = cleanText(req.query.shop, 100).toLowerCase();
  const availability = cleanText(req.query.availability, 30) || 'all';
  const sort = cleanText(req.query.sort, 30) || 'newest';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const minVal = req.query.min !== undefined && req.query.min !== '' ? Number(req.query.min) : null;
  const maxVal = req.query.max !== undefined && req.query.max !== '' ? Number(req.query.max) : null;

  if ((minVal !== null && (!Number.isFinite(minVal) || minVal < 0)) ||
      (maxVal !== null && (!Number.isFinite(maxVal) || maxVal < 0))) {
    return res.status(400).json({ error: 'Invalid price filter' });
  }

  let categoryId = null;
  if (categorySlug) {
    const { data: cat } = await supabase.from('categories').select('id').eq('slug', categorySlug).maybeSingle();
    if (!cat) return res.json({ items: [], total: 0, page, limit });
    categoryId = cat.id;
  }

  let shopId = null;
  if (shopSlug) {
    const { data: shop } = await supabase.from('shops').select('id').eq('slug', shopSlug).maybeSingle();
    if (!shop) return res.json({ items: [], total: 0, page, limit });
    shopId = shop.id;
  }

  let matchingShopIds = [];
  if (q) {
    const { data: matchingShops } = await supabase
      .from('shops')
      .select('id')
      .eq('is_active', true)
      .ilike('name', `%${q}%`)
      .limit(20);
    matchingShopIds = (matchingShops || []).map(s => s.id);
  }

  let query = supabase
    .from('products')
    .select('*, product_images(*), categories(name, slug), shops(id, name, slug, location)', { count: 'exact' })
    .eq('status', 'published')
    .eq('moderation_status', 'approved');

  if (categoryId) query = query.eq('category_id', categoryId);
  if (shopId) query = query.eq('shop_id', shopId);
  if (minVal !== null) query = query.gte('price_cents', Math.round(minVal * 100));
  if (maxVal !== null) query = query.lte('price_cents', Math.round(maxVal * 100));
  if (availability === 'available') query = query.gt('quantity', 0);
  else if (availability === 'soldout') query = query.lte('quantity', 0);

  if (q) {
    const clauses = [
      `name.ilike.%${q}%`,
      `description.ilike.%${q}%`,
      `materials.ilike.%${q}%`,
      `tags.cs.{"${q.toLowerCase()}"}`
    ];
    if (matchingShopIds.length) {
      clauses.push(`shop_id.in.(${matchingShopIds.join(',')})`);
    }
    query = query.or(clauses.join(','));
  }

  if (sort === 'popular') {
    const { data: allRows, error } = await query.order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    const rows = allRows || [];
    const productIds = rows.map(r => r.id);
    const popularityMap = Object.create(null);

    if (productIds.length) {
      const [{ data: sales }, { data: revs }] = await Promise.all([
        supabase.from('sales_events').select('product_id, quantity').eq('type', 'order_placed').in('product_id', productIds),
        supabase.from('reviews').select('product_id, rating').in('product_id', productIds)
      ]);
      for (const s of (sales || [])) {
        if (s.product_id) popularityMap[s.product_id] = (popularityMap[s.product_id] || 0) + (s.quantity || 1) * 3;
      }
      for (const r of (revs || [])) {
        if (r.product_id) popularityMap[r.product_id] = (popularityMap[r.product_id] || 0) + (r.rating || 1);
      }
    }

    rows.sort((a, b) => {
      const diff = (popularityMap[b.id] || 0) - (popularityMap[a.id] || 0);
      if (diff !== 0) return diff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const start = (page - 1) * limit;
    return res.json({ items: rows.slice(start, start + limit), total: rows.length, page, limit });
  }

  if (sort === 'price-asc') query = query.order('price_cents', { ascending: true });
  else if (sort === 'price-desc') query = query.order('price_cents', { ascending: false });
  else if (sort === 'alpha-asc') query = query.order('name', { ascending: true });
  else if (sort === 'alpha-desc') query = query.order('name', { ascending: false });
  else if (sort === 'oldest') query = query.order('created_at', { ascending: true });
  else query = query.order('created_at', { ascending: false });

  const from = (page - 1) * limit;
  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [], total: count || 0, page, limit });
});

// ---------------------------------------------------------------------------
// Seller: shop management (auth required)
// ---------------------------------------------------------------------------
app.post('/api/shops', requireUser, requireApproved, async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, 120);
  const slug = cleanText(body.slug, 80).toLowerCase();
  if (!name || !slug) return res.status(400).json({ error: 'Shop name and slug are required' });
  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Shop URL slug may contain only lowercase letters, numbers, and hyphens' });
  }
  const { data: profile } = await dbFor(req).from('profiles').select('role, id').eq('id', req.user.id).single();
  if (!profile) {
    return res.status(403).json({ error: 'Profile not found' });
  }
  const { data: existing } = await dbFor(req).from('shops').select('id').eq('slug', slug).limit(1);
  if (existing && existing.length) return res.status(409).json({ error: 'Shop URL already taken' });

  const socialLinks = (body.social_links && typeof body.social_links === 'object' && !Array.isArray(body.social_links))
    ? body.social_links : {};

  const { data, error } = await dbFor(req).from('shops').insert([{
    owner_id: req.user.id,
    name,
    slug,
    description: cleanText(body.description, 2000) || null,
    location: cleanText(body.location, 160) || 'Iloilo, Philippines',
    processing_time: cleanText(body.processing_time, 160) || null,
    shipping_info: cleanText(body.shipping_info, 500) || null,
    return_policy: cleanText(body.return_policy, 500) || null,
    social_links: socialLinks
  }]).select();
  if (error) return res.status(500).json({ error: error.message });
  await dbFor(req).from('profiles').update({ role: 'seller' }).eq('id', req.user.id);
  res.status(201).json(data[0]);
});

app.patch('/api/shops/:id', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid shop ID' });
  const { data: shop } = await dbFor(req).from('shops').select('id, owner_id, slug').eq('id', req.params.id).single();
  if (!shop || shop.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your shop' });
  }

  const body = req.body || {};
  const updates = {};
  if (Object.hasOwn(body, 'name')) {
    const name = cleanText(body.name, 120);
    if (!name) return res.status(400).json({ error: 'Shop name cannot be empty' });
    updates.name = name;
  }
  if (Object.hasOwn(body, 'slug')) {
    const slug = cleanText(body.slug, 80).toLowerCase();
    if (!slug || !SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'Shop URL slug may contain only lowercase letters, numbers, and hyphens' });
    }
    if (slug !== shop.slug) {
      const { data: taken } = await dbFor(req).from('shops').select('id').eq('slug', slug).neq('id', shop.id).limit(1);
      if (taken && taken.length) return res.status(409).json({ error: 'Shop URL already taken' });
    }
    updates.slug = slug;
  }
  if (Object.hasOwn(body, 'description')) updates.description = cleanText(body.description, 2000) || null;
  if (Object.hasOwn(body, 'location')) updates.location = cleanText(body.location, 160) || null;
  if (Object.hasOwn(body, 'processing_time')) updates.processing_time = cleanText(body.processing_time, 160) || null;
  if (Object.hasOwn(body, 'shipping_info')) updates.shipping_info = cleanText(body.shipping_info, 500) || null;
  if (Object.hasOwn(body, 'return_policy')) updates.return_policy = cleanText(body.return_policy, 500) || null;
  if (Object.hasOwn(body, 'logo_url')) updates.logo_url = cleanText(body.logo_url, 500) || null;
  if (Object.hasOwn(body, 'banner_url')) updates.banner_url = cleanText(body.banner_url, 500) || null;
  if (Object.hasOwn(body, 'is_active') && typeof body.is_active === 'boolean') updates.is_active = body.is_active;
  if (Object.hasOwn(body, 'social_links') && body.social_links && typeof body.social_links === 'object' && !Array.isArray(body.social_links)) {
    updates.social_links = body.social_links;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid shop fields provided' });
  }

  const { data, error } = await dbFor(req).from('shops').update(updates).eq('id', req.params.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// ---------------------------------------------------------------------------
// Seller inquiries (buyer-to-seller contact)
// ---------------------------------------------------------------------------
app.post('/api/seller-inquiries', requireUser, requireApproved, async (req, res) => {
  const body = req.body || {};
  const shop_id = body.shop_id;
  const product_id = body.product_id || null;
  const subject = cleanText(body.subject, 200);
  const message = cleanText(body.message, 3000);
  if (!isUuid(shop_id) || !subject || !message) {
    return res.status(400).json({ error: 'Shop, subject and message are required' });
  }
  if (product_id && !isUuid(product_id)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  const { data: shop } = await dbFor(req).from('shops').select('id, owner_id, name').eq('id', shop_id).single();
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  const { data, error } = await dbFor(req).from('seller_inquiries').insert([{
    shop_id, product_id, buyer_id: req.user.id, subject, message
  }]).select();
  if (error) return res.status(500).json({ error: error.message });

  // Notify the shop owner of the new buyer inquiry
  await dbFor(req).from('notifications').insert([{
    user_id: shop.owner_id,
    type: 'seller_inquiry',
    title: 'New buyer inquiry',
    body: subject,
    link: '/seller-dashboard.html#inquiries'
  }]).catch(() => {});

  res.status(201).json(data[0]);
});

app.get('/api/seller-inquiries', requireUser, requireApproved, async (req, res) => {
  const { data: profile } = await dbFor(req).from('profiles').select('role').eq('id', req.user.id).single();
  const isAdmin = profile && profile.role === 'admin';
  let shopIds = null;
  if (!isAdmin) {
    const { data: shops } = await dbFor(req).from('shops').select('id').eq('owner_id', req.user.id);
    shopIds = (shops || []).map(s => s.id);
    if (shopIds.length === 0) return res.json([]);
  }
  let query = dbFor(req)
    .from('seller_inquiries')
    .select('*, shops(name, slug), products(id, name), profiles:public_profiles(display_name)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (!isAdmin) query = query.in('shop_id', shopIds);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ---------------------------------------------------------------------------
// Seller: product management (auth required, ownership enforced)
// ---------------------------------------------------------------------------
app.post('/api/products', requireUser, requireApproved, async (req, res) => {
  const body = req.body || {};
  const shop_id = body.shop_id;
  const name = cleanText(body.name, 160);
  if (!isUuid(shop_id) || !name) return res.status(400).json({ error: 'Shop and product name are required' });
  const { data: shop } = await dbFor(req).from('shops').select('owner_id').eq('id', shop_id).single();
  if (!shop || shop.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your shop' });
  }

  const parsedPrice = Number(body.price);
  const parsedQuantity = Number(body.quantity);
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
    return res.status(400).json({ error: 'Enter a valid non-negative price and whole-number stock quantity' });
  }

  const status = body.status === 'published' ? 'published' : 'draft';
  if (body.category_id && !isUuid(body.category_id)) {
    return res.status(400).json({ error: 'Invalid category ID' });
  }

  const priceCents = Math.round(parsedPrice * 100);
  const tags = Array.isArray(body.tags)
    ? body.tags.map(t => cleanText(t, 40).toLowerCase()).filter(Boolean).slice(0, 15)
    : [];

  const { data, error } = await dbFor(req).from('products').insert([{
    seller_id: req.user.id,
    shop_id,
    category_id: body.category_id || null,
    name,
    description: cleanText(body.description, 4000) || null,
    price_cents: priceCents,
    currency: normalizeCurrency(body.currency),
    status,
    moderation_status: 'pending',
    sku: cleanText(body.sku, 80) || null,
    quantity: parsedQuantity,
    condition: cleanText(body.condition, 80) || null,
    materials: cleanText(body.materials, 300) || null,
    dimensions: cleanText(body.dimensions, 160) || null,
    weight: cleanText(body.weight, 100) || null,
    color: cleanText(body.color, 100) || null,
    style: cleanText(body.style, 100) || null,
    personalization: cleanText(body.personalization, 300) || null,
    processing_time: cleanText(body.processing_time, 160) || null,
    shipping_info: cleanText(body.shipping_info, 400) || null,
    tags,
    ...(status === 'published' ? { published_at: new Date().toISOString() } : {})
  }]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

app.patch('/api/products/:id', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
  const { data: product } = await dbFor(req).from('products').select('seller_id, status').eq('id', req.params.id).single();
  if (!product || product.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your product' });
  }
  const allowedFields = [
    'category_id', 'name', 'description', 'currency', 'status', 'sku', 'quantity',
    'condition', 'materials', 'dimensions', 'weight', 'color', 'style',
    'personalization', 'processing_time', 'shipping_info', 'tags'
  ];
  const body = req.body || {};
  const updates = Object.fromEntries(
    allowedFields.filter(field => Object.hasOwn(body, field)).map(field => [field, body[field]])
  );

  if (Object.hasOwn(updates, 'name')) {
    updates.name = cleanText(updates.name, 160);
    if (!updates.name) return res.status(400).json({ error: 'Product name is required' });
  }
  if (Object.hasOwn(updates, 'category_id')) {
    if (updates.category_id && !isUuid(updates.category_id)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }
    if (!updates.category_id) updates.category_id = null;
  }
  if (Object.hasOwn(updates, 'status') && !['draft', 'published'].includes(updates.status)) {
    return res.status(400).json({ error: 'Invalid listing status' });
  }
  if (Object.hasOwn(updates, 'currency')) {
    updates.currency = normalizeCurrency(updates.currency);
  }
  if (Object.hasOwn(updates, 'quantity')) {
    const qty = Number(updates.quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: 'Enter a valid non-negative whole stock quantity' });
    }
    updates.quantity = qty;
  }
  if (Object.hasOwn(updates, 'tags')) {
    updates.tags = Array.isArray(updates.tags)
      ? updates.tags.map(t => cleanText(t, 40).toLowerCase()).filter(Boolean).slice(0, 15)
      : [];
  }
  if (Object.hasOwn(body, 'price')) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Enter a valid non-negative price' });
    updates.price_cents = Math.round(price * 100);
  }
  if (updates.status === 'published' && product.status !== 'published') {
    updates.published_at = new Date().toISOString();
  }
  const contentChanged = Object.keys(updates).some(field => field !== 'status' && field !== 'quantity' && field !== 'published_at');
  if (contentChanged) {
    updates.moderation_status = 'pending';
    updates.moderation_note = null;
    updates.reviewed_at = null;
    updates.reviewed_by = null;
  }
  const { data, error } = await dbFor(req).from('products').update(updates).eq('id', req.params.id).select();
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'Product not found' });
  res.json(data[0]);
});

app.delete('/api/products/:id', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
  const { data: product } = await dbFor(req).from('products').select('seller_id').eq('id', req.params.id).single();
  if (!product || product.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your product' });
  }
  const { error } = await dbFor(req).from('products').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Product deleted' });
});

// ---------------------------------------------------------------------------
// Buyer: orders (server-validated totals, moderation, and stock)
// ---------------------------------------------------------------------------
app.post('/api/orders', requireUser, requireApproved, async (req, res) => {
  const { items, shipping_address, delivery_method, notes, payment_intent_id, clear_cart } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'No items in order' });
  }

  const addr = shipping_address && typeof shipping_address === 'object' ? shipping_address : {};
  const shipName = cleanText(addr.name, 120);
  const shipEmail = cleanText(addr.email, 200);
  const shipAddress = cleanText(addr.address, 300);
  const shipCity = cleanText(addr.city, 120);
  const shipPostal = cleanText(addr.postal, 30);
  if (!shipName || !shipEmail || !shipAddress || !shipCity || !shipPostal) {
    return res.status(400).json({ error: 'Complete shipping address (name, email, street/barangay, city/municipality, postal code) is required' });
  }
  const cleanShippingAddress = {
    name: shipName,
    email: shipEmail,
    phone: cleanText(addr.phone, 40) || undefined,
    address: shipAddress,
    barangay: cleanText(addr.barangay, 120) || undefined,
    city: shipCity,
    province: cleanText(addr.province, 120) || 'Iloilo',
    postal: shipPostal,
    country: cleanText(addr.country, 60) || 'Philippines'
  };

  if (payment_intent_id) {
    const { data: existingPayment } = await dbFor(req)
      .from('payments')
      .select('id, order_id')
      .eq('provider_payment_id', String(payment_intent_id))
      .maybeSingle();
    if (existingPayment && existingPayment.order_id) {
      return res.status(409).json({ error: 'Order already created for this payment' });
    }
  }

  // Aggregate quantities across duplicate product IDs so stock checks are accurate
  const qtyByProduct = new Map();
  for (const item of items) {
    if (!item || !isUuid(item.product_id)) {
      return res.status(400).json({ error: 'Invalid product in order' });
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) || 0) + qty);
  }

  const productIds = Array.from(qtyByProduct.keys());
  const { data: products } = await dbFor(req)
    .from('products')
    .select('id, seller_id, name, price_cents, currency, quantity, status, moderation_status')
    .in('id', productIds);
  if (!products || products.length !== productIds.length) {
    return res.status(400).json({ error: 'One or more products are no longer available' });
  }
  const byId = Object.fromEntries(products.map(p => [p.id, p]));

  let subtotal = 0;
  const lineItems = [];
  const orderCurrency = normalizeCurrency(products[0]?.currency);
  for (const [productId, qty] of qtyByProduct.entries()) {
    const product = byId[productId];
    if (!product) return res.status(400).json({ error: 'Unknown product' });
    if (product.status !== 'published' || product.moderation_status !== 'approved') {
      return res.status(400).json({ error: product.name + ' is not currently available for purchase' });
    }
    if (product.quantity < qty) {
      return res.status(409).json({ error: 'Not enough stock for ' + product.name });
    }
    subtotal += product.price_cents * qty;
    lineItems.push({ product, qty });
  }

  const shippingCents = 0;
  const total = subtotal + shippingCents;
  const orderNumber = 'CRAFT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();

  const { data: order, error: orderError } = await dbFor(req).from('orders').insert([{
    order_number: orderNumber,
    buyer_id: req.user.id,
    subtotal_cents: subtotal,
    shipping_cents: shippingCents,
    total_cents: total,
    currency: orderCurrency,
    shipping_address: cleanShippingAddress,
    delivery_method: cleanText(delivery_method, 60) || 'standard',
    notes: cleanText(notes, 1000) || null
  }]).select().single();
  if (orderError) return res.status(500).json({ error: orderError.message });

  const orderItemsRows = lineItems.map(li => ({
    order_id: order.id,
    product_id: li.product.id,
    seller_id: li.product.seller_id,
    product_name_snapshot: li.product.name,
    price_cents: li.product.price_cents,
    quantity: li.qty
  }));
  const { error: oiError } = await dbFor(req).from('order_items').insert(orderItemsRows);
  if (oiError) {
    await dbFor(req).from('orders').delete().eq('id', order.id);
    return res.status(500).json({ error: oiError.message });
  }

  const restored = [];
  for (const li of lineItems) {
    const { error: decError, data: decData } = await dbFor(req)
      .from('products')
      .update({ quantity: li.product.quantity - li.qty })
      .eq('id', li.product.id)
      .eq('quantity', li.product.quantity)
      .select('quantity');
    if (decError || !decData || !decData.length) {
      for (const r of restored) {
        await dbFor(req).from('products').update({ quantity: r.before }).eq('id', r.id);
      }
      await dbFor(req).from('order_items').delete().eq('order_id', order.id);
      await dbFor(req).from('orders').delete().eq('id', order.id);
      return res.status(409).json({ error: 'Stock changed while ordering: ' + li.product.name });
    }
    restored.push({ id: li.product.id, before: li.product.quantity });
  }

  const { error: payError } = await dbFor(req).from('payments').insert([{
    order_id: order.id,
    provider: 'sandbox',
    provider_payment_id: payment_intent_id ? String(payment_intent_id) : null,
    amount_cents: total,
    currency: orderCurrency,
    status: 'pending'
  }]);
  if (payError) console.error('Payment record error:', payError.message);

  // Clear ordered items from the buyer's cart when ordering from cart
  if (clear_cart !== false) {
    const { data: userCart } = await dbFor(req).from('carts').select('id').eq('user_id', req.user.id).maybeSingle();
    if (userCart) {
      await dbFor(req).from('cart_items').delete().eq('cart_id', userCart.id).in('product_id', productIds);
    }
  }

  const firstItem = lineItems[0];
  await dbFor(req).from('sales_events').insert([{
    type: 'order_placed',
    order_id: order.id,
    product_id: firstItem.product.id,
    seller_id: firstItem.product.seller_id,
    product_name_snapshot: firstItem.product.name,
    quantity: firstItem.qty,
    gross_cents: total,
    currency: orderCurrency
  }]);

  await dbFor(req).from('notifications').insert([{
    user_id: req.user.id,
    type: 'order_placed',
    title: 'Order received',
    body: 'Your order #' + orderNumber + ' has been placed.',
    link: '/orders.html?id=' + order.id
  }]);

  const sellerNotifications = lineItems.map(li => ({
    user_id: li.product.seller_id,
    type: 'order_placed',
    title: 'New order',
    body: 'New order #' + orderNumber + ' includes "' + li.product.name + '" (x' + li.qty + ').',
    link: '/seller-orders.html'
  }));
  await dbFor(req).from('notifications').insert(sellerNotifications);

  res.status(201).json({ order, payment_intent_id: payment_intent_id || null });
});

app.get('/api/orders/:id', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
  const { data: order, error } = await dbFor(req)
    .from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
  if (error || !order) return res.status(404).json({ error: 'Order not found' });
  const { data: profile } = await dbFor(req).from('profiles').select('role').eq('id', req.user.id).single();
  const isSeller = order.order_items.some(oi => oi.seller_id === req.user.id);
  if (order.buyer_id !== req.user.id && !isSeller && profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Not your order' });
  }
  res.json(order);
});

app.get('/api/orders', requireUser, requireApproved, async (req, res) => {
  const { data: profile } = await dbFor(req).from('profiles').select('role').eq('id', req.user.id).single();
  const scope = req.query.scope;

  if (scope === 'seller') {
    const { data, error } = await dbFor(req)
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    const sellerOrders = (data || []).filter(o => (o.order_items || []).some(oi => oi.seller_id === req.user.id));
    return res.json(sellerOrders);
  }

  let query = dbFor(req).from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(100);
  if (scope === 'all' && profile?.role === 'admin') {
    // admin all orders
  } else {
    query = query.eq('buyer_id', req.user.id);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.patch('/api/orders/:id/process', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
  const { data: order } = await dbFor(req).from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const isSeller = order.order_items.some(oi => oi.seller_id === req.user.id);
  if (!isSeller) return res.status(403).json({ error: 'Only a seller of this order can update it' });
  if (order.status !== 'paid') {
    return res.status(400).json({ error: 'Only paid orders can be moved to processing' });
  }
  const { data, error } = await dbFor(req).from('orders')
    .update({ status: 'processing' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await dbFor(req).from('notifications').insert([{
    user_id: order.buyer_id,
    type: 'order_processing',
    title: 'Maker preparing your order',
    body: 'Your order #' + order.order_number + ' is now being prepared.',
    link: '/orders.html?id=' + order.id
  }]);
  res.json(data);
});

app.patch('/api/orders/:id/ship', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
  const tracking_number = cleanText(req.body?.tracking_number, 120) || null;
  const note = cleanText(req.body?.note, 400);
  const { data: order } = await dbFor(req).from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const isSeller = order.order_items.some(oi => oi.seller_id === req.user.id);
  if (!isSeller) return res.status(403).json({ error: 'Only a seller of this order can ship it' });
  if (order.status !== 'paid' && order.status !== 'processing') {
    return res.status(400).json({ error: 'Order is not ready to ship' });
  }
  const { data, error } = await dbFor(req).from('orders')
    .update({ status: 'shipped', tracking_number }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await dbFor(req).from('sales_events').insert([{
    type: 'order_shipped',
    order_id: order.id,
    seller_id: req.user.id,
    product_name_snapshot: 'Order #' + order.order_number,
    gross_cents: order.total_cents,
    currency: order.currency
  }]);
  await dbFor(req).from('notifications').insert([{
    user_id: order.buyer_id,
    type: 'order_shipped',
    title: 'Order shipped',
    body: 'Your order #' + order.order_number + ' is on its way' +
      (tracking_number ? ' (tracking: ' + tracking_number + ')' : '') +
      (note ? ' — ' + note : '') + '.',
    link: '/orders.html?id=' + order.id
  }]);
  res.json(data);
});

app.patch('/api/orders/:id/complete', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
  const { data: order } = await dbFor(req).from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Only the buyer can confirm delivery' });
  if (order.status !== 'shipped') {
    return res.status(400).json({ error: 'Only shipped orders can be marked as received' });
  }
  const { data, error } = await dbFor(req).from('orders')
    .update({ status: 'completed' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const sellerIds = [...new Set(order.order_items.map(oi => oi.seller_id))];
  if (sellerIds.length) {
    await dbFor(req).from('notifications').insert(sellerIds.map(sid => ({
      user_id: sid,
      type: 'order_completed',
      title: 'Order delivered',
      body: 'Buyer confirmed receipt of order #' + order.order_number + '.',
      link: '/seller-orders.html'
    })));
  }
  await dbFor(req).from('sales_events').insert([{
    type: 'order_completed',
    order_id: order.id,
    seller_id: sellerIds[0] || null,
    product_name_snapshot: 'Order #' + order.order_number,
    gross_cents: order.total_cents,
    currency: order.currency
  }]);
  res.json(data);
});

app.patch('/api/orders/:id/cancel', requireUser, requireApproved, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
  const { data: order } = await dbFor(req).from('orders').select('*, order_items(*)').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Not your order' });
  if (!['pending_payment', 'paid'].includes(order.status)) {
    return res.status(400).json({ error: 'Order cannot be cancelled at this stage' });
  }
  const wasPaid = order.status === 'paid';
  const { data, error } = await dbFor(req).from('orders')
    .update({ status: 'cancelled' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  for (const oi of order.order_items) {
    if (!oi.product_id) continue;
    const { data: prod } = await dbFor(req).from('products').select('quantity').eq('id', oi.product_id).single();
    if (prod) {
      await dbFor(req).from('products').update({ quantity: prod.quantity + oi.quantity }).eq('id', oi.product_id);
    }
  }
  await dbFor(req).from('payments')
    .update({ status: wasPaid ? 'refunded' : 'failed' })
    .eq('order_id', order.id);

  await dbFor(req).from('sales_events').insert([{
    type: 'order_cancelled',
    order_id: order.id,
    product_name_snapshot: 'Order #' + order.order_number,
    currency: order.currency
  }]);

  const sellerIds = [...new Set(order.order_items.map(oi => oi.seller_id))];
  if (sellerIds.length) {
    await dbFor(req).from('notifications').insert(sellerIds.map(sid => ({
      user_id: sid,
      type: 'order_cancelled',
      title: 'Order cancelled',
      body: 'Order #' + order.order_number + ' was cancelled by the buyer and stock was restored.',
      link: '/seller-orders.html'
    })));
  }
  res.json(data);
});

// ---------------------------------------------------------------------------
// Notifications (buyer & seller inbox)
// ---------------------------------------------------------------------------
app.get('/api/notifications', requireUser, async (req, res) => {
  const { data, error } = await dbFor(req)
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.patch('/api/notifications/:id/read', requireUser, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid notification ID' });
  const { data, error } = await dbFor(req)
    .from('notifications')
    .update({ read: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id, read')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Notification not found' });
  res.json(data);
});

// ---------------------------------------------------------------------------
// Payments — SANDBOX STUB (no live payment gateway configured)
// ---------------------------------------------------------------------------
app.post('/api/payments/create-intent', requireUser, requireApproved, async (req, res) => {
  const amount_cents = Number(req.body?.amount_cents);
  if (!Number.isFinite(amount_cents) || amount_cents <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const currency = normalizeCurrency(req.body?.currency);
  const intentId = 'sandbox_intent_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  res.json({
    intent_id: intentId,
    amount_cents: Math.round(amount_cents),
    currency,
    test: true,
    sandbox: true
  });
});

app.post('/api/payments/confirm', requireUser, requireApproved, async (req, res) => {
  const intent_id = cleanText(req.body?.intent_id, 120);
  if (!intent_id) return res.status(400).json({ error: 'Payment intent ID is required' });
  const { data: payment } = await dbFor(req)
    .from('payments')
    .select('*, orders(*)')
    .eq('provider_payment_id', intent_id)
    .maybeSingle();
  if (!payment || !payment.orders) return res.status(404).json({ error: 'Payment not found' });
  if (payment.orders.buyer_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your payment' });
  }
  if (payment.status === 'paid') return res.json({ status: 'already_paid', order_id: payment.orders.id });
  const { error } = await dbFor(req).from('payments').update({ status: 'paid' }).eq('id', payment.id);
  if (error) return res.status(500).json({ error: error.message });
  const order = payment.orders;
  if (order.status === 'pending_payment') {
    await dbFor(req).from('orders').update({ status: 'paid' }).eq('id', order.id);
    await dbFor(req).from('sales_events').insert([{
      type: 'payment_confirmed',
      order_id: order.id,
      product_name_snapshot: 'Order #' + order.order_number,
      gross_cents: order.total_cents,
      currency: order.currency
    }]);
    await dbFor(req).from('notifications').insert([{
      user_id: order.buyer_id,
      type: 'payment_confirmed',
      title: 'Sandbox payment confirmed',
      body: 'Test payment for order #' + order.order_number + ' was confirmed.',
      link: '/orders.html?id=' + order.id
    }]);
  }
  res.json({ status: 'paid', order_id: order.id, sandbox: true });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
app.get('/api/admin/accounts', requireUser, requireRole(['admin']), async (req, res) => {
  const allowedStatuses = ['pending', 'approved', 'rejected'];
  const status = req.query.status;
  let query = dbFor(req)
    .from('profiles')
    .select('id, display_name, email, role, approval_status, created_at, approved_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (allowedStatuses.includes(status)) query = query.eq('approval_status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.patch('/api/admin/accounts/:id/approval', requireUser, requireRole(['admin']), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid account ID' });
  const { approval_status } = req.body || {};
  if (!['approved', 'rejected'].includes(approval_status)) {
    return res.status(400).json({ error: 'Choose approved or rejected' });
  }
  const updates = {
    approval_status,
    approved_at: approval_status === 'approved' ? new Date().toISOString() : null,
    approved_by: approval_status === 'approved' ? req.user.id : null
  };
  const { data, error } = await dbFor(req)
    .from('profiles').update(updates).eq('id', req.params.id)
    .select('id, display_name, email, role, approval_status, approved_at').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Account not found' });
  await dbFor(req).from('notifications').insert([{
    user_id: data.id,
    type: 'account_review',
    title: approval_status === 'approved' ? 'Account approved' : 'Account not approved',
    body: approval_status === 'approved'
      ? 'Your account is approved. You can now shop and open a seller shop.'
      : 'Your account application was not approved. Contact support if you believe this is an error.',
    link: '/profile.html'
  }]);
  res.json(data);
});

app.get('/api/admin/products', requireUser, requireRole(['admin']), async (req, res) => {
  const statusParam = req.query.status;
  let query = dbFor(req)
    .from('products')
    .select('id, name, description, price_cents, currency, status, moderation_status, moderation_note, created_at, seller_id, shop_id, product_images(id, url, is_main, sort_order), shops(name, slug), profiles:profiles!products_seller_id_fkey(display_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (statusParam !== 'all') {
    const status = ['pending', 'approved', 'rejected'].includes(statusParam) ? statusParam : 'pending';
    query = query.eq('moderation_status', status);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.patch('/api/admin/products/:id/review', requireUser, requireRole(['admin']), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
  const { decision, note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Choose approved or rejected' });
  }
  const moderationNote = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
  const updates = {
    moderation_status: decision,
    moderation_note: moderationNote || null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: req.user.id,
    ...(decision === 'rejected' ? { status: 'draft' } : {})
  };
  const { data, error } = await dbFor(req)
    .from('products').update(updates).eq('id', req.params.id)
    .select('id, name, seller_id, moderation_status, status').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Product not found' });
  await dbFor(req).from('notifications').insert([{
    user_id: data.seller_id,
    type: 'product_review',
    title: decision === 'approved' ? 'Product approved' : 'Product needs changes',
    body: decision === 'approved'
      ? 'Your product "' + data.name + '" was approved.'
      : 'Your product "' + data.name + '" was not approved.' + (moderationNote ? ' Note: ' + moderationNote : ''),
    link: '/seller-products.html'
  }]);
  res.json(data);
});

app.post('/api/admin/messages', requireUser, requireRole(['admin']), async (req, res) => {
  const { recipient_id, product_id, subject, body } = req.body || {};
  if (!isUuid(recipient_id) || !subject || !body || typeof subject !== 'string' || typeof body !== 'string') {
    return res.status(400).json({ error: 'Recipient, subject and message are required' });
  }
  if (product_id && !isUuid(product_id)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  const { data: recipient, error: recipientError } = await dbFor(req)
    .from('profiles').select('id').eq('id', recipient_id).maybeSingle();
  if (recipientError) return res.status(500).json({ error: recipientError.message });
  if (!recipient) return res.status(404).json({ error: 'Account not found' });
  const { data, error } = await dbFor(req).from('admin_messages').insert([{
    admin_id: req.user.id,
    recipient_id,
    product_id: product_id || null,
    subject: subject.trim().slice(0, 160),
    body: body.trim().slice(0, 5000)
  }]).select('id, recipient_id, product_id, subject, body, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  await dbFor(req).from('notifications').insert([{
    user_id: recipient_id,
    type: 'admin_message',
    title: 'Message from marketplace administration',
    body: data.subject,
    link: '/profile.html#admin-messages'
  }]);
  res.status(201).json(data);
});

app.get('/api/account/admin-messages', requireUser, async (req, res) => {
  const { data, error } = await dbFor(req).from('admin_messages')
    .select('id, subject, body, product_id, read_at, created_at')
    .eq('recipient_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.patch('/api/account/admin-messages/:id/read', requireUser, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  const { data, error } = await dbFor(req).from('admin_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('recipient_id', req.user.id)
    .select('id, read_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Message not found' });
  res.json(data);
});

app.get('/api/admin/orders', requireUser, requireRole(['admin']), async (req, res) => {
  const { data, error } = await dbFor(req)
    .from('orders')
    .select('*, order_items(*), profiles(display_name, email)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.patch('/api/admin/products/:id/hide', requireUser, requireRole(['admin']), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
  const { data, error } = await dbFor(req).from('products').update({ status: 'draft' }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Product not found' });
  res.json(data);
});

app.post('/api/admin/categories', requireUser, requireRole(['admin']), async (req, res) => {
  const name = cleanText(req.body?.name, 80);
  const rawSlug = cleanText(req.body?.slug, 80).toLowerCase() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const description = cleanText(req.body?.description, 300) || null;
  if (!name || !rawSlug || !SLUG_RE.test(rawSlug)) {
    return res.status(400).json({ error: 'Provide a valid category name and slug' });
  }
  const { data, error } = await dbFor(req)
    .from('categories')
    .insert([{ name, slug: rawSlug, description }])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Category slug already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

app.delete('/api/admin/categories/:id', requireUser, requireRole(['admin']), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid category ID' });
  const { error } = await dbFor(req).from('categories').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Category deleted' });
});

app.patch('/api/admin/reports/:id', requireUser, requireRole(['admin']), async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid report ID' });
  const status = req.body?.status;
  if (!['reviewed', 'resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid report status' });
  }
  const { data, error } = await dbFor(req)
    .from('reports')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  res.json(data);
});

// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = { app, supabase };
