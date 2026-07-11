const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const nodemailer = require('nodemailer');
const db       = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'izone-super-secret-key-123';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════
   EMAIL HELPER
══════════════════════════════════════ */
async function sendResetEmail(toEmail, username, tempPassword) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const mailOptions = {
    from: `"I Zone Billing System" <${user || 'no-reply@izone.com'}>`,
    to: toEmail,
    subject: 'Password Reset – I Zone Billing System',
    text: `Hello ${username},\n\nYour temporary password is: ${tempPassword}\n\nPlease log in and change your password immediately from Settings.\n\nBest regards,\nI Zone System`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:12px;">
        <h2 style="color:#8b5cf6;">🔑 Password Reset</h2>
        <p>Hello <strong>${username}</strong>,</p>
        <p>Your temporary password for the <strong>I Zone Billing System</strong> is:</p>
        <div style="background:#f1f5f9;padding:16px;font-size:22px;font-weight:bold;text-align:center;border-radius:8px;letter-spacing:3px;color:#1e293b;margin:20px 0;">
          ${tempPassword}
        </div>
        <p>Please log in with this password and change it immediately from the <strong>Settings → Change Password</strong> section.</p>
        <hr style="border:0;border-top:1px solid #eee;margin:20px 0;">
        <p style="font-size:12px;color:#94a3b8;">This is an automated message. Please do not reply.</p>
      </div>
    `
  };

  if (host && user && pass) {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });
    await transporter.sendMail(mailOptions);
    console.log(`✉️  Password reset email sent to ${toEmail}`);
    return true;
  } else {
    console.log(`
============================================================
✉️  [MAIL SIMULATOR] Password Reset Email
To:       ${toEmail}
Username: ${username}
Temp Pw:  ${tempPassword}
============================================================`);
    return false;
  }
}

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
   PASSWORD RESET (PUBLIC – no token needed)
══════════════════════════════════════ */
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'No account found with this email address' });

    // Generate 8-char temporary password
    const tempPassword = crypto.randomBytes(4).toString('hex');
    const hash = bcrypt.hashSync(tempPassword, 8);

    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id], async function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });

      console.log(`\n🔑 [PASSWORD RESET] User: "${user.username}" (${user.email}) → Temp password: ${tempPassword}\n`);

      let mailSent = false;
      try {
        mailSent = await sendResetEmail(user.email, user.username, tempPassword);
      } catch (mailErr) {
        console.error('Mail error:', mailErr.message);
      }

      const response = {
        success: true,
        message: mailSent
          ? 'A temporary password has been sent to your email.'
          : 'Password reset. (No mail server configured – check server console)'
      };

      // If MD (admin) role, return temp password directly in response
      if (user.role === 'MD') {
        response.tempPassword = tempPassword;
        response.username = user.username;
      }

      res.json(response);
    });
  });
});

/* ══════════════════════════════════════
   CHANGE PASSWORD (authenticated)
══════════════════════════════════════ */
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }

  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const newHash = bcrypt.hashSync(newPassword, 8);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      console.log(`🔐 Password changed for user: ${user.username}`);
      res.json({ success: true, message: 'Password changed successfully.' });
    });
  });
});


/* ══════════════════════════════════════
   CHANGE EMAIL (authenticated)
══════════════════════════════════════ */
app.post('/api/auth/change-email', authenticateToken, (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }
  db.run('UPDATE users SET email = ? WHERE id = ?', [email.trim(), req.user.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Email updated successfully.' });
  });
});

/* ══════════════════════════════════════
   USER MANAGEMENT (MD ONLY)
══════════════════════════════════════ */
app.get('/api/users', authenticateToken, requireMD, (req, res) => {
  db.all('SELECT id, username, role, email, created_at FROM users ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', authenticateToken, requireMD, (req, res) => {
  const { username, password, role, email } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'username, password and role are required' });
  
  const hash = bcrypt.hashSync(password, 8);
  db.run('INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)', [username, hash, role, email || ''], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// Update user details (role, email)
app.put('/api/users/:id', authenticateToken, requireMD, (req, res) => {
  const { role, email } = req.body;
  const { id } = req.params;
  const fields = [];
  const values = [];
  if (role)  { fields.push('role = ?');  values.push(role); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(id);
  db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Admin reset password for any user
app.put('/api/users/:id/reset-password', authenticateToken, requireMD, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const hash = bcrypt.hashSync(newPassword, 8);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
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
   HOLIDAYS
══════════════════════════════════════ */

app.get('/api/holidays', authenticateToken, (req, res) => {
  db.all('SELECT * FROM holidays ORDER BY date DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/holidays', authenticateToken, requireMD, (req, res) => {
  const { date, description } = req.body;
  if (!date) return res.status(400).json({ error: 'Date is required' });
  db.run('INSERT OR REPLACE INTO holidays (date, description) VALUES (?, ?)', [date, description || 'Closed'], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/holidays/:date', authenticateToken, requireMD, (req, res) => {
  db.run('DELETE FROM holidays WHERE date = ?', [req.params.date], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

/* ══════════════════════════════════════
   TRANSACTIONS (INCOME/EXPENSE)
══════════════════════════════════════ */

// Get summary report grouped by date (excluding holidays)
app.get('/api/transactions/summary', authenticateToken, requireMD, (req, res) => {
  const query = `
    SELECT 
      date,
      SUM(CASE WHEN type = 'Income' AND mode = 'Cash' THEN amount ELSE 0 END) as income_cash,
      SUM(CASE WHEN type = 'Income' AND mode = 'Online' THEN amount ELSE 0 END) as income_online,
      SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END) as total_expense
    FROM transactions
    WHERE date NOT IN (SELECT date FROM holidays)
    GROUP BY date
    ORDER BY date ASC
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
  const { invoice_no, date, items, total, customer_name } = req.body;
  if (!invoice_no || !items || !total) return res.status(400).json({ error: 'Missing fields' });
  const customer = customer_name || 'Cash';

  db.run(
    `INSERT INTO bills (invoice_no, date, items_json, total, customer_name) VALUES (?,?,?,?,?)`,
    [invoice_no, date, JSON.stringify(items), total, customer],
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
      customer_name: r.customer_name || 'Cash',
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
               customer_name: r.customer_name || 'Cash',
               items: JSON.parse(r.items_json||'[]'), total:r.total, created_at:r.created_at });
  });
});

