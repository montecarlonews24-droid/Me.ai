// Me.ai LinkedIn relay: بيشغّله سكريبت Gmail كل ساعة. أي تعديل هون بيوصل لحاله.
const DB = 'https://meai-agent-ee448-default-rtdb.europe-west1.firebasedatabase.app/linkedin/';
const QUERY = 'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com) newer_than:4d -label:meai-done2';
const DONE = 'meai-done2';

/** شغّلها مرة وحدة بس: بتعمل التشغيل التلقائي كل ساعة، وبتجرّب أول دفعة */
function run() {
  const label = GmailApp.getUserLabelByName(DONE) || GmailApp.createLabel(DONE);
  const threads = GmailApp.search(QUERY, 0, 30);
  let sent = 0;
  threads.forEach(th => {
    th.getMessages().forEach(m => {
      const created = Math.floor(m.getDate().getTime() / 1000);
      extract(m).forEach(job => {
        const res = UrlFetchApp.fetch(DB + job.id + '.json', {
          method: 'put',
          contentType: 'application/json',
          payload: JSON.stringify({
            title: job.title.slice(0, 290),
            company: job.company.slice(0, 190),
            location: job.location.slice(0, 190),
            raw: job.raw.slice(0, 900),
            url: 'https://www.linkedin.com/jobs/view/' + job.id + '/',
            created: created
          }),
          muteHttpExceptions: true
        });
        if (res.getResponseCode() < 300) sent++;
        else console.log('Firebase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
      });
    });
    th.addLabel(label);
    // بيطلع من صندوق الوارد: مقروء ومؤرشف، وبيضل محفوظ بـ All Mail
    th.markRead();
    th.moveToArchive();
  });
  console.log('LinkedIn emails: ' + threads.length + ', jobs sent: ' + sent);
  cleanup();
  try { kick(); } catch (e) { console.log('kick error: ' + e); }
}

/** باقي إيميلات LinkedIn (إشعارات، مين شاف بروفايلك، اقتراحات...): بتنمحى من الوارد.
 *  الرسائل الحقيقية من الناس (messages-noreply) ما بتنلمس. المحذوف بيضل 30 يوم بـ Trash. */
/**
 * GitHub بيأخّر أو بيلغي التشغيل المجدول. فإذا آخر تقرير شغل أقدم من ساعة ونص،
 * السكريبت بيشغّل الـ Job Scout بنفسه. المفتاح محفوظ بـ Script Properties باسم GH_TOKEN.
 */
function kick() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GH_TOKEN');
  if (!token) { console.log('kick: GH_TOKEN missing'); return; }
  const H = 3600 * 1000, now = Date.now();
  // ما منعيد التشغيل إذا شغّلناه قبل أقل من ساعتين
  if (now - Number(props.getProperty('lastKick') || 0) < 1 * H) return;
  const res = UrlFetchApp.fetch('https://raw.githubusercontent.com/montecarlonews24-droid/Me.ai/main/reports/jobs-latest.json?t=' + now, { muteHttpExceptions: true });
  let last = 0;
  try { last = new Date(JSON.parse(res.getContentText()).generatedAt).getTime() || 0; } catch (e) {}
  const age = (now - last) / H;
  if (age < 1.5) { console.log('kick: last report ' + age.toFixed(1) + 'h old, no need'); return; }
  const r = UrlFetchApp.fetch('https://api.github.com/repos/montecarlonews24-droid/Me.ai/actions/workflows/daily-jobs.yml/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  console.log('kick: report was ' + age.toFixed(1) + 'h old, started Job Scout -> HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 150));
  if (r.getResponseCode() === 204) props.setProperty('lastKick', String(now));
}

function cleanup() {
  const q = 'in:inbox from:linkedin.com -from:(messages-noreply@linkedin.com OR inmail-hit-reply@linkedin.com OR jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com)';
  let removed = 0;
  for (let round = 0; round < 5; round++) {
    const list = GmailApp.search(q, 0, 100);
    if (!list.length) break;
    GmailApp.moveThreadsToTrash(list);
    removed += list.length;
  }
  console.log('LinkedIn notifications removed: ' + removed);

  // إيميلات Freelancer "مشاريع بتناسب مهاراتك": Me.ai بياخدها مباشرة من Freelancer، فما في داعي إلها.
  // رسائل الزبائن والمشاريع اللي ربحتها والدفعات ما بتنلمس.
  const fq = 'in:inbox from:freelancer.com "projects matching your skills"';
  let fl = 0;
  for (let round = 0; round < 5; round++) {
    const list = GmailApp.search(fq, 0, 100);
    if (!list.length) break;
    GmailApp.moveThreadsToTrash(list);
    fl += list.length;
  }
  console.log('Freelancer project emails removed: ' + fl);
}

/** بيطلّع الوظائف: لكل رابط وظيفة بياخد النص اللي حواليه، والـ Agent بيفهم منه العنوان الصح */
function extract(m) {
  const jobs = {};
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const junk = l => !l || /^[-=_•·*]{2,}$/.test(l) || /^(view job|apply|apply now|see all.*|easy apply|actively recruiting|promoted|new|save|\d+ (applicants|connections?|alumni|school alumni).*|.*linkedin\.com\/.*)$/i.test(l);
  const add = (id, text) => {
    const j = jobs[id] || (jobs[id] = { id: id, parts: [] });
    text = clean(text);
    if (!junk(text) && text.length < 200 && j.parts.indexOf(text) < 0) j.parts.push(text);
  };

  // 1) الـ HTML: كل نص جوا روابط الوظيفة (العنوان والشركة والمكان عادةً)
  const html = m.getBody();
  const re = /<a[^>]+href="[^"]*linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let r;
  while ((r = re.exec(html))) {
    const inner = r[2].replace(/<(br|\/p|\/div|\/td|\/tr|\/span)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&middot;|&#183;/g, '·');
    inner.split('\n').forEach(t => add(r[1], t));
  }

  // 2) النص العادي: 4 أسطر قبل رابط كل وظيفة
  const lines = m.getPlainBody().split(/\r?\n/).map(clean);
  lines.forEach((line, i) => {
    const hit = line.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/);
    if (!hit) return;
    const before = [];
    for (let k = i - 1; k >= 0 && before.length < 4; k--) {
      if (/linkedin\.com\/(?:comm\/)?jobs\/view\//.test(lines[k])) break;
      const l = lines[k].replace(/^view job:?/i, '').trim();
      if (!junk(l)) before.unshift(l);
    }
    before.forEach(t => add(hit[1], t));
  });

  return Object.values(jobs).filter(j => j.parts.length).map(j => ({
    id: j.id,
    title: j.parts[0],
    company: j.parts[1] || '',
    location: j.parts[2] || '',
    raw: j.parts.join(' | ')
  }));
}
