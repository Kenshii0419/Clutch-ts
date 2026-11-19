require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DEMO_EMAIL = process.env.DEMO_SELLER_EMAIL || 'demo-maker@youmadeit.local';
const DEMO_PASSWORD = process.env.DEMO_SELLER_PASSWORD || 'DemoMaker!2026-SafePass';

const PRODUCTS = [
  { name: 'Speckled Clay Kape Mug', slugCat: 'ceramics-pottery', price: 48000, qty: 12, days: 2, desc: 'Wheel-thrown stoneware mug with a warm speckled glaze, made for slow Iloilo mornings.', materials: 'Stoneware clay, food-safe glaze', dimensions: '10 oz', style: 'Rustic modern' },
  { name: 'Midnight Terracotta Planter', slugCat: 'ceramics-pottery', price: 65000, qty: 6, days: 9, desc: 'Small indoor planter with drainage hole and matte charcoal finish.', materials: 'Local terracotta, mineral glaze', dimensions: '4.5 in diameter', style: 'Minimal' },
  { name: 'Hand-Poured Espresso Cups (Set of 2)', slugCat: 'ceramics-pottery', price: 59000, qty: 8, days: 15, desc: 'Matched pair of espresso cups with satin cream interior.', materials: 'Porcelain', dimensions: '3 oz each', style: 'Clean' },
  { name: 'Handwoven Hablon Table Runner', slugCat: 'textiles-fiber', price: 145000, qty: 4, days: 4, desc: 'Soft handloom-woven cotton runner inspired by Miagao textile heritage.', materials: 'Pure woven cotton yarn', dimensions: '14 x 72 in', color: 'Sage & Cream', style: 'Heritage Craft' },
  { name: 'Embroidered Linen Market Tote', slugCat: 'textiles-fiber', price: 58000, qty: 15, days: 11, desc: 'Reusable sturdy tote with delicate botanical embroidery.', materials: 'Linen blend, cotton thread', dimensions: '15 x 16 in', style: 'Everyday' },
  { name: 'Woven Macrame Wall Hanging', slugCat: 'textiles-fiber', price: 98000, qty: 3, days: 21, desc: 'Textured fiber art piece knotted by hand on natural driftwood.', materials: 'Unbleached cotton cord, wood dowel', dimensions: '12 x 24 in', style: 'Boho' },
  { name: 'Hammered Brass Hoop Earrings', slugCat: 'jewelry', price: 39000, qty: 20, days: 1, desc: 'Lightweight everyday hoops with subtle hand-hammered texture.', materials: 'Brass, hypoallergenic posts', dimensions: '1.5 in', style: 'Modern' },
  { name: 'Sea Glass Pendant Necklace', slugCat: 'jewelry', price: 62000, qty: 9, days: 6, desc: 'Tumbled coastal sea-glass pendant wire-wrapped by hand.', materials: 'Sea glass, sterling silver', dimensions: '18 in chain', style: 'Coastal' },
  { name: 'Stacking Bead & Charm Rings', slugCat: 'jewelry', price: 45000, qty: 7, days: 18, desc: 'Dainty beaded rings with custom color pairings.', materials: 'Glass seed beads, brass wire', personalization: 'Choose accent color', style: 'Delicate' },
  { name: 'Molo Church Botanical Risograph Print', slugCat: 'prints-illustrations', price: 32000, qty: 25, days: 3, desc: 'Limited-run risograph art print on textured cotton paper.', materials: 'Soy ink, archival paper', dimensions: '8 x 10 in', style: 'Illustrative' },
  { name: 'Iloilo Esplanade Morning Art Print', slugCat: 'prints-illustrations', price: 38000, qty: 14, days: 13, desc: 'Warm gouache-style illustration of a quiet morning along the river.', materials: 'Matte archival print', dimensions: '11 x 14 in', style: 'Contemporary' },
  { name: 'Sampaguita & White Tea Soy Candle', slugCat: 'candles-home', price: 34000, qty: 30, days: 5, desc: 'Clean-burning soy candle with gentle floral sampaguita and tea notes.', materials: 'Soy wax, cotton wick, botanical fragrance', dimensions: '8 oz', style: 'Relaxed' },
  { name: 'Calamansi & Cedarwood Amber Candle', slugCat: 'candles-home', price: 39000, qty: 18, days: 17, desc: 'Bright citrus balanced with warm wood in a reusable amber jar.', materials: 'Soy wax, essential oil blend', dimensions: '9 oz', style: 'Warm' },
  { name: 'Acacia Wood Serving Board', slugCat: 'woodworking', price: 89000, qty: 5, days: 8, desc: 'Hand-shaped acacia board finished with food-safe beeswax oil.', materials: 'Sustainably sourced acacia wood', dimensions: '9 x 14 in', style: 'Heirloom' },
  { name: 'Kamagong Desk & Brush Organizer', slugCat: 'woodworking', price: 54000, qty: 10, days: 22, desc: 'Compact studio organizer for pens, brushes, and craft tools.', materials: 'Solid hardwood', dimensions: '8 x 4 x 3 in', style: 'Functional' },
  { name: 'Calamansi & Honey Artisan Soap Bar', slugCat: 'beauty-wellness', price: 18000, qty: 40, days: 7, desc: 'Small-batch cold-process soap bar with local wild honey and citrus zest.', materials: 'Coconut oil, olive oil, local honey, calamansi extract', dimensions: '120 g', style: 'Fresh' },
  { name: 'Rosemary & Peppermint Hand Salve', slugCat: 'beauty-wellness', price: 24000, qty: 22, days: 16, desc: 'Nourishing balm for makers, gardeners, and busy hands.', materials: 'Shea butter, beeswax, essential oils', dimensions: '60 g tin', style: 'Herbal' },
  { name: 'Pressed Gumamela Greeting Cards (Set of 6)', slugCat: 'stationery-paper', price: 28000, qty: 28, days: 10, desc: 'Blank note cards featuring hand-pressed tropical blooms.', materials: 'Recycled textured cardstock', dimensions: 'A2', style: 'Romantic' },
  { name: 'Coptic-Bound Dot Grid Sketchbook', slugCat: 'stationery-paper', price: 46000, qty: 11, days: 19, desc: 'Lay-flat hand-stitched journal with 120gsm dot grid pages.', materials: 'Cotton bookcloth, acid-free paper', dimensions: '5.5 x 8.5 in', style: 'Classic' },
  { name: 'Leaf-Shaped Ceramic Incense Holder', slugCat: 'ceramics-pottery', price: 35000, qty: 0, days: 12, desc: 'Minimal ceramic holder for stick incense with delicate ash catch.', materials: 'Stoneware', dimensions: '9 in', style: 'Minimal', soldOut: true },
  { name: 'Hand-Painted Canvas Coin Pouch', slugCat: 'handmade-accessories', price: 22000, qty: 16, days: 14, desc: 'Zippered everyday pouch with optional hand-painted initials.', materials: 'Heavyweight cotton canvas', personalization: 'Up to 3 initials', style: 'Utility' },
  { name: 'Pressed Capiz & Glass Suncatcher', slugCat: 'other-handmade', price: 49000, qty: 13, days: 20, desc: 'Window suncatcher crafted with capiz shell and stained glass accents.', materials: 'Capiz shell, glass beads, brass wire', dimensions: '10 in drop', style: 'Playful' }
];