/* ══════════════════════════════════════
   STOCK MANAGEMENT
══════════════════════════════════════ */

// Get all stock items
app.get('/api/stock', authenticateToken, (req, res) => {
  db.all('SELECT * FROM stock ORDER BY item_name', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Add or update a stock item
app.post('/api/stock', authenticateToken, requireMD, (req, res) => {
  const { item_name, quantity, unit, low_alert } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name is required' });
  db.run(
    `INSERT INTO stock (item_name, quantity, unit, low_alert, updated_at)
     VALUES (?,?,?,?, datetime('now','localtime'))
     ON CONFLICT(item_name) DO UPDATE SET
       quantity=excluded.quantity, unit=excluded.unit,
       low_alert=excluded.low_alert, updated_at=excluded.updated_at`,
    [item_name, quantity||0, unit||'pcs', low_alert!=null?low_alert:10],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Adjust stock quantity (add/subtract)
app.put('/api/stock/:item_name', authenticateToken, requireMD, (req, res) => {
  const { delta, quantity } = req.body; // delta = ±amount, or set absolute quantity
  const name = decodeURIComponent(req.params.item_name);
  if (quantity !== undefined) {
    db.run(`UPDATE stock SET quantity=?, updated_at=datetime('now','localtime') WHERE item_name=?`,
      [quantity, name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
  } else {
    db.run(`UPDATE stock SET quantity=MAX(0,quantity+?), updated_at=datetime('now','localtime') WHERE item_name=?`,
      [delta||0, name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
  }
});

// Delete stock item
app.delete('/api/stock/:id', authenticateToken, requireMD, (req, res) => {
  db.run('DELETE FROM stock WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
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
