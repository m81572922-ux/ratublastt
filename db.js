// RatuBlast — db.js
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DB_PATH || 'ratublast.db';
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  saldo INTEGER DEFAULT 0,
  quota INTEGER DEFAULT 1000,
  quota_reset TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id TEXT UNIQUE NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'offline',
  session_dir TEXT,
  connected_at INTEGER
);
CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  number TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at INTEGER
);
CREATE TABLE IF NOT EXISTS blasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  total INTEGER DEFAULT 0,
  sukses INTEGER DEFAULT 0,
  gagal INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT,
  account TEXT,
  holder TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY, device_id TEXT, used INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
`);

try { db.exec('ALTER TABLE users ADD COLUMN referral_code TEXT'); } catch(e){}
try { db.exec('ALTER TABLE users ADD COLUMN referred_by TEXT'); } catch(e){}
try { db.exec('ALTER TABLE users ADD COLUMN referral_earnings INTEGER DEFAULT 0'); } catch(e){}

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASS || 'adminkuat123';
if (!db.prepare('SELECT id FROM users WHERE username=?').get(adminUser)) {
  db.prepare('INSERT INTO users (username,password,quota,referral_code) VALUES (?,?,?,?)')
    .run(adminUser, bcrypt.hashSync(adminPass, 10), 999999, 'ADMIN');
}

const defaults = {
  promo_text: 'Yuk join RatuBlast! Platform blast WhatsApp tercepat di Indonesia.',
  promo_image: '',
  cs_link: 'https://t.me/Vnmblck12',
  ch_link: 'https://t.me/Ratublastt',
};
for (const [k,v] of Object.entries(defaults)) {
  db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v);
}

export function getSetting(key, fallback='') {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
export function genLinkCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}
export function genReferralCode(username) {
  const base = (username || 'RB').replace(/[^a-zA-Z0-9]/g,'').slice(0,3).toUpperCase() || 'RBL';
  return base + Math.floor(1000 + Math.random() * 9000).toString();
}
