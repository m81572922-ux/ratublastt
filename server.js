// RatuBlast — server.js
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, genLinkCode, genReferralCode } from './db.js';
import { startSession, requestPairingCode, getSession, hasSession, listSessions } from './wa/manager.js';
import { runBlast } from './wa/blaster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ubah-secret-ini',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 },
}));

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function auth(req, res, next) {
  if (!req.session.uid) return res.status(401).json({ ok: false, msg: 'Belum login' });
  next();
}
function adminOnly(req, res, next) {
  if (!req.session.isAdmin) return res.status(403).json({ ok: false, msg: 'Khusus admin' });
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ ok: false, msg: 'Isi semua field' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password)) return res.json({ ok: false, msg: 'Username / password salah' });
  req.session.uid = u.id;
  req.session.uname = u.username;
  req.session.isAdmin = u.username === (process.env.ADMIN_USER || 'admin');
  res.json({ ok: true, admin: req.session.isAdmin });
});

app.post('/api/register', (req, res) => {
  const { username, password, refCode } = req.body || {};
  if (!username || !password || password.length < 6) return res.json({ ok: false, msg: 'Username wajib & password minimal 6 karakter' });
  try {
    const myCode = genReferralCode(username);
    let referredBy = null;
    if (refCode) {
      const clean = String(refCode).trim().toUpperCase();
      const refOwner = db.prepare('SELECT referral_code FROM users WHERE referral_code=?').get(clean);
      if (refOwner) referredBy = clean;
    }
    db.prepare('INSERT INTO users (username, password, quota, referral_code, referred_by) VALUES (?,?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 10), Number(process.env.DAILY_QUOTA || 1000), myCode, referredBy);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, msg: 'Username sudah dipakai' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,saldo,quota FROM users WHERE id=?').get(req.session.uid);
  if (!u) return res.status(404).json({ ok: false });
  res.json({ ok: true, user: { ...u, isAdmin: !!req.session.isAdmin } });
});

app.get('/api/me/full', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,saldo,quota,created_at FROM users WHERE id=?').get(req.session.uid);
  if (!u) return res.status(404).json({ ok: false });
  const dev = db.prepare('SELECT COUNT(*) c FROM devices WHERE user_id=?').get(req.session.uid).c;
  const blast = db.prepare('SELECT COALESCE(SUM(sukses),0) s, COALESCE(SUM(gagal),0) g FROM blasts WHERE user_id=?').get(req.session.uid);
  res.json({ ok: true, user: { ...u, devices: dev, totalSukses: blast.s, totalGagal: blast.g } });
});

app.post('/api/me/password', auth, (req, res) => {
  const { oldPass, newPass } = req.body || {};
  if (!oldPass || !newPass || newPass.length < 6) return res.json({ ok: false, msg: 'Password baru minimal 6 karakter' });
  const u = db.prepare('SELECT password FROM users WHERE id=?').get(req.session.uid);
  if (!bcrypt.compareSync(oldPass, u.password)) return res.json({ ok: false, msg: 'Password lama salah' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPass, 10), req.session.uid);
  res.json({ ok: true });
});

app.post('/api/me/username', auth, (req, res) => {
  const { newUsername, password } = req.body || {};
  if (!newUsername || newUsername.length < 3) return res.json({ ok: false, msg: 'Username minimal 3 karakter' });
  const u = db.prepare('SELECT password FROM users WHERE id=?').get(req.session.uid);
  if (!bcrypt.compareSync(password, u.password)) return res.json({ ok: false, msg: 'Password salah' });
  try {
    db.prepare('UPDATE users SET username=? WHERE id=?').run(newUsername, req.session.uid);
    req.session.uname = newUsername;
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, msg: 'Username sudah dipakai' }); }
});

app.get('/api/devices', auth, (req, res) => {
  const list = db.prepare('SELECT * FROM devices WHERE user_id=?').all(req.session.uid);
  res.json({ ok: true, devices: list.map(d => ({ ...d, live: hasSession(d.device_id) })) });
});

app.post('/api/device/start', auth, async (req, res) => {
  const { device_id } = req.body || {};
  if (!device_id) return res.json({ ok: false, msg: 'device_id wajib' });
  db.prepare('INSERT OR IGNORE INTO devices (user_id, device_id, status) VALUES (?,?,?)').run(req.session.uid, device_id, 'pairing');
  let replied = false;
  const reply = (p) => { if (!replied) { replied = true; res.json(p); } };
  try {
    await startSession(device_id, (qrDataUrl) => reply({ ok: true, qr: qrDataUrl }), null, null, null);
    setTimeout(() => reply({ ok: false, msg: 'Timeout, coba lagi' }), 9000);
  } catch(e) { reply({ ok: false, msg: e.message }); }
});

