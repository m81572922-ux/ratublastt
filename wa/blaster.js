// RatuBlast — wa/blaster.js
import { db, getSetting } from '../db.js';
import { getSession } from './manager.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function jitter(baseSec, spreadSec = 2) {
  const min = Math.max(1, baseSec - spreadSec);
  const max = baseSec + spreadSec;
  return (min + Math.random() * (max - min)) * 1000;
}

function normalizeNumber(raw) {
  let n = String(raw).replace(/[^0-9]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (n.startsWith('620')) n = '62' + n.slice(3);
  return n;
}
function isValidNumber(n) { return /^62\d{8,13}$/.test(n); }

export async function runBlast({ user_id, device_id, targets, delaySec = 5 }) {
  const s = getSession(device_id);
  if (!s || s.status !== 'online') throw new Error('Device offline');

  const promoText = getSetting('promo_text') || 'Yuk join RatuBlast!';
  const promoImage = getSetting('promo_image') || '';
  const csLink = getSetting('cs_link') || '';
  const chLink = getSetting('ch_link') || '';

  let caption = promoText;
  if (csLink || chLink) {
    caption += '\n\n';
    if (csLink) caption += `\ud83d\udcde CS: ${csLink}\n`;
    if (chLink) caption += `\ud83d\udce2 Channel: ${chLink}`;
  }

  const cleanTargets = targets.map(normalizeNumber).filter(isValidNumber);
  if (!cleanTargets.length) throw new Error('Tidak ada nomor valid');

  const blastInfo = db.prepare('INSERT INTO blasts (user_id, device_id, total) VALUES (?,?,?)')
    .run(user_id, device_id, cleanTargets.length);
  const blastId = blastInfo.lastInsertRowid;

  let sukses = 0, gagal = 0, skippedQuota = 0;

  for (const number of cleanTargets) {
    const u = db.prepare('SELECT quota, referred_by FROM users WHERE id=?').get(user_id);
    if (!u || u.quota <= 0) { skippedQuota++; gagal++; continue; }

    const jid = `${number}@s.whatsapp.net`;
    let sent = false;

    for (let attempt = 1; attempt <= 2 && !sent; attempt++) {
      try {
        if (promoImage) {
          await s.sock.sendMessage(jid, { image: { url: promoImage }, caption });
        } else {
          await s.sock.sendMessage(jid, { text: caption });
        }
        sent = true;
      } catch(e) {
        if (attempt === 2) {
          db.prepare('INSERT INTO targets (device_id, number, status) VALUES (?,?,?)')
            .run(device_id, number, 'failed');
          gagal++;
        } else {
          await sleep(1500);
        }
      }
    }

    if (sent) {
      sukses++;
      db.prepare('UPDATE users SET quota = quota - 1 WHERE id=?').run(user_id);
      if (u.referred_by) {
        const KOMISI = 50;
        db.prepare('UPDATE users SET saldo = saldo + ?, referral_earnings = COALESCE(referral_earnings,0) + ? WHERE referral_code=?')
          .run(KOMISI, KOMISI, u.referred_by);
      }
      db.prepare('INSERT INTO targets (device_id, number, status, sent_at) VALUES (?,?,?,?)')
        .run(device_id, number, 'sent', Math.floor(Date.now()/1000));
    }

    if (number !== cleanTargets[cleanTargets.length - 1]) {
      await sleep(jitter(delaySec, 2));
    }
  }

  db.prepare('UPDATE blasts SET sukses=?, gagal=? WHERE id=?').run(sukses, gagal, blastId);
  return { blastId, total: cleanTargets.length, sukses, gagal, skippedQuota };
}
