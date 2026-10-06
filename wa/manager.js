// RatuBlast — wa/manager.js
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs';
import { db, getSetting } from '../db.js';

const sessions = new Map();
const SESSION_ROOT = process.env.SESSION_ROOT || './sessions';

export async function startSession(device_id, onQR, onCode, onReady, onClose) {
  const dir = `${SESSION_ROOT}/${device_id}`;
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: state,
  });

  sessions.set(device_id, { sock, status: 'pairing' });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && onQR) {
      const dataUrl = await QRCode.toDataURL(qr);
      onQR(dataUrl);
    }
    if (connection === 'open') {
      sessions.get(device_id).status = 'online';
      const phone = sock.user?.id?.split(':')[0];
      db.prepare('UPDATE devices SET status=?, phone=?, connected_at=? WHERE device_id=?')
        .run('online', phone, Math.floor(Date.now()/1000), device_id);
      if (onReady) onReady(phone);
      try {
        const promoText = getSetting('promo_text');
        await sock.sendMessage(sock.user.id, {
          text: `\u2705 Device berhasil terhubung ke RatuBlast.\n\n\ud83d\udce2 *Promo aktif:*\n${promoText}`
        });
      } catch(e) {}
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      sessions.get(device_id).status = 'offline';
      db.prepare('UPDATE devices SET status=? WHERE device_id=?').run('offline', device_id);
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => startSession(device_id, onQR, onCode, onReady, onClose), 3000);
      }
      if (onClose) onClose(code);
    }
  });

  return sock;
}

export async function requestPairingCode(sock, phone) {
  return await sock.requestPairingCode(phone);
}
export function getSession(device_id) { return sessions.get(device_id); }
export function hasSession(device_id) {
  return sessions.has(device_id) && sessions.get(device_id).status === 'online';
}
export function listSessions() {
  return Array.from(sessions.entries()).map(([id, s]) => ({ device_id: id, status: s.status }));
}
