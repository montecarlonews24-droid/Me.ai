// Me.ai Push: بيبعت رسائل Firebase Cloud Messaging لتطبيق Me.ai (topic "meai")
// - node push.cjs wake        → بيصحّي التطبيق ليفحص مستقل وخمسات وFreelancer وLinkedIn
// - require("./push.cjs").lead({...}) → إشعار فرصة لقاها الـ Agent
// المفتاح: secret اسمه FCM_SERVICE_ACCOUNT (ملف service account من Firebase، النص كامل)
const crypto = require('crypto');

let cached = null;
async function token() {
  const raw = (process.env.FCM_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT missing');
  if (cached && cached.exp > Date.now() + 60000) return cached;
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200));
  cached = { at: j.access_token, project: sa.project_id, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached;
}

async function send(data) {
  const t = await token();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${t.project}/messages:send`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t.at, 'Content-Type': 'application/json' },
    // رسالة بيانات بأولوية عالية: بتصحّي التطبيق حتى لو مسكّر
    body: JSON.stringify({ message: { topic: 'meai', data, android: { priority: 'HIGH', ttl: '900s' } } }),
    signal: AbortSignal.timeout(15000)
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`FCM ${r.status} ${txt.slice(0, 200)}`);
  return r.status;
}

const wake = () => send({ type: 'wake', at: String(Date.now()) });
const lead = ({ title, url, platform, head }) =>
  send({ type: 'lead', title: String(title || '').slice(0, 300), url: String(url || ''), platform: String(platform || ''), head: String(head || '💼 فرصة جديدة').slice(0, 120) });

module.exports = { wake, lead, send };

if (require.main === module) {
  const what = process.argv[2] || 'wake';
  (what === 'wake' ? wake() : Promise.reject(new Error('unknown ' + what)))
    .then(s => console.log('push ' + what + ' ok ' + s))
    .catch(e => { console.error(e.message); process.exit(1); });
}
