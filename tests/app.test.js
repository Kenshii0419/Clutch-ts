const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

describe('Static assets & module integrity', () => {
  const htmlFiles = fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.html'));

  it('contains all 25 HTML pages with valid UTF-8 and existing local asset references', () => {
    assert.equal(htmlFiles.length, 25, `Expected 25 HTML pages, found ${htmlFiles.length}`);
    const dec = new TextDecoder('utf-8', { fatal: true });

    for (const file of htmlFiles) {
      const full = path.join(PUBLIC_DIR, file);
      const buf = fs.readFileSync(full);
      const html = dec.decode(buf);

      assert.match(html, /<link rel="stylesheet" href="\/css\/style\.css">/, `${file} missing style.css`);
      assert.match(html, /<script src="\/js\/config\.js"><\/script>/, `${file} missing config.js`);
      assert.match(html, /<script type="module" src="\/js\/init\.js"><\/script>/, `${file} missing init.js`);

      // Check local module src references exist on disk
      const scriptRefs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
      for (const ref of scriptRefs) {
        if (ref === '/js/config.js') continue; // dynamically served
        const target = path.join(PUBLIC_DIR, ref.replace(/^\//, ''));
        assert.ok(fs.existsSync(target), `${file} references missing script ${ref}`);
      }
    }
  });

  it('all JS files are valid UTF-8 and pass syntax checks', () => {
    const dec = new TextDecoder('utf-8', { fatal: true });
    const jsFiles = [
      path.join(ROOT, 'server.js'),
      path.join(ROOT, 'scripts', 'bootstrap-admin.js'),
      path.join(ROOT, 'scripts', 'seed-demo.js')
    ];

    function walkJs(dir) {
      for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (fs.statSync(p).isDirectory()) walkJs(p);
        else if (entry.endsWith('.js')) jsFiles.push(p);
      }
    }
    walkJs(path.join(PUBLIC_DIR, 'js'));

    for (const file of jsFiles) {
      const text = dec.decode(fs.readFileSync(file));
      assert.ok(text.length > 0, `${file} should not be empty`);
      if (file.includes(`${path.sep}public${path.sep}`)) {
        const res = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' });
        assert.equal(res.status, 0, `ES module syntax error in ${file}: ${res.stderr}`);
        assert.ok(!text.includes('SERVICE_ROLE'), `${file} must never reference service role key`);
      } else {
        new vm.Script(text, { filename: file });
      }
    }
  });
});

describe('Express server API, security & Supabase integration', () => {
  let server;
  let baseUrl;

  before(async () => {
    const { app } = require('../server');
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('GET /api/health reports database connected', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-options') || res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.database, 'connected');
  });

  it('GET /api/db/status confirms all 18 required tables exist', async () => {
    const res = await fetch(`${baseUrl}/api/db/status?fresh=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const expected = [
      'profiles', 'categories', 'shops', 'products', 'product_images', 'carts',
      'cart_items', 'favorites', 'orders', 'order_items', 'payments', 'reviews',
      'notifications', 'sales_events', 'seller_inquiries', 'reports', 'messages',
      'admin_messages'
    ];
    for (const t of expected) {
      assert.ok(body[t], `Missing table status for ${t}`);
      assert.equal(body[t].exists, true, `Table ${t} does not exist: ${body[t].error}`);
    }
  });

  it('GET /js/config.js serves browser SDK & anon config without leaking service secrets', async () => {
    const res = await fetch(`${baseUrl}/js/config.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /javascript/);
    const text = await res.text();
    assert.match(text, /window\.SUPABASE_CONFIG/);
    assert.ok(!text.includes('SERVICE_ROLE'));
  });

  it('serves all 25 static HTML pages with 200 OK', async () => {
    const htmlFiles = fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.html'));
    for (const file of htmlFiles) {
      const res = await fetch(`${baseUrl}/${file}`);
      assert.equal(res.status, 200, `Expected 200 for /${file}`);
    }
  });

  it('GET /api/categories and /api/shops return arrays', async () => {
    const [catRes, shopRes] = await Promise.all([
      fetch(`${baseUrl}/api/categories`),
      fetch(`${baseUrl}/api/shops`)
    ]);
    assert.equal(catRes.status, 200);
    assert.equal(shopRes.status, 200);
    const cats = await catRes.json();
    const shops = await shopRes.json();
    assert.ok(Array.isArray(cats) && cats.length >= 8);
    assert.ok(Array.isArray(shops));
  });

  it('GET /api/products validates query params and only returns published + approved listings', async () => {
    const badRes = await fetch(`${baseUrl}/api/products?min=-5`);
    assert.equal(badRes.status, 400);

    for (const sort of ['newest', 'oldest', 'popular', 'price-asc', 'price-desc', 'alpha-asc']) {
      const res = await fetch(`${baseUrl}/api/products?sort=${sort}&limit=10`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.items));
      assert.equal(typeof data.total, 'number');
      for (const item of data.items) {
        assert.equal(item.status, 'published');
        assert.equal(item.moderation_status, 'approved');
      }
    }

    const searchRes = await fetch(`${baseUrl}/api/products?q=test%2C%28%29`);
    assert.equal(searchRes.status, 200);
  });

  it('GET /api/shops/:slug returns 404 for unknown slug', async () => {
    const res = await fetch(`${baseUrl}/api/shops/nonexistent-shop-999999`);
    assert.equal(res.status, 404);
  });

  it('POST /api/messages validates input strictly', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' })
    });
    assert.equal(emptyRes.status, 400);

    const badEmailRes = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'not-an-email', subject: 'Hi', content: 'Hello' })
    });
    assert.equal(badEmailRes.status, 400);
  });

  it('rejects unauthenticated and forged-token access to all protected routes', async () => {
    const protectedEndpoints = [
      ['POST', '/api/shops'],
      ['PATCH', '/api/shops/00000000-0000-4000-8000-000000000001'],
      ['POST', '/api/products'],
      ['PATCH', '/api/products/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/api/products/00000000-0000-4000-8000-000000000001'],
      ['POST', '/api/orders'],
      ['GET', '/api/orders'],
      ['PATCH', '/api/orders/00000000-0000-4000-8000-000000000001/ship'],
      ['PATCH', '/api/orders/00000000-0000-4000-8000-000000000001/complete'],
      ['PATCH', '/api/orders/00000000-0000-4000-8000-000000000001/cancel'],
      ['POST', '/api/payments/create-intent'],
      ['POST', '/api/payments/confirm'],
      ['GET', '/api/notifications'],
      ['GET', '/api/seller-inquiries'],
      ['GET', '/api/admin/accounts'],
      ['GET', '/api/admin/products'],
      ['GET', '/api/admin/orders'],
      ['POST', '/api/admin/categories'],
      ['PATCH', '/api/admin/reports/00000000-0000-4000-8000-000000000001']
    ];

    for (const [method, endpoint] of protectedEndpoints) {
      const noAuth = await fetch(`${baseUrl}${endpoint}`, { method });
      assert.equal(noAuth.status, 401, `${method} ${endpoint} without token must return 401`);

      const badAuth = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { Authorization: 'Bearer invalid.jwt.token' }
      });
      assert.equal(badAuth.status, 401, `${method} ${endpoint} with invalid token must return 401`);
    }
  });
});
