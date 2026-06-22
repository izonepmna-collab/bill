const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const db       = require('./db');

const JWT_SECRET = 'izone-super-secret-key-123'; // In production, use process.env.JWT_SECRET

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════
   AUTHENTICATION & MIDDLEWARE
══════════════════════════════════════ */

// Middleware to verify token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Middleware for MD only
function requireMD(req, res, next) {
  if (req.user.role !== 'MD') return res.status(403).json({ error: 'MD access required' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    
    // Log history
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    db.run('INSERT INTO login_history (user_id, username, role, ip_address) VALUES (?, ?, ?, ?)', 
      [user.id, user.username, user.role, ip]);

    res.json({ token, role: user.role, username: user.username });
  });
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

/* ══════════════════════════════════════
   USER MANAGEMENT (MD ONLY)
══════════════════════════════════════ */
app.get('/api/users', authenticateToken, requireMD, (req, res) => {
  db.all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', authenticateToken, requireMD, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'All fields required' });
  
  const hash = bcrypt.hashSync(password, 8);
  db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/users/:id', authenticateToken, requireMD, (req, res) => {
  db.run('DELETE FROM users WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get('/api/login-history', authenticateToken, requireMD, (req, res) => {
  db.all('SELECT * FROM login_history ORDER BY login_time DESC LIMIT 100', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/* ══════════════════════════════════════
   ITEMS
══════════════════════════════════════ */
app.get('/api/items', authenticateToken, (req, res) => {
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

app.post('/api/items', authenticateToken, requireMD, (req, res) => {
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

app.put('/api/items/:id', authenticateToken, requireMD, (req, res) => {
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

app.delete('/api/items/:id', authenticateToken, requireMD, (req, res) => {
  db.run(`DELETE FROM items WHERE id=?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

/* ══════════════════════════════════════
   SHOP SETTINGS
══════════════════════════════════════ */
app.get('/api/settings', (req, res) => {
  // Settings are public so login page can show shop name
  db.all('SELECT key, value FROM settings', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    res.json(obj);
  });
});

app.put('/api/settings', authenticateToken, requireMD, (req, res) => {
  const updates = req.body;  // { key: value, ... }
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(updates).forEach(([k, v]) => stmt.run(k, v == null ? '' : String(v)));
  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

/* ══════════════════════════════════════
   TRANSACTIONS (INCOME/EXPENSE)
══════════════════════════════════════ */

// Get summary report grouped by date
app.get('/api/transactions/summary', authenticateToken, requireMD, (req, res) => {
  const query = `
    SELECT 
      date,
      SUM(CASE WHEN type = 'Income' AND mode = 'Cash' THEN amount ELSE 0 END) as income_cash,
      SUM(CASE WHEN type = 'Income' AND mode = 'Online' THEN amount ELSE 0 END) as income_online,
      SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END) as total_expense
    FROM transactions
    GROUP BY date
    ORDER BY date DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get daily transactions
app.get('/api/transactions', authenticateToken, requireMD, (req, res) => {
  const { date } = req.query;
  let query = 'SELECT * FROM transactions';
  const params = [];
  
  if (date) {
    query += ' WHERE date = ?';
    params.push(date);
  }
  query += ' ORDER BY created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Add new transaction
app.post('/api/transactions', authenticateToken, requireMD, (req, res) => {
  const { date, type, mode, amount, remarks } = req.body;
  if (!date || !type || !amount) return res.status(400).json({ error: 'Missing fields' });

  db.run(
    `INSERT INTO transactions (date, type, mode, amount, remarks) VALUES (?, ?, ?, ?, ?)`,
    [date, type, mode || '', amount, remarks || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Delete a transaction
app.delete('/api/transactions/:id', authenticateToken, requireMD, (req, res) => {
  db.run(`DELETE FROM transactions WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

/* ══════════════════════════════════════
   BILLS  — save & list
══════════════════════════════════════ */

// Get next invoice number
app.get('/api/bills/next-invoice', authenticateToken, (req, res) => {
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
app.post('/api/bills', authenticateToken, (req, res) => {
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
app.get('/api/bills', authenticateToken, requireMD, (req, res) => {
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
app.get('/api/bills/:id', authenticateToken, requireMD, (req, res) => {
  db.get('SELECT * FROM bills WHERE id=?', [req.params.id], (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!r)  return res.status(404).json({ error: 'Not found' });
    res.json({ id:r.id, invoice_no:r.invoice_no, date:r.date,
               items: JSON.parse(r.items_json||'[]'), total:r.total, created_at:r.created_at });
  });
});

// Delete a bill
app.delete('/api/bills/:id', authenticateToken, requireMD, (req, res) => {
  db.run(`DELETE FROM bills WHERE id=?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
