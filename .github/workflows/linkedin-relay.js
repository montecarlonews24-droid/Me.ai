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
  });
  console.log('LinkedIn emails: ' + threads.length + ', jobs sent: ' + sent);
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