app.post('/api/device/paircode', auth, async (req, res) => {
  const { device_id, phone } = req.body || {};
  if (!device_id || !phone) return res.json({ ok: false, msg: 'device_id + phone wajib' });
  db.prepare('INSERT OR IGNORE INTO devices (user_id, device_id, status) VALUES (?,?,?)').run(req.session.uid, device_id, 'pairing');
  const s = getSession(device_id);
  if (!s) return res.json({ ok: false, msg: 'Mulai device dulu via QR' });
  try {
    const code = await requestPairingCode(s.sock, phone.replace(/[^0-9]/g, ''));
    db.prepare('INSERT OR REPLACE INTO link_codes (code, device_id) VALUES (?,?)').run(code, device_id);
    res.json({ ok: true, code });
  } catch(e) { res.json({ ok: false, msg: e.message }); }
});

app.post('/api/link-code', auth, (req, res) => {
  const code = genLinkCode();
  db.prepare('INSERT INTO link_codes (code) VALUES (?)').run(code);
  res.json({ ok: true, code });
});

app.post('/api/blast', auth, async (req, res) => {
  const { device_id, numbers, delay } = req.body || {};
  if (!device_id || !Array.isArray(numbers) || !numbers.length) return res.json({ ok: false, msg: 'Data kurang' });
  try {
    const r = await runBlast({ user_id: req.session.uid, device_id, targets: numbers, delaySec: delay || 5 });
    res.json({ ok: true, ...r });
  } catch(e) { res.json({ ok: false, msg: e.message }); }
});

app.get('/api/blasts', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM blasts WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.session.uid);
  res.json({ ok: true, blasts: rows });
});

app.post('/api/wd', auth, (req, res) => {
  const { amount, method, account, holder } = req.body || {};
  if (!amount || amount < 10000) return res.json({ ok: false, msg: 'Minimal WD Rp 10.000' });
  const u = db.prepare('SELECT saldo, username FROM users WHERE id=?').get(req.session.uid);
  if (!u) return res.json({ ok: false, msg: 'User tidak ditemukan' });
  if (u.saldo < amount) return res.json({ ok: false, msg: 'Saldo tidak cukup' });
  db.prepare('UPDATE users SET saldo = saldo - ? WHERE id=?').run(amount, req.session.uid);
  db.prepare('INSERT INTO withdrawals (user_id, amount, method, account, holder) VALUES (?,?,?,?,?)')
    .run(req.session.uid, amount, method || 'DANA', account || '', holder || '');
  const adminWa = process.env.ADMIN_WA;
  if (adminWa) {
    const online = listSessions().find(s => s.status === 'online');
    if (online) {
      const s = getSession(online.device_id);
      const msg = `\ud83c\udf89HALO ADMIN SAYA MAU WD SEBESAR (Rp ${Number(amount).toLocaleString('id-ID')}) TOLONG SEGERA TERANFER KE NOMOR (${account} - ${method})\ud83c\udf89\ud83d\ude0d\n\nUser: ${u.username}\nNama: ${holder}`;
      s.sock.sendMessage(adminWa.replace(/[^0-9]/g, '') + '@s.whatsapp.net', { text: msg }).catch(() => {});
    }
  }
  res.json({ ok: true });
});

app.get('/api/wd/mine', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC').all(req.session.uid);
  res.json({ ok: true, withdrawals: rows });
});

app.get('/api/settings/public', auth, (req, res) => {
  res.json({ ok: true, settings: { cs_link: getSetting('cs_link'), ch_link: getSetting('ch_link') } });
});

app.get('/api/referral', auth, (req, res) => {
  const u = db.prepare('SELECT referral_code FROM users WHERE id=?').get(req.session.uid);
  let code = u.referral_code;
  if (!code) {
    code = genReferralCode(req.session.uname || 'RB');
    db.prepare('UPDATE users SET referral_code=? WHERE id=?').run(code, req.session.uid);
  }
  const total = db.prepare('SELECT COUNT(*) c FROM users WHERE referred_by=?').get(code).c;
  const active = db.prepare('SELECT COUNT(DISTINCT u.id) c FROM users u JOIN devices d ON d.user_id = u.id WHERE u.referred_by=? AND d.status=?').get(code, 'online').c;
  const messages = db.prepare('SELECT COALESCE(SUM(b.sukses),0) s FROM blasts b JOIN users u ON u.id = b.user_id WHERE u.referred_by=?').get(code).s;
  const devices = db.prepare('SELECT COUNT(*) c FROM devices d JOIN users u ON u.id = d.user_id WHERE u.referred_by=? AND d.status=?').get(code, 'online').c;
  const earnings = db.prepare('SELECT COALESCE(referral_earnings,0) e FROM users WHERE id=?').get(req.session.uid).e;
  res.json({ ok: true, code, total, active, messages, devices, earnings });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USER || 'admin';
  if (username !== adminUser) return res.json({ ok: false, msg: 'Bukan admin' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password)) return res.json({ ok: false, msg: 'Password salah' });
  req.session.uid = u.id;
  req.session.uname = u.username;
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const totalDevices = db.prepare('SELECT COUNT(*) c FROM devices').get().c;
  const onlineDevices = db.prepare("SELECT COUNT(*) c FROM devices WHERE status='online'").get().c;
  const totalBlasts = db.prepare('SELECT COUNT(*) c FROM blasts').get().c;
  const totalSent = db.prepare('SELECT COALESCE(SUM(sukses),0) c FROM blasts').get().c;
  const totalFailed = db.prepare('SELECT COALESCE(SUM(gagal),0) c FROM blasts').get().c;
  const pendingWd = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c;
  res.json({ ok: true, stats: { totalUsers, totalDevices, onlineDevices, totalBlasts, totalSent, totalFailed, pendingWd } });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id,username,saldo,quota,referral_code,referred_by,created_at FROM users').all();
  res.json({ ok: true, users });
});

