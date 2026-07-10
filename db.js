const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db     = new sqlite3.Database(dbPath);

const initialData = [
  { name:'A4 Black Single', category:'Black Print', type:'slab', prices:[{min:1,max:20,rate:2},{min:21,max:50,rate:1.5},{min:51,max:99,rate:1.2},{min:100,max:100000,rate:1}] },
  { name:'A4 Black Double', category:'Black Print', type:'slab', prices:[{min:1,max:100,rate:1},{min:101,max:500,rate:0.8},{min:501,max:1000,rate:0.7},{min:1001,max:100000,rate:0.6}] },
  { name:'Color Print',     category:'Color Print', type:'variants', variants:[{name:'A4 Single Side',rate:10},{name:'A4 Double Side',rate:20}] },
  { name:'Photostat',       category:'Photostat',   type:'variants', variants:[{name:'Single Side',rate:2},{name:'Double Side',rate:3}] },
  { name:'DTP',             category:'DTP',         type:'variants', variants:[{name:'English (per page)',rate:50},{name:'Malayalam (per page)',rate:80}] },
  { name:'Browsing',        category:'Browsing',    type:'fixed', rate:40 }
];

const defaultSettings = {
  shop_name:    'I ZONE',
  tagline:      'High Quality Printing & Browsing Services',
  address:      'Your Address Here',
  city:         'City, State',
  phone:        '+91 00000 00000',
  email:        '',
  gstin:        '',
  logo_base64:  '',
  bill_prefix:  'INV',
  next_invoice: 1
};

db.serialize(() => {

  // ── Items table ──────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT UNIQUE,
    category TEXT DEFAULT '',
    type     TEXT,
    rate     REAL,
    prices   TEXT,
    variants TEXT
  )`);
  db.run(`ALTER TABLE items ADD COLUMN category TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE items ADD COLUMN variants TEXT`,            () => {});

  // ── Shop settings table ───────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`);

  // ── Bills table ────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no  TEXT,
    date        TEXT,
    items_json  TEXT,
    total       REAL,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── Users table ────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE,
    password_hash TEXT,
    role          TEXT,
    email         TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // Migration: add email column to existing databases
  db.run(`ALTER TABLE users ADD COLUMN email TEXT`, () => {});

  // ── Login History table ────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS login_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    username   TEXT,
    role       TEXT,
    login_time TEXT DEFAULT (datetime('now','localtime')),
    ip_address TEXT
  )`);

  // ── Transactions (Income/Expense) table ────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT,
    type       TEXT, -- 'Income' or 'Expense'
    mode       TEXT, -- 'Cash' or 'Online'
    amount     REAL,
    remarks    TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── Holidays table ──────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS holidays (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT UNIQUE,
    description TEXT
  )`);

  // Seed items if empty
  db.get('SELECT COUNT(*) as count FROM items', (err, row) => {
    if (err || row.count > 0) return;
    const stmt = db.prepare('INSERT INTO items (name, category, type, rate, prices, variants) VALUES (?, ?, ?, ?, ?, ?)');
    initialData.forEach(item => {
      stmt.run(
        item.name, item.category || '', item.type,
        item.rate || null,
        item.prices   ? JSON.stringify(item.prices)   : null,
        item.variants ? JSON.stringify(item.variants) : null
      );
    });
    stmt.finalize();
    console.log('Items seeded.');
  });

  // Seed default settings if empty
  db.get('SELECT COUNT(*) as count FROM settings', (err, row) => {
    if (err || row.count > 0) return;
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    Object.entries(defaultSettings).forEach(([k, v]) => stmt.run(k, String(v)));
    stmt.finalize();
    console.log('Settings seeded.');
  });

  // Seed default MD user if empty
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err || row.count > 0) return;
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('Muhsin@123', 8);
    db.run(
      'INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)',
      ['muhsin', hash, 'MD', 'muhsin@izone.com'],
      (err2) => {
        if (err2) console.error(err2);
        else console.log('MD user seeded. Username: muhsin | Email: muhsin@izone.com');
      }
    );
  });

});

module.exports = db;
