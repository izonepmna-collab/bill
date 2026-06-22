const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const db       = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));   // allow logo base64
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════
   ITEMS
══════════════════════════════════════ */
app.get('/api/items', (req, res) => {
  db.all('SELECT * FROM items ORDER BY category, name', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({
      id: r.id, name: r.name, category: r.category || '', type: r.type,
      rate: r.rate,
      prices:   r.prices   ? JSON.parse(r.prices)   : null,
      variants: r.variants ? JSON.parse(r.variants) : null
    })));
  });
});

app.post('/api/items', (req, res) => {
  const { name, category, type, rate, prices, variants } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });
  db.run(
    `INSERT INTO items (name, category, type, rate, prices, variants) VALUES (?,?,?,?,?,?)`,
    [name, category||'', type, rate||null,
     prices   ? JSON.stringify(prices)   : null,
     variants ? JSON.stringify(variants) : null],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.put('/api/items/:id', (req, res) => {
  const { name, category, type, rate, prices, variants } = req.body;
  db.run(
    `UPDATE items SET name=?, category=?, type=?, rate=?, prices=?, variants=? WHERE id=?`,
    [name, category||'', type, rate!==undefined?rate:null,
     prices   ? JSON.stringify(prices)   : null,
     variants ? JSON.stringify(variants) : null,
     req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, changes: this.changes });
    }
  );
});

app.delete('/api/items/:id', (req, res) => {
  db.run(`DELETE FROM items WHERE id=?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

/* ══════════════════════════════════════
   SHOP SETTINGS
══════════════════════════════════════ */
app.get('/api/settings', (req, res) => {
  db.all('SELECT key, value FROM settings', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    res.json(obj);
  });
});

app.put('/api/settings', (req, res) => {
  const updates = req.body;  // { key: value, ... }
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(updates).forEach(([k, v]) => stmt.run(k, v == null ? '' : String(v)));
  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

/* ══════════════════════════════════════
   BILLS  — save & list
══════════════════════════════════════ */

// Get next invoice number
app.get('/api/bills/next-invoice', (req, res) => {
  db.get("SELECT value FROM settings WHERE key='next_invoice'", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get("SELECT value FROM settings WHERE key='bill_prefix'", (err2, prefixRow) => {
      const num    = row    ? String(row.value).padStart(4, '0') : '0001';
      const prefix = prefixRow ? prefixRow.value : 'INV';
      res.json({ invoice: `${prefix}-${num}` });
    });
  });
});

// Save a bill
app.post('/api/bills', (req, res) => {
  const { invoice_no, date, items, total } = req.body;
  if (!invoice_no || !items || !total) return res.status(400).json({ error: 'Missing fields' });

  db.run(
    `INSERT INTO bills (invoice_no, date, items_json, total) VALUES (?,?,?,?)`,
    [invoice_no, date, JSON.stringify(items), total],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      // Increment next_invoice counter
      db.run(`UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'next_invoice'`);
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Get all bills
app.get('/api/bills', (req, res) => {
  db.all('SELECT * FROM bills ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({
      id: r.id, invoice_no: r.invoice_no, date: r.date,
      items: JSON.parse(r.items_json || '[]'),
      total: r.total, created_at: r.created_at
    })));
  });
});

// Get single bill
app.get('/api/bills/:id', (req, res) => {
  db.get('SELECT * FROM bills WHERE id=?', [req.params.id], (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!r)  return res.status(404).json({ error: 'Not found' });
    res.json({ id:r.id, invoice_no:r.invoice_no, date:r.date,
               items: JSON.parse(r.items_json||'[]'), total:r.total, created_at:r.created_at });
  });
});

// Delete a bill
app.delete('/api/bills/:id', (req, res) => {
  db.run(`DELETE FROM bills WHERE id=?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
