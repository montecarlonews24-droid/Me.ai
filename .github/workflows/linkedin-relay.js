// Me.ai LinkedIn relay: بيشغّله سكريبت Gmail كل ساعة. أي تعديل هون بيوصل لحاله.
const DB = 'https://meai-agent-ee448-default-rtdb.europe-west1.firebasedatabase.app/linkedin/';
const QUERY = 'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com) newer_than:4d -label:meai-done2';
const DONE = 'meai-done2';

/** شغّلها مرة وحدة بس: بتعمل التشغيل التلقائي كل ساعة، وبتجرّب أول دفعة */
function run() {
  try { arabWatch(); } catch (e) { console.log('arabWatch failed: ' + e); }
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
 * مستقل وخمسات من سيرفرات Google (مش من الموبايل): Tecno بيوقف Me.ai بالخلفية،
 * فالسكريبت هون بيقرأ قوائم المشاريع، وأول ما يلاقي مشروع تطبيق جديد بيبعت إيميل لـ Moe،
 * وبيرفع المشروع على Firebase عشان الـ Agent يحكم عليه ويكتبله عرض.
 * بيشتغل مع run() كل مرة السكريبت بيشتغل.
 */
const ARAB = [
  { name: 'Mostaql', tag: '🔵 مستقل', node: 'mostaql', base: 'https://mostaql.com',
    lists: ['https://mostaql.com/projects?category=development&sort=latest',
            'https://mostaql.com/projects?category=ai-machine-learning&sort=latest',
            'https://mostaql.com/projects?keyword=%D8%AA%D8%B7%D8%A8%D9%8A%D9%82&sort=latest'],
    link: /href=["'](?:https?:\/\/(?:www\.)?mostaql\.com)?(\/project\/(\d{4,})[^"'#?]*)["'][^>]*>([\s\S]*?)<\/a>/gi },
  { name: 'Khamsat', tag: '🟡 خمسات', node: 'khamsat', base: 'https://khamsat.com',
    lists: ['https://khamsat.com/community/requests'],
    link: /href=["'](?:https?:\/\/(?:www\.)?khamsat\.com)?(\/community\/requests\/(\d{3,})[^"'#?]*)["'][^>]*>([\s\S]*?)<\/a>/gi }
];
const ARAB_APP = /تطبيق|أندرويد|اندرويد|android|apk|aab|play|جوجل بلاي|قوقل بلاي|متجر جوجل|تحويل موقع|webview|kotlin|كوتلن|ذكاء اصطناعي|\bai\b|وكيل ذكي/i;
const ARAB_NOT = /تصميم|مصمم|figma|فيجما|wireframe|ui\/ux|هوية|شعار|لوجو|logo|تسويق|ماركيتنج|marketing|إعلان|اعلان|حملات|سوشيال|مونتاج|فيديو|كتابة|محتوى|ترجمة|seo|flutter|فلاتر|react native|ووردبريس|wordpress|أتمتة|اتمتة|n8n|واتساب|تيليجرام|تلغرام|مختبرين|تقييمات/i;

function arabWatch() {
  const props = PropertiesService.getScriptProperties();
  // إيميل صاحب الحساب: من Session، وإذا ما في صلاحية، من آخر إيميل وصله
  let me = '';
  try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
  if (!me) {
    try { const t = GmailApp.search('in:inbox', 0, 1)[0]; me = (t.getMessages()[0].getTo().match(/[\w.+-]+@[\w.-]+/) || [''])[0]; } catch (e) {}
  }
  const status = {};
  ARAB.forEach(site => {
    const key = 'maxId_' + site.name;
    const lastMax = Number(props.getProperty(key) || 0);
    const found = {};
    let codes = [];
    site.lists.forEach(u => {
      try {
        const r = UrlFetchApp.fetch(u, {
          muteHttpExceptions: true, followRedirects: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
                     'Accept-Language': 'ar,en;q=0.8' }
        });
        const html = r.getContentText();
        let n = 0, m;
        site.link.lastIndex = 0;
        while ((m = site.link.exec(html))) {
          const title = m[3].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
          if (title.length < 8 || title.length > 200) continue;
          if (!found[m[2]]) found[m[2]] = { id: Number(m[2]), title: title, url: site.base + m[1] };
          n++;
        }
        codes.push(r.getResponseCode() + ':' + html.length + 'ch:' + n);
      } catch (e) { codes.push('err ' + String(e).slice(0, 40)); }
    });
    const list = Object.keys(found).map(k => found[k]);
    const pageMax = list.reduce((a, x) => Math.max(a, x.id), 0);
    // أول مرة: منسجّل أكبر رقم بس، بدون إيميلات، عشان ما يوصلك كل القديم مرة وحدة
    if (!lastMax) { if (pageMax) props.setProperty(key, String(pageMax)); status[site.name] = codes.join(' ') + ' baseline ' + pageMax; return; }
    const fresh = list.filter(x => x.id > lastMax && ARAB_APP.test(x.title) && !ARAB_NOT.test(x.title))
                      .sort((a, b) => b.id - a.id).slice(0, 8);
    fresh.forEach(x => {
      UrlFetchApp.fetch('https://meai-agent-ee448-default-rtdb.europe-west1.firebasedatabase.app/' + site.node + '/' + x.id + '.json', {
        method: 'put', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ title: x.title.slice(0, 290), url: x.url, text: '', created: Math.floor(Date.now() / 1000) })
      });
    });
    if (fresh.length) {
      const first = fresh[0];
      const more = fresh.length > 1 ? ' (+' + (fresh.length - 1) + ')' : '';
      const body = fresh.map(x => '<p style="font-size:16px"><a href="' + x.url + '">' + x.title + '</a></p>').join('') +
        '<p style="color:#888">من Me.ai: افتح المشروع وقدّم بسرعة قبل ما يزدحم.</p>';
      // GmailApp (مش MailApp): السكريبت عنده صلاحية Gmail أصلاً، فما بيطلب موافقة جديدة
      if (me) GmailApp.sendEmail(me, site.tag + ': ' + first.title.slice(0, 80) + more, fresh.map(x => x.title + '\n' + x.url).join('\n\n'), { htmlBody: body, name: 'Me.ai' });
    }
    if (pageMax > lastMax) props.setProperty(key, String(pageMax));
    status[site.name] = codes.join(' ') + ' new ' + fresh.length + (me ? '' : ' NO-EMAIL');
  });
  console.log('arabWatch: ' + JSON.stringify(status));
  // حالة آخر فحص، عشان Claude يتأكد إنه شغّال
  UrlFetchApp.fetch('https://meai-agent-ee448-default-rtdb.europe-west1.firebasedatabase.app/mostaqlStatus/gmail.json', {
    method: 'put', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ at: Math.floor(Date.now() / 1000), status: status })
  });
}

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