function imageFor(name) {
  const seed = encodeURIComponent(name.replace(/[^a-zA-Z0-9 ]/g, '').trim());
  return `https://picsum.photos/seed/${seed}/800/800`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is required.');
  if (!serviceKey) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in .env to seed demo content.');

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let userId = null;
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (list.error) throw list.error;
  const found = (list.data?.users || []).find(u => (u.email || '').toLowerCase() === DEMO_EMAIL.toLowerCase());
  if (found) {
    userId = found.id;
  } else {
    const created = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Hinimo Studio Iloilo' }
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  }

  const now = new Date().toISOString();
  const { error: profileErr } = await admin.from('profiles').upsert({
    id: userId,
    display_name: 'Hinimo Studio Iloilo',
    email: DEMO_EMAIL,
    role: 'seller',
    approval_status: 'approved',
    approved_at: now,
    approved_by: userId
  }, { onConflict: 'id' });
  if (profileErr) throw profileErr;

  const { data: existingShop } = await admin.from('shops').select('id').eq('owner_id', userId).eq('slug', 'demo-studio').maybeSingle();
  let shopId = existingShop?.id;
  if (!shopId) {
    const { data: shop, error: shopErr } = await admin.from('shops').insert([{
      owner_id: userId,
      name: 'Hinimo Studio Iloilo',
      slug: 'demo-studio',
      description: 'Small-batch pottery, handwoven textiles, botanical candles, and paper goods crafted in Iloilo.',
      location: 'Jaro, Iloilo City',
      processing_time: '1–3 business days',
      shipping_info: 'Local Iloilo meetup/delivery & nationwide courier shipping.',
      return_policy: '7-day exchange for damaged items upon arrival.',
      is_active: true
    }]).select('id').single();
    if (shopErr) throw shopErr;
    shopId = shop.id;
  }

  const { data: cats, error: catErr } = await admin.from('categories').select('id,slug');
  if (catErr) throw catErr;
  const catBySlug = Object.fromEntries((cats || []).map(c => [c.slug, c.id]));

  let created = 0, updated = 0;
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const category_id = catBySlug[p.slugCat] || catBySlug['other-handmade'] || null;
    const createdAt = new Date(Date.now() - p.days * 86400000 - i * 3600000).toISOString();
    const payload = {
      seller_id: userId,
      shop_id: shopId,
      category_id,
      name: p.name,
      description: p.desc,
      price_cents: p.price,
      currency: 'PHP',
      status: 'published',
      moderation_status: 'approved',
      quantity: p.soldOut ? 0 : p.qty,
      materials: p.materials || null,
      dimensions: p.dimensions || null,
      color: p.color || null,
      style: p.style || null,
      personalization: p.personalization || null,
      processing_time: '1–3 business days',
      shipping_info: 'Packed carefully in recycled kraft boxes.',
      tags: [p.slugCat, 'iloilo', 'handmade'],
      published_at: createdAt,
      created_at: createdAt,
      updated_at: now
    };

    const { data: existing } = await admin.from('products').select('id').eq('shop_id', shopId).eq('name', p.name).maybeSingle();
    let productId;
    if (existing) {
      const { error } = await admin.from('products').update(payload).eq('id', existing.id);
      if (error) throw error;
      productId = existing.id;
      updated++;
    } else {
      const { data: row, error } = await admin.from('products').insert([payload]).select('id').single();
      if (error) throw error;
      productId = row.id;
      created++;
    }

    const { data: imgs } = await admin.from('product_images').select('id').eq('product_id', productId).limit(1);
    if (!imgs || !imgs.length) {
      const urlImg = imageFor(p.name);
      const { error: imgErr } = await admin.from('product_images').insert([{
        product_id: productId,
        storage_path: 'demo/' + productId,
        url: urlImg,
        is_main: true,
        sort_order: 0
      }]);
      if (imgErr) throw imgErr;
    }
  }

  console.log(`Demo seed complete. Created ${created}, updated ${updated} products for shop demo-studio.`);
  console.log(`Demo seller: ${DEMO_EMAIL} (password from DEMO_SELLER_PASSWORD env or default).`);
}

main().catch(err => { console.error('Seed failed:', err.message || err); process.exit(1); });