app.get('/api/admin/devices', auth, adminOnly, (req, res) => {
  const devices = db.prepare('SELECT d.*, u.username FROM devices d LEFT JOIN users u ON u.id = d.user_id').all();
  res.json({ ok: true, devices: devices.map(d => ({ ...d, live: hasSession(d.device_id) })) });
});

app.get('/api/admin/wd', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT w.*, u.username FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.id DESC').all();
  res.json({ ok: true, withdrawals: rows });
});

app.post('/api/admin/wd/:id', auth, adminOnly, (req, res) => {
  const { status } = req.body || {};
  const w = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if (!w) return res.json({ ok: false, msg: 'WD tidak ditemukan' });
  db.prepare('UPDATE withdrawals SET status=? WHERE id=?').run(status, req.params.id);
  if (status === 'rejected') db.prepare('UPDATE users SET saldo = saldo + ? WHERE id=?').run(w.amount, w.user_id);
  res.json({ ok: true });
});

app.get('/api/admin/settings', auth, adminOnly, (req, res) => {
  res.json({ ok: true, settings: {
    promo_text: getSetting('promo_text'),
    promo_image: getSetting('promo_image'),
    cs_link: getSetting('cs_link'),
    ch_link: getSetting('ch_link'),
  }});
});

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|jpg|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Format harus JPG/PNG/WEBP/GIF'), ok);
  },
});

app.post('/api/admin/settings', auth, adminOnly, (req, res) => {
  upload.single('promo_image')(req, res, (err) => {
    if (err) return res.json({ ok: false, msg: err.message || 'Upload gagal' });
    if (req.body.promo_text !== undefined) setSetting('promo_text', req.body.promo_text);
    if (req.body.cs_link) setSetting('cs_link', req.body.cs_link);
    if (req.body.ch_link) setSetting('ch_link', req.body.ch_link);
    if (req.file) {
      const old = getSetting('promo_image');
      if (old && old.startsWith('/uploads/promo_')) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(old))); } catch(e) {}
      }
      const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
      const fname = `promo_${Date.now()}${ext}`;
      fs.renameSync(req.file.path, path.join(UPLOAD_DIR, fname));
      setSetting('promo_image', '/uploads/' + fname);
    }
    res.json({ ok: true });
  });
});

app.delete('/api/admin/settings/promo_image', auth, adminOnly, (req, res) => {
  const current = getSetting('promo_image');
  if (current && current.startsWith('/uploads/promo_')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(current))); } catch(e) {}
  }
  setSetting('promo_image', '');
  res.json({ ok: true });
});

cron.schedule('0 0 * * *', () => {
  const adminUser = process.env.ADMIN_USER || 'admin';
  db.prepare('UPDATE users SET quota=? WHERE username != ?').run(Number(process.env.DAILY_QUOTA || 1000), adminUser);
  console.log('[cron] kuota harian di-reset');
});

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));
app.get('/perangkat', (req, res) => res.sendFile(path.join(__dirname, 'public/perangkat.html')));
app.get('/dompet', (req, res) => res.sendFile(path.join(__dirname, 'public/dompet.html')));
app.get('/referral', (req, res) => res.sendFile(path.join(__dirname, 'public/referral.html')));
app.get('/profil', (req, res) => res.sendFile(path.join(__dirname, 'public/profil.html')));
app.get('/setting', (req, res) => res.redirect('/profil'));

app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'admin/dashboard.html')));
app.get('/admin/perangkat', (req, res) => res.sendFile(path.join(__dirname, 'admin/perangkat.html')));
app.get('/admin/setting', (req, res) => res.sendFile(path.join(__dirname, 'admin/setting.html')));
app.get('/admin/wd', (req, res) => res.sendFile(path.join(__dirname, 'admin/wd.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[RatuBlast] up on http://localhost:${PORT}`);
  console.log(`[RatuBlast] admin: http://localhost:${PORT}/admin/login`);
});
