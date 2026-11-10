// SAMURAI NIHONGO — 本体
// 1日の流れ: ①あたらしいことば（レッスン）②ふくしゅう（おぼえ直し）③ひらがな → ミッションクリア
// 記録はこのスマホ（localStorage）に保存し、電波があれば Google スプレッドシート（Apps Script）へ送る。
(() => {
  'use strict';
  const CFG = window.SNH_CONFIG || {};
  const VERSION = '1.1.0'; // v9: N5 への道・1日30分・カタカナ・車カード・端末の登録
  const LS_KEY = 'snh_state_v1';
  const Q_KEY = 'snh_queue_v1';
  const app = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');

  // ---------- データの下ごしらえ ----------
  const WMAP = Object.fromEntries(WORDS.map((w) => [w.id, w]));
  const KANA = [];
  KANA_ROWS.forEach((r, ri) => r.list.forEach(([c, ro, say]) => KANA.push({ id: 'k_' + c, c, ro, say, row: ri })));
  const KMAP = Object.fromEntries(KANA.map((k) => [k.id, k]));
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30]; // おぼえ直しの箱ごとの「次に出す日」までの日数
  const XP = { ok: 10, lesson: 20, mission: 50, real: 20, say: 2, sayMaxDay: 30 };

  // ---------- 日付 ----------
  const pad = (n) => String(n).padStart(2, '0');
  function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }

  // ---------- 小道具 ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a, n) => shuffle(a).slice(0, n);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nameOr = (s) => (S && S.name ? S.name : 'Navin');
  const fill = (s) => String(s || '').split('{name}').join(nameOr());

  // ---------- 状態 ----------
  function blank() {
    return { v: 1, device: 'dev-' + uid(), name: '', created: Date.now(), xp: 0, days: {}, cards: {}, lesson: 0, kanaRows: 0, badges: {}, real: 0, sound: true, lastSync: 0, menuPerfect: false };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { S = null; }
  if (!S || S.v !== 1) S = blank();
  S = Object.assign(blank(), S);
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* 容量不足など */ } }
  save();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* noop */ }

  function day(ds = todayStr()) {
    if (!S.days[ds]) S.days[ds] = { xp: 0, ans: 0, ok: 0, sec: 0, m: [0, 0, 0], done: false, real: false, say: 0 };
    return S.days[ds];
  }
  const studied = (ds) => !!(S.days[ds] && S.days[ds].ans > 0);
  function streak() {
    const t = todayStr();
    let cur = studied(t) ? t : addDays(t, -1);
    let n = 0;
    while (studied(cur)) { n++; cur = addDays(cur, -1); }
    return n;
  }
  function bestStreak() {
    let best = 0; let run = 0; let prev = '';
    Object.keys(S.days).filter(studied).sort().forEach((k) => { run = prev && addDays(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; });
    return best;
  }
  function beltIdx(xp = S.xp) { let i = 0; BELTS.forEach((b, j) => { if (xp >= b[0]) i = j; }); return i; }

  // ---------- おぼえ直し（箱） ----------
  function card(id) { if (!S.cards[id]) S.cards[id] = { i: 0, b: 0, due: '', s: 0, c: 0, w: 0, last: '' }; return S.cards[id]; }
  const learned = (id) => !!(S.cards[id] && S.cards[id].i);
  function introduce(id) { const c = card(id); if (!c.i) { c.i = 1; c.b = 0; c.due = todayStr(); } }
  function grade(id, ok) {
    const c = card(id);
    c.i = 1; c.s++; c.last = todayStr();
    if (ok) {
      c.c++;
      // 箱を上げるのは「出す日」が来ている時だけ（ゲームのくり返しで同じ日に何段も上がらないように）
      if (!c.due || c.due <= todayStr()) { c.b = Math.min(c.b + 1, INTERVALS.length - 1); c.due = addDays(todayStr(), INTERVALS[c.b]); }
    } else { c.w++; c.b = 1; c.due = addDays(todayStr(), INTERVALS[1]); }
  }
  const learnedWords = () => WORDS.filter((w) => learned(w.id));
  const learnedKana = () => KANA.filter((k) => learned(k.id));
  const mastered = (list) => list.filter((x) => S.cards[x.id] && S.cards[x.id].b >= 3);
  function dueFirst(list) {
    const t = todayStr();
    return list.slice().sort((a, b) => {
      const ca = card(a.id); const cb = card(b.id);
      const da = ca.due <= t ? 0 : 1; const db = cb.due <= t ? 0 : 1;
      if (da !== db) return da - db;
      if (ca.b !== cb.b) return ca.b - cb.b;
      return (ca.due || '').localeCompare(cb.due || '');
    });
  }
  const weakWords = () => learnedWords().filter((w) => card(w.id).w > 0).sort((a, b) => (card(b.id).w - card(b.id).c * 0.3) - (card(a.id).w - card(a.id).c * 0.3));

  // ---------- 音（読み上げ・効果音） ----------
  let jaVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices() || [];
    jaVoice = vs.find((v) => /^ja/i.test(v.lang) && /Kyoko|O-ren|Otoya|Hattori/i.test(v.name)) || vs.find((v) => /^ja/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, rate = 0.85) {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(fill(text));
      u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice; u.rate = rate;
      // iOS は cancel の直後の speak を読まないことがあるので、話している時だけ止めて少し待つ
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(() => speechSynthesis.speak(u), 80); } else speechSynthesis.speak(u);
    } catch (e) { /* noop */ }
  }
  const ttsOf = (w) => w.tts || w.jp;
  // iOS: 最初のタップの中で一度だけ音を出して、読み上げと効果音を使えるようにする
  let unlocked = false;
  document.addEventListener('touchend', unlockAudio, { capture: true });
  document.addEventListener('click', unlockAudio, { capture: true });
  function unlockAudio() {
    if (unlocked) return; unlocked = true;
    try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) { /* noop */ }
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== 'running') actx.resume(); } catch (e) { /* noop */ }
  }
  let actx = null;
  function tone(freqs, dur = 0.12, type = 'sine', gap = 0.09) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state !== 'running') actx.resume();
      freqs.forEach((f, i) => {
        const o = actx.createOscillator(); const g = actx.createGain();
        o.type = type; o.frequency.value = f;
        const t0 = actx.currentTime + i * gap;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
      });
    } catch (e) { /* noop */ }
  }
  const sfx = { ok: () => tone([880, 1320]), ng: () => tone([220, 165], 0.18, 'square', 0.12), win: () => tone([523, 659, 784, 1047, 1319], 0.16, 'triangle', 0.1), tap: () => tone([660], 0.05) };

  // ---------- 演出 ----------
  function confetti(n = 40) {
    const box = document.createElement('div'); box.className = 'confetti';
    const em = ['🎉', '⭐', '✨', '🔥', '⚔️', '🏆', '🎌'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.textContent = em[i % em.length];
      s.style.left = Math.random() * 100 + 'vw';
      s.style.animationDelay = Math.random() * 0.6 + 's';
      s.style.fontSize = 16 + Math.random() * 22 + 'px';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }
  // ---------- 乗り物 GET の演出 ----------
  const carSrc = (j) => `cars/car${j}.webp?v=1`;
  function carGet(j) {
    const b = BELTS[j];
    const o = document.createElement('div'); o.className = 'carget';
    o.innerHTML = `
      <div class="cg-stage"><i class="cg-lines"></i><img class="cg-car" src="${carSrc(j)}" alt=""><i class="cg-shine"></i></div>
      <div class="cg-title">${esc(b[1])} <span>GET!</span></div>
      <div class="km cg-sub">${esc(T.beltUp)}<br><b>${esc(b[2])}</b></div>
      <button class="btn primary cg-ok">OK ▶</button>`;
    document.body.appendChild(o);
    requestAnimationFrame(() => o.classList.add('show'));
    setTimeout(() => { confetti(60); speak(b[1]); }, 1100);
    const close = () => { o.classList.remove('show'); setTimeout(() => o.remove(), 350); };
    o.querySelector('.cg-ok').onclick = close;
  }
  function toast(html, ms = 2200) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
  }

  // ---------- XP・バッジ ----------
  function addXP(n) {
    if (!n) return;
    const before = beltIdx();
    S.xp += n; day().xp += n;
    const after = beltIdx();
    if (after > before) {
      const b = BELTS[after];
      setTimeout(() => { sfx.win(); carGet(after); }, 600);
      logEvent('belt', { belt: b[1] });
    }
  }
  function award(id) {
    if (S.badges[id]) return;
    const b = BADGES.find((x) => x[0] === id); if (!b) return;
    S.badges[id] = todayStr();
    setTimeout(() => toast(`${b[1]} ${esc(T.newBadge)}<br><span class="km">${esc(b[2])}</span>`, 3000), 900);
    logEvent('badge', { badge: id, name: b[2] });
  }
  function checkBadges() {
    if (Object.keys(S.days).some(studied)) award('first');
    const hiraTotal = KANA.filter((k) => k.row < HIRA_ROWS).length; // バッジ「ひらがな」はひらがなだけで数える（v9 でカタカナを追加）
    const st = streak();
    if (st >= 3) award('streak3');
    if (st >= 7) award('streak7');
    if (st >= 30) award('streak30');
    const lw = learnedWords().length;
    if (lw >= 30) award('words30');
    if (lw >= 80) award('words80');
    const lk = learnedKana().filter((k) => k.row < HIRA_ROWS).length;
    if (lk >= Math.ceil(hiraTotal / 2)) award('kanaHalf');
    if (lk >= hiraTotal) award('kanaAll');
    if (S.menuPerfect) award('menu');
    if (S.real >= 5) award('real5');
  }

  // ---------- 記録の送信（Google スプレッドシート） ----------
  function loadQueue() { try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch (e) { return []; } }
  function saveQueue(q) {
    q = q.slice();
    // 1000件を超えたら、回答の記録から古い順に捨てる（ミッションや日々の集計を残すため）
    for (let i = 0; q.length > 1000 && i < q.length;) { if (q[i].type === 'answer') q.splice(i, 1); else i++; }
    try { localStorage.setItem(Q_KEY, JSON.stringify(q.slice(-1000))); } catch (e) { /* noop */ }
  }
  function logEvent(type, detail) {
    const q = loadQueue();
    q.push({ id: uid(), ts: new Date().toISOString(), date: todayStr(), type, detail: detail || {} });
    saveQueue(q);
    flushSoon();
  }
  function snapshot() {
    const t = todayStr();
    const days = {};
    for (let i = 0; i < 35; i++) { const k = addDays(t, -i); if (S.days[k]) days[k] = S.days[k]; }
    const b = BELTS[beltIdx()];
    return {
      app: 'samurai-nihongo', version: VERSION,
      xp: S.xp, belt: b[1], streak: streak(), best: bestStreak(),
      lesson: S.lesson, lessonTotal: LESSONS.length, kanaRows: S.kanaRows,
      words: learnedWords().length, wordsMastered: mastered(learnedWords()).length, wordsTotal: WORDS.length,
      kana: learnedKana().length, kanaMastered: mastered(learnedKana()).length, kanaTotal: KANA.length,
      hira: mastered(learnedKana().filter((k) => k.row < HIRA_ROWS)).length, kata: mastered(learnedKana().filter((k) => k.row >= HIRA_ROWS)).length,
      hiraTotal: KANA.filter((k) => k.row < HIRA_ROWS).length, kataTotal: KANA.filter((k) => k.row >= HIRA_ROWS).length,
      week: weekNo(), stage: stageOf(weekNo()).en, dailyMin: DAILY_MIN, carCards: (S.carCards || []).length,
      weak: weakWords().slice(0, 5).map((w) => [w.jp, w.km, card(w.id).c, card(w.id).w]),
      real: S.real, badges: Object.keys(S.badges),
      days,
      cards: Object.keys(S.cards).filter((id) => S.cards[id].i).map((id) => {
        const c = S.cards[id]; const w = WMAP[id]; const k = KMAP[id];
        return [id, w ? w.jp : k ? k.c : id, w ? w.km : k ? k.ro : '', c.b, c.s, c.c, c.w, c.last, c.due];
      }),
    };
  }
  let flushTimer = null; let flushing = false; let failN = 0;
  function retryLater() { failN++; clearTimeout(flushTimer); flushTimer = setTimeout(flush, Math.min(60000, 2000 * 2 ** Math.min(failN, 5))); }
  function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 1500); }
  async function flush() {
    if (!CFG.GAS_URL || flushing || !navigator.onLine) { syncLabel(); return; }
    const q = loadQueue();
    const batch = q.slice(0, 80);
    flushing = true;
    const ctl = new AbortController();
    const tmo = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(CFG.GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'log', key: CFG.APP_KEY, dev: S.device, events: batch, state: snapshot() }), signal: ctl.signal });
      const j = await res.json();
      if (j && j.ok) {
        const sent = new Set(batch.map((e) => e.id));
        const rest = loadQueue().filter((e) => !sent.has(e.id));
        saveQueue(rest);
        S.lastSync = Date.now(); S.syncError = ''; save();
        failN = 0;
        if (rest.length) setTimeout(flush, 400);
      } else if (j && j.error === 'device') {
        // v9: シートに登録されたスマホ（最初の1台）ではない。記録はスマホにためておく
        S.syncError = 'device'; save();
      } else { retryLater(); }
    } catch (e) { retryLater(); /* 圏外など。次にまとめて送る */ } finally { clearTimeout(tmo); flushing = false; syncLabel(); }
  }
  function syncLabel() {
    const el = document.getElementById('sync'); if (!el) return;
    if (!CFG.GAS_URL) { el.textContent = ''; return; }
    const n = loadQueue().length;
    if (S.syncError === 'device') { el.textContent = `⚠️ device ${S.device.slice(-6)}`; return; }
    el.textContent = n ?`⏳ ${T.waiting} (${n})` : S.lastSync ? `✓ ${T.synced}` : '';
  }
  window.addEventListener('online', flushSoon);

  // ---------- 使った時間（v9: 画面を触っている間だけ数える。開きっぱなしは数えない。1日30分が目標）----------
  let lastTouch = 0; let actSec = 0; // 最初に画面を触るまでは数えない
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
  function sessionEnd() {
    const sec = actSec; actSec = 0;
    if (sec >= 20) logEvent('session', { sec });
    save(); flush();
  }
  setInterval(() => {
    if (document.hidden || !S.welcomed || Date.now() - lastTouch > 60 * 1000) return;
    actSec += 5; day().sec += 5;
    if (actSec % 60 === 0) save();
    check30();
    const el = document.getElementById('t30'); if (el) el.innerHTML = t30Inner();
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) sessionEnd(); else render(); });
  window.addEventListener('pagehide', sessionEnd);
  setInterval(() => { if (actSec >= 300) sessionEnd(); }, 60 * 1000);

  // ---------- 1日30分・車カード（v9）----------
  function check30() {
    const d = day();
    if (d.t30 || (d.sec || 0) < DAILY_MIN * 60) return;
    d.t30 = true; addXP(XP_30); logEvent('t30', { min: DAILY_MIN });
    save(); sfx.win(); confetti(60);
    setTimeout(giveCarCard, 800);
  }
  function t30Inner() {
    const d = day(); const min = Math.floor((d.sec || 0) / 60);
    const pct = Math.min(100, Math.round((min / DAILY_MIN) * 100));
    return `<div class="t30-row"><b class="km">⏱ ${esc(T.todayTime)}</b><span class="t30-num">${min} <small>/ ${DAILY_MIN} min</small></span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <small class="km ${d.t30 ? 'okline' : 'dim'}">${d.t30 ? '🏆 ' + esc(T.done30) : '🎁 ' + esc(T.get30)}</small>`;
  }
  function giveCarCard() {
    const d = day(); if (d.card != null) return;
    S.carCards = S.carCards || [];
    if (S.carCards.length >= CAR_CARDS.length) { d.card = -1; save(); toast(esc(T.carsAll), 3000); return; }
    const idx = S.carCards.length; S.carCards.push(idx); d.card = idx; save();
    logEvent('car_card', { idx, name: CAR_CARDS[idx][1] });
    showCarCard(idx, true);
  }
  function showCarCard(idx, isNew) {
    const c = CAR_CARDS[idx];
    const o = document.createElement('div'); o.className = 'ccov';
    o.innerHTML = `
      <div class="ccbox ${isNew ? 'closed' : ''}">
        <button class="cc-front"><span>🎁</span><small class="km">${esc(T.carTap)}</small></button>
        <div class="cc-back">
          <small class="km dim">${esc(isNew ? T.carCard : T.carBook)}</small>
          <div class="cc-emo">${c[0]}</div><div class="cc-name">${esc(c[1])}</div>
          <button class="say-btn cc-ja">🔊 ${esc(c[2])}</button><div class="dim cc-ro">${esc(c[3])}</div>
          <p class="km cc-km">${esc(c[4])}</p>
          <button class="btn primary cc-ok">OK ▶</button>
        </div>
      </div>`;
    document.body.appendChild(o);
    requestAnimationFrame(() => o.classList.add('show'));
    const box = o.querySelector('.ccbox');
    o.querySelector('.cc-front').onclick = () => { box.classList.remove('closed'); sfx.win(); confetti(30); speak(c[2]); };
    if (!isNew) speak(c[2]);
    o.querySelector('.cc-ja').onclick = () => speak(c[2]);
    o.querySelector('.cc-ok').onclick = () => { o.classList.remove('show'); setTimeout(() => o.remove(), 300); if (!mode) render(); };
  }

  // ---------- N5 への道（33週の地図・v9）----------
  function weekNo() { const ms = new Date(todayStr() + 'T12:00:00') - new Date(ROAD.START + 'T12:00:00'); return Math.max(1, Math.min(33, Math.floor(ms / 86400000 / 7) + 1)); }
  function stageOf(w) { return ROAD.STAGES.find((s) => w >= s.from && w <= s.to) || ROAD.STAGES[0]; }
  function daysToExam() { return Math.max(0, Math.round((new Date(ROAD.EXAM + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 86400000)); }
  function roadCard() {
    const w = weekNo(); const s = stageOf(w); const c = ROAD.CURRICULUM[w - 1];
    return `<button class="card road" id="roadBtn" style="--st:${s.color}">
      <div class="road-top"><span class="road-chip">${s.icon} STAGE ${ROAD.STAGES.indexOf(s) + 1} · ${esc(s.en)} <span class="km">${esc(s.km)}</span></span><span class="road-exam">⏳ ${daysToExam()}<small class="km"> ${esc(T.daysLeft)} N5</small></span></div>
      <div class="road-week"><b class="km">${esc(T.week)}${w}</b> <small class="dim">/ 33</small> · <small class="km dim">${esc(T.thisWeek)}</small></div>
      <div class="road-theme">${esc([c[1], c[2], c[3]].filter(Boolean).join('・'))}</div>
      <div class="road-go km">🗺️ ${esc(T.map)} ▶</div>
    </button>`;
  }
  function renderMap() {
    mode = 'map'; tabbar.style.display = 'none';
    const w = weekNo(); let si = -1; let html = '';
    ROAD.CURRICULUM.forEach((r) => {
      const s = stageOf(r[0]); const idx = ROAD.STAGES.indexOf(s);
      if (idx !== si) { si = idx; html += `<div class="mstage" style="--st:${s.color}">${s.icon} STAGE ${idx + 1} · ${esc(s.en)} <span class="km">${esc(s.km)}</span><small>${esc(s.ja)}</small></div>`; }
      const here = r[0] === w; const past = r[0] < w;
      html += `<div class="mwk ${here ? 'here' : ''} ${past ? 'past' : ''}" style="--st:${s.color}"><div class="m-dot">${here ? '🚗' : past ? '✓' : r[0]}</div><div class="m-txt"><b>${esc(r[1])}</b><small>${esc([r[2], r[3]].filter(Boolean).join(' · '))}</small>${r[4] ? `<em>🏁 ${esc(r[4])}</em>` : ''}</div></div>`;
    });
    app.innerHTML = `
      <div class="top"><button class="x" id="quit">✕</button><b class="km map-title">🗺️ ${esc(T.map)}</b></div>
      <div class="goalbar">🏆 JLPT N5 — ${ROAD.EXAM.replace(/-/g, '/')} · ⏳ ${daysToExam()}</div>
      <div class="road-list">${html}</div>`;
    document.getElementById('quit').onclick = quit;
    window.scrollTo(0, 0);
    const h = app.querySelector('.mwk.here'); if (h) setTimeout(() => h.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
  }

  // ---------- 画面の切り替え ----------
  let tab = 'home';
  let mode = null; // クイズ・レッスン中は画面を占有する
  function setTab(t) { tab = t; mode = null; sfx.tap(); render(); window.scrollTo(0, 0); }
  function renderTabs() {
    const tabs = [['home', '🏠', T.home], ['games', '🎮', T.games], ['record', '📅', T.record], ['settings', '⚙️', T.settings]];
    tabbar.style.display = mode ? 'none' : '';
    tabbar.innerHTML = tabs.map(([k, ic, lb]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}"><span>${ic}</span><small>${esc(lb)}</small></button>`).join('');
    tabbar.querySelectorAll('button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  }
  function render() {
    if (!S.welcomed) { if (!document.getElementById('wName')) renderWelcome(); return; }
    if (mode) return; // 進行中の画面はそのまま
    renderTabs();
    if (tab === 'home') renderHome();
    else if (tab === 'games') renderGames();
    else if (tab === 'record') renderRecord();
    else renderSettings();
    syncLabel();
  }

  // ---------- はじめての画面 ----------
  function renderWelcome() {
    tabbar.style.display = 'none';
    app.innerHTML = `
      <div class="welcome">
        <div class="logo">⚔️</div>
        <h1>SAMURAI<br>NIHONGO</h1>
        <p class="km big">${esc(T.welcome)}</p>
        <p class="km">${esc(T.welcomeBody)}</p>
        <button class="say-btn" id="wTry">🔊 こんにちは</button>
        <label class="km lbl">${esc(T.yourName)}</label>
        <input id="wName" maxlength="20" autocomplete="off" placeholder="Navin" value="${esc(S.name)}">
        <button class="btn primary" id="wGo">${esc(T.start)} ▶</button>
      </div>`;
    document.getElementById('wTry').onclick = () => speak('こんにちは');
    document.getElementById('wGo').onclick = () => {
      S.name = (document.getElementById('wName').value || '').trim().slice(0, 20);
      S.welcomed = true; save(); sfx.win(); render();
    };
  }

  // ---------- ホーム ----------
  function missionStatus() { const d = day(); return d.m; }
  const inKata = () => S.kanaRows > HIRA_ROWS; // カタカナの行に入ったか（v9）
  function todaysReal() {
    const idx = Math.max(0, Math.min(S.lesson, LESSONS.length) - 1);
    const id = S.lesson > 0 ? LESSONS[idx].real : 'g01';
    return WMAP[id];
  }
  function renderHome() {
    const d = day(); const m = d.m; const st = streak();
    const bi = beltIdx(); const b = BELTS[bi]; const nb = BELTS[bi + 1];
    const pct = nb ? Math.round(((S.xp - b[0]) / (nb[0] - b[0])) * 100) : 100;
    const lesson = LESSONS[S.lesson];
    const real = todaysReal();
    const kata = inKata();
    const rows = [
      [0, '📖', T.m1, lesson ? `${lesson.t}` : T.allLessonsDone, lesson ? lesson.tk : '', 'lesson'],
      [1, '🔁', T.m2, 'ふくしゅう', '', 'review'],
      [2, kata ? 'ア' : 'あ', kata ? T.m3kata : T.m3, kata ? 'カタカナ' : 'ひらがな', '', 'kana'],
    ];
    const nextIdx = m.findIndex((x) => !x);
    app.innerHTML = `
      <header class="hero">
        <div class="brand">SAMURAI NIHONGO</div>
        <div class="hi km">${esc(T.hello)} ${esc(S.name || '')} 👋</div>
        <div class="stats">
          <div class="stat"><b>🔥 ${st}</b><small class="km">${esc(T.streak)}</small></div>
          <div class="stat"><b>⭐ ${S.xp}</b><small class="km">${esc(T.xp)}</small></div>
          <div class="stat"><b>📗 ${learnedWords().length}</b><small class="km">${esc(T.words)}</small></div>
        </div>
        <div class="belt">
          <img class="hero-car" src="${carSrc(bi)}" alt="">
          <div class="belt-row"><span class="rank-ico">${b[3]}</span><b>${esc(b[1])}</b><small class="km">${esc(b[2])}</small></div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <small class="km dim">${nb ? `${esc(T.toNext)}: ${nb[0] - S.xp} XP` : esc(T.topDone)}</small>
        </div>
      </header>
      ${roadCard()}
      <section class="card t30 ${d.t30 ? 'ok' : ''}" id="t30">${t30Inner()}</section>
      <section class="card mission ${d.done ? 'clear' : ''}">
        <h2 class="km">🎯 ${esc(T.todayMission)} <span class="count">${m.filter(Boolean).length}/3</span></h2>
        ${d.done ? `<div class="clear-banner"><div class="big">🏆</div><b class="km">${esc(T.missionClear)}</b><small class="km">${esc(T.missionClearSub)}</small></div>` : ''}
        ${rows.map(([i, ic, km, jp, sub, act]) => `
          <button class="mrow ${m[i] ? 'ok' : ''} ${i === nextIdx ? 'next' : ''}" data-act="${act}">
            <span class="mic">${m[i] ? '✅' : ic}</span>
            <span class="mtx"><b class="km">${esc(km)}</b><small>${esc(jp)}${sub ? ` · <span class="km">${esc(sub)}</span>` : ''}</small></span>
            <span class="go">${m[i] ? '' : '▶'}</span>
          </button>`).join('')}
        ${d.done && !d.t30 ? `<div class="more"><b class="km">⏱ ${esc(T.moreStudy)}</b>
          <button class="btn primary" id="moreLesson">📖 ${esc(T.nextLesson)} ▶</button>
          <button class="btn" id="moreGames">🎮 ${esc(T.games)} ▶</button></div>` : ''}
      </section>
      <section class="card real ${d.real ? 'ok' : ''}">
        <h2 class="km">🗣️ ${esc(T.realTitle)}</h2>
        <p class="km">${esc(T.realBody)}</p>
        <button class="say-btn big" data-say="${esc(ttsOf(real))}">🔊 ${esc(fill(real.jp))}</button>
        <p class="km dim">${esc(fill(real.km))}</p>
        ${d.real ? `<div class="okline">✅ +${XP.real} XP</div>` : `<button class="btn" id="realDone">${esc(T.realDone)} (+${XP.real} XP)</button>`}
      </section>
      <section class="card goal">
        <div class="km">🎌 ${esc(T.goal)}</div>
        <small class="dim">かな ${learnedKana().length}/${KANA.length} · ことば ${learnedWords().length}/${WORDS.length} · レッスン ${Math.min(S.lesson, LESSONS.length)}/${LESSONS.length}</small>
      </section>
      <p class="km note">${esc(T.offlineNote)}</p>
      <div id="sync" class="sync"></div>`;
    app.querySelectorAll('.mrow').forEach((el) => (el.onclick = () => startMission(el.dataset.act)));
    document.getElementById('roadBtn').onclick = () => { sfx.tap(); renderMap(); };
    const ml = document.getElementById('moreLesson'); if (ml) ml.onclick = () => { sfx.tap(); startLesson(); };
    const mg = document.getElementById('moreGames'); if (mg) mg.onclick = () => setTab('games');
    app.querySelectorAll('[data-say]').forEach((el) => (el.onclick = () => speak(el.dataset.say)));
    const rd = document.getElementById('realDone');
    if (rd) rd.onclick = () => { const dd = day(); if (dd.real) return; dd.real = true; S.real++; addXP(XP.real); logEvent('real', { id: real.id, jp: real.jp }); checkBadges(); save(); sfx.win(); confetti(25); render(); };
  }

  function startMission(act) {
    sfx.tap();
    if (act === 'lesson') return startLesson();
    if (act === 'review') return startReview(true);
    if (act === 'kana') return startKana(true);
  }
  function completeMission(i) {
    const d = day();
    if (!d.m[i]) { d.m[i] = 1; logEvent('mission', { step: i + 1 }); }
    if (!d.done && d.m.every(Boolean)) {
      d.done = true; addXP(XP.mission); logEvent('mission_clear', { xp: d.xp, streak: streak() });
      setTimeout(() => { sfx.win(); confetti(70); }, 300);
    }
    checkBadges(); save();
  }

  // ---------- ① レッスン（見る → 聞く → まねする → クイズ） ----------
  function startLesson() {
    const L = LESSONS[S.lesson];
    if (!L) { toast(esc(T.allLessonsDone)); return startReview(true, true); }
    const ids = L.ids.filter((id) => WMAP[id]);
    let i = 0;
    mode = 'lesson'; tabbar.style.display = 'none';
    const show = () => {
      const w = WMAP[ids[i]];
      app.innerHTML = `
        <div class="top"><button class="x" id="quit">✕</button><div class="prog"><i style="width:${(i / ids.length) * 100}%"></i></div><span class="pc">${i + 1}/${ids.length}</span></div>
        <div class="lesson-head"><small>${esc(T.newLesson)} ${S.lesson + 1}</small><b>${esc(L.t)}</b><span class="km">${esc(L.tk)}</span></div>
        <p class="km dim center">${esc(T.learnFirst)}</p>
        <div class="flash">
          ${w.kanji ? `<div class="kanji">${esc(w.kanji)}</div>` : ''}
          <div class="jp">${esc(fill(w.jp))}</div>
          <div class="ro">${esc(fill(w.ro))}</div>
          <div class="say km"><small>${esc(T.howToSay)}</small>${esc(fill(w.say))}</div>
          <div class="mean km"><small>${esc(T.meaning)}</small>${esc(fill(w.km))}</div>
        </div>
        <div class="row3">
          <button class="say-btn" id="play">🔊 ${esc(T.listen)}</button>
          <button class="say-btn" id="slow">🐢 ${esc(T.slow)}</button>
          <button class="say-btn" id="mimic">🎤 ${esc(T.sayIt)}</button>
        </div>
        <button class="btn primary" id="nx">${esc(i + 1 < ids.length ? T.next : T.quizTime)} ▶</button>`;
      document.getElementById('quit').onclick = quit;
      document.getElementById('play').onclick = () => speak(ttsOf(w));
      document.getElementById('slow').onclick = () => speak(ttsOf(w), 0.55);
      document.getElementById('mimic').onclick = (ev) => {
        speak(ttsOf(w));
        const d = day();
        if (!ev.currentTarget.classList.contains('done') && d.say < XP.sayMaxDay) { d.say += XP.say; addXP(XP.say); save(); }
        ev.currentTarget.classList.add('done'); ev.currentTarget.textContent = '✅ ' + T.saidIt;
      };
      document.getElementById('nx').onclick = () => {
        introduce(w.id); save();
        if (++i < ids.length) { sfx.tap(); show(); } else lessonQuiz();
      };
      setTimeout(() => speak(ttsOf(w)), 250);
    };
    const lessonQuiz = () => {
      // 1つのことばを2回（ちがう形で）出す
      const qs = [];
      ids.forEach((id) => { const types = shuffle(['listen', 'read', 'reverse']).slice(0, 2); types.forEach((t) => qs.push(wordQ(WMAP[id], t))); });
      runQuiz({
        title: L.t, game: 'lesson', questions: shuffle(qs),
        onDone: (r) => {
          S.lesson++;
          addXP(XP.lesson);
          logEvent('lesson', { lesson: S.lesson, title: L.t, ok: r.ok, total: r.total });
          completeMission(0);
        },
      });
    };
    show();
  }

  // ---------- ② ふくしゅう ----------
  function startReview(asMission, fallback) {
    const pool = learnedWords();
    if (!pool.length) { toast(esc(T.needLearn)); return; }
    const items = dueFirst(pool).slice(0, 10);
    runQuiz({ title: 'ふくしゅう', game: 'review', questions: items.map((w) => wordQ(w)), onDone: () => { if (asMission || fallback) { completeMission(1); if (fallback) completeMission(0); } } });
  }

  // ---------- ③ ひらがな ----------
  function startKana(asMission) {
    // まだ1行も習っていない、または次の行がひらいたら、先に新しい行を見せる
    const rowIdx = S.kanaRows; // 次に習う行
    const needIntro = S.kanaRows === 0 || (rowIdx < KANA_ROWS.length && KANA.filter((k) => k.row < rowIdx).every((k) => card(k.id).b >= 2));
    if (needIntro && rowIdx < KANA_ROWS.length) return kanaIntro(rowIdx, asMission);
    kanaQuiz(asMission);
  }
  function kanaIntro(rowIdx, asMission) {
    const row = KANA.filter((k) => k.row === rowIdx);
    mode = 'kana'; tabbar.style.display = 'none';
    app.innerHTML = `
      <div class="top"><button class="x" id="quit">✕</button><div class="prog"><i style="width:0%"></i></div></div>
      <div class="lesson-head"><small>${esc(T.rowUnlocked)}</small><b>${esc(KANA_ROWS[rowIdx].t)} ぎょう</b></div>
      <p class="km dim center">${esc(T.learnFirst)}</p>
      <div class="kana-grid">${row.map((k) => `<button class="kana-tile" data-k="${esc(k.c)}"><b>${esc(k.c)}</b><small>${esc(k.ro)}</small><span class="km">${esc(k.say)}</span></button>`).join('')}</div>
      <button class="btn primary" id="nx">${esc(T.quizTime)} ▶</button>`;
    document.getElementById('quit').onclick = quit;
    app.querySelectorAll('.kana-tile').forEach((el) => (el.onclick = () => { speak(el.dataset.k, 0.7); el.classList.add('heard'); }));
    document.getElementById('nx').onclick = () => {
      row.forEach((k) => introduce(k.id));
      S.kanaRows = Math.max(S.kanaRows, rowIdx + 1); save();
      kanaQuiz(asMission, row);
    };
  }
  function kanaQuiz(asMission, focus) {
    const pool = learnedKana();
    if (!pool.length) return startKana(asMission);
    let items = focus ? focus.concat(pick(pool.filter((k) => !focus.includes(k)), 3)) : dueFirst(pool).slice(0, 8);
    items = shuffle(items);
    runQuiz({ title: inKata() ? 'カタカナ' : 'ひらがな', game: 'kana', questions: items.map((k) => kanaQ(k, Math.random() < 0.55 ? 'kana' : 'kanaListen')), onDone: () => { if (asMission) completeMission(2); } });
  }

  // ---------- 問題をつくる ----------
  function distract(w, n, field) {
    const same = WORDS.filter((x) => x.id !== w.id && x.cat === w.cat && fill(x[field]) !== fill(w[field]));
    const other = WORDS.filter((x) => x.id !== w.id && x.cat !== w.cat && fill(x[field]) !== fill(w[field]));
    const out = []; const seen = new Set([fill(w[field])]);
    shuffle(same).concat(shuffle(other)).forEach((x) => { const v = fill(x[field]); if (out.length < n && !seen.has(v)) { seen.add(v); out.push(x); } });
    return out;
  }
  function wordQ(w, type) {
    type = type || pick(['listen', 'read', 'reverse'], 1)[0];
    if (type === 'reverse') {
      const opts = shuffle([w].concat(distract(w, 3, 'jp')));
      return { type, id: w.id, jp: w.jp, tts: ttsOf(w), prompt: `<div class="qlabel km">${esc(T.qReverse)}</div><div class="qkm km">${esc(fill(w.km))}</div>`, choices: opts.map((x) => ({ html: `<b>${esc(fill(x.jp))}</b><small>${esc(fill(x.ro))}</small>`, ok: x.id === w.id, say: ttsOf(x) })) };
    }
    const opts = shuffle([w].concat(distract(w, 3, 'km')));
    const choices = opts.map((x) => ({ html: `<span class="km">${esc(fill(x.km))}</span>`, ok: x.id === w.id }));
    if (type === 'listen') return { type, id: w.id, jp: w.jp, tts: ttsOf(w), auto: true, prompt: `<div class="qlabel km">${esc(T.qListen)}</div><button class="say-btn huge" data-replay>🔊</button><button class="say-btn small" data-slow>🐢 ${esc(T.slow)}</button>`, choices };
    return { type: 'read', id: w.id, jp: w.jp, tts: ttsOf(w), prompt: `<div class="qlabel km">${esc(T.qRead)}</div>${w.kanji ? `<div class="kanji">${esc(w.kanji)}</div>` : ''}<div class="qjp">${esc(fill(w.jp))}</div><button class="say-btn small" data-replay>🔊</button>`, choices };
  }
  function kanaQ(k, type) {
    const others = shuffle(KANA.filter((x) => x.id !== k.id && x.ro !== k.ro && x.say !== k.say));
    const near = others.filter((x) => x.row === k.row || learned(x.id));
    const opts = shuffle([k].concat((near.length >= 3 ? near : others).slice(0, 3)));
    if (type === 'kanaListen') return { type, id: k.id, jp: k.c, tts: k.c, auto: true, prompt: `<div class="qlabel km">${esc(T.qKanaListen)}</div><button class="say-btn huge" data-replay>🔊</button>`, choices: opts.map((x) => ({ html: `<b class="kana-big">${esc(x.c)}</b>`, ok: x.id === k.id })) };
    return { type: 'kana', id: k.id, jp: k.c, tts: k.c, prompt: `<div class="qlabel km">${esc(T.qKana)}</div><div class="kana-huge">${esc(k.c)}</div>`, choices: opts.map((x) => ({ html: `<span class="km">${esc(x.say)}</span><small>${esc(x.ro)}</small>`, ok: x.id === k.id })) };
  }
  function menuQ(m) {
    const opts = shuffle([m.a].concat(m.o));
    return { type: 'menu', id: 'menu', jp: m.a, prompt: `<div class="qlabel">🚗 SAMURAI MOTORS</div><div class="qkm km">${esc(m.q)}</div>`, choices: opts.map((x) => ({ html: `<span class="km">${esc(x)}</span>`, ok: x === m.a, say: /[ぁ-んァ-ン]/.test(x) ? x.replace(/\(.*\)/, '') : '' })) };
  }

  // ---------- クイズの進行（共通） ----------
  function runQuiz({ title, game, questions, onDone }) {
    if (!questions.length) return;
    mode = 'quiz'; tabbar.style.display = 'none';
    const qs = questions.slice();
    const retried = new Set();
    let i = 0; let ok = 0; let combo = 0; let maxCombo = 0; let gained = 0; let firstTry = 0; const total = questions.length;
    const firstOk = new Set();
    const graded = new Set();
    const ask = () => {
      const q = qs[i]; const t0 = Date.now();
      app.innerHTML = `
        <div class="top"><button class="x" id="quit">✕</button><div class="prog"><i style="width:${(i / qs.length) * 100}%"></i></div><span class="pc">${combo >= 2 ? `🔥${combo}` : `${i + 1}/${qs.length}`}</span></div>
        <div class="qbox">${q.prompt}</div>
        <div class="choices">${q.choices.map((c, j) => `<button class="choice" data-j="${j}">${c.html}</button>`).join('')}</div>
        <div id="fb" class="fb"></div>`;
      document.getElementById('quit').onclick = quit;
      app.querySelectorAll('[data-replay]').forEach((el) => (el.onclick = () => speak(q.tts)));
      app.querySelectorAll('[data-slow]').forEach((el) => (el.onclick = () => speak(q.tts, 0.55)));
      if (q.auto) setTimeout(() => speak(q.tts), 250);
      let answered = false;
      app.querySelectorAll('.choice').forEach((el) => (el.onclick = () => {
        if (answered) return; answered = true;
        const c = q.choices[+el.dataset.j];
        const right = !!c.ok;
        const ms = Date.now() - t0;
        app.querySelectorAll('.choice').forEach((b, j) => { if (q.choices[j].ok) b.classList.add('right'); else if (b === el) b.classList.add('wrong'); b.disabled = true; });
        const d = day(); d.ans++;
        const isRetry = retried.has(i);
        let xp = 0;
        if (right) {
          d.ok++; ok++; combo++; maxCombo = Math.max(maxCombo, combo);
          if (!isRetry) firstOk.add(i);
          xp = XP.ok + Math.min(10, Math.max(0, combo - 2) * 2);
          addXP(xp); gained += xp; sfx.ok();
          if (combo >= 10) award('combo10');
        } else {
          combo = 0; sfx.ng();
          // まちがえた問題は最後にもう一度だけ出す
          if (!isRetry) { qs.push(q); retried.add(qs.length - 1); }
        }
        // 箱を上げるのは1回のクイズで1回だけ（同じ日に2段とばさない）。2回目以降は回数だけ数え、まちがえたら箱1に戻す
        if (q.id !== 'menu') {
          if (!graded.has(q.id)) { grade(q.id, right); graded.add(q.id); }
          else { const c = card(q.id); c.s++; c.last = todayStr(); if (right) c.c++; else { c.w++; c.b = 1; c.due = addDays(todayStr(), 1); } }
        }
        save();
        logEvent('answer', { game, qtype: q.type, id: q.id, jp: q.jp, ok: right ? 1 : 0, ms, xp, retry: isRetry ? 1 : 0 });
        if (q.tts && q.type !== 'listen' && q.type !== 'kanaListen') speak(q.tts); else if (c.say) speak(c.say);
        if (q.type === 'listen' || q.type === 'kanaListen') setTimeout(() => speak(q.tts), 200);
        const fb = document.getElementById('fb');
        const rightChoice = q.choices.find((x) => x.ok);
        fb.innerHTML = right
          ? `<div class="good km">⭕ ${esc(T.correct)} <span class="xp">+${xp} XP</span></div>`
          : `<div class="bad km">❌ ${esc(T.wrong)}</div><div class="ans km">${esc(T.answerIs)} ${rightChoice.html}</div>`;
        fb.innerHTML += `<button class="btn primary" id="nx">${esc(T.next)} ▶</button>`;
        document.getElementById('nx').onclick = () => { if (++i < qs.length) ask(); else finish(); };
      }));
    };
    const finish = () => {
      firstTry = firstOk.size;
      const perfect = firstTry === total;
      if (perfect && total >= 5) award('perfect');
      const r = { ok: firstTry, total, gained, maxCombo, perfect };
      logEvent('quiz', { game, title, ok: firstTry, total, xp: gained, combo: maxCombo });
      if (onDone) onDone(r);
      checkBadges(); save();
      const stars = firstTry / total >= 0.9 ? '⭐⭐⭐' : firstTry / total >= 0.7 ? '⭐⭐' : '⭐';
      sfx.win(); if (firstTry / total >= 0.7) confetti(perfect ? 60 : 30);
      app.innerHTML = `
        <div class="result">
          <div class="stars">${stars}</div>
          <h2 class="km">${esc(T.result)}</h2>
          <div class="score">${firstTry} / ${total}</div>
          <div class="xpgain">+${gained} XP${maxCombo >= 3 ? ` · 🔥${maxCombo}` : ''}</div>
          ${perfect ? '<div class="perfect">💯 PERFECT!</div>' : ''}
          <button class="btn primary" id="home">${esc(T.home)} ▶</button>
          <button class="btn" id="again">🔁 ${esc(T.again)}</button>
        </div>`;
      document.getElementById('home').onclick = () => { mode = null; tab = 'home'; render(); };
      document.getElementById('again').onclick = () => runQuiz({ title, game, questions: shuffle(questions), onDone: null });
    };
    ask();
  }
  function quit() { if (window.speechSynthesis) speechSynthesis.cancel(); mode = null; render(); }

  // ---------- ゲーム ----------
  function renderGames() {
    const has = learnedWords().length > 0;
    const games = [
      ['listen', '🔊', T.gListen, 'きいて えらぶ', has],
      ['read', '👀', T.gRead, 'よんで えらぶ', has],
      ['reverse', '🇰🇭➡️🇯🇵', T.gReverse, 'クメールご → にほんご', has],
      ['kana', 'あア', T.gKana2, 'ひらがな・カタカナ', true],
      ['book', '📋', MENU_BOOK.title, 'メニュー ずかん', true],
      ['menu', '🚗', T.gMenu, 'メニュー・ねだん', true],
      ['speak', '🎤', T.gSpeak, 'まねして いおう', has],
      ['weak', '🎯', T.gWeak, 'にがて', weakWords().length > 0],
    ];
    app.innerHTML = `
      <h1 class="page km">🎮 ${esc(T.games)}</h1>
      <div class="game-grid">${games.map(([k, ic, km, jp, ok]) => `<button class="game ${ok ? '' : 'lock'}" data-g="${k}"><span class="gic">${ic}</span><b class="km">${esc(km)}</b><small>${esc(jp)}</small></button>`).join('')}</div>
      <p class="km note">${esc(has ? '' : T.needLearn)}</p>
      <div id="sync" class="sync"></div>`;
    app.querySelectorAll('.game').forEach((el) => (el.onclick = () => {
      if (el.classList.contains('lock')) { toast(esc(T.needLearn)); return; }
      startGame(el.dataset.g);
    }));
  }
  function startGame(g) {
    sfx.tap();
    const pool = learnedWords();
    if (g === 'kana') return startKana(false);
    if (g === 'book') return renderMenuBook();
    if (g === 'menu') {
      const qs = pick(MENU_QUIZ, 10).map(menuQ);
      return runQuiz({ title: 'MENU', game: 'menu', questions: qs, onDone: (r) => { if (r.perfect) { S.menuPerfect = true; save(); } } });
    }
    if (g === 'speak') return speakPractice(pick(pool, 10));
    if (g === 'weak') return runQuiz({ title: 'にがて', game: 'weak', questions: weakWords().slice(0, 10).map((w) => wordQ(w)) });
    const items = pick(pool, 10);
    runQuiz({ title: g, game: g, questions: items.map((w) => wordQ(w, g)) });
  }
  // ---------- メニュー図鑑（サービスの中身・料金・4つのルール・予約の流れ）----------
  function renderMenuBook() {
    const B = MENU_BOOK;
    const km = (x) => esc(x).replace(/\n/g, '<br>');
    const price = (pr) => Array.isArray(pr) ? `<div class="mb-price"><span><small>Sedan</small>${esc(pr[0])}</span><span><small>SUV</small>${esc(pr[1])}</span></div>` : (pr ? `<div class="mb-price"><span>${esc(pr)}</span></div>` : '');
    app.innerHTML = `
      <button class="btn small" id="mbBack">◀ ${esc(T.games)}</button>
      <h1 class="page km">📋 ${esc(B.title)}</h1>
      <p class="km dim mb-head">${esc(B.priceHead)}</p>
      ${B.groups.map((gr) => `
        <section class="card mb-group">
          <h2>${esc(gr.head)}</h2>
          ${gr.warn ? `<p class="km mb-warn">⚠️ ${km(gr.warn)}</p>` : ''}
          ${gr.items.map((it) => `
            <div class="mb-item">
              <div class="mb-name"><b>${esc(it.name)}</b><button class="mb-jp" data-say="${esc(it.jp)}">🔊 ${esc(it.jp)}</button></div>
              <p class="km">${km(it.km)}</p>
              ${price(it.price)}
            </div>`).join('')}
          ${gr.table ? `<table class="mb-table"><tr><th></th><th>POLISH</th><th>DEEP</th></tr>${gr.table.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>` : ''}
          ${gr.note ? `<p class="km dim mb-note">⌂ ${km(gr.note)}</p>` : ''}
        </section>`).join('')}
      <section class="card mb-group"><h2>FREE QUOTE</h2><p class="km">${km(B.quote)}</p></section>
      <section class="card mb-group"><h2 class="km">⚔️ ${esc(B.rulesTitle)}</h2>${B.rules.map((r) => `<p class="km mb-rule">${km(r)}</p>`).join('')}</section>
      <section class="card mb-group"><h2 class="km">📱 ${esc(B.bookTitle)}</h2><p class="km">${km(B.booking)}</p><p class="km dim">💳 ${km(B.pay)}</p></section>
      <button class="btn primary" id="mbQuiz">🚗 ${esc(T.gMenu)} ▶</button>
      <div id="sync" class="sync"></div>`;
    window.scrollTo(0, 0);
    app.querySelector('#mbBack').onclick = () => { sfx.tap(); render(); };
    app.querySelector('#mbQuiz').onclick = () => startGame('menu');
    app.querySelectorAll('.mb-jp').forEach((b) => (b.onclick = () => speak(b.dataset.say)));
  }
  function speakPractice(items) {
    let i = 0;
    mode = 'speak'; tabbar.style.display = 'none';
    const show = () => {
      const w = items[i];
      app.innerHTML = `
        <div class="top"><button class="x" id="quit">✕</button><div class="prog"><i style="width:${(i / items.length) * 100}%"></i></div><span class="pc">${i + 1}/${items.length}</span></div>
        <div class="flash">
          <div class="mean km">${esc(fill(w.km))}</div>
          <div class="jp">${esc(fill(w.jp))}</div>
          <div class="ro">${esc(fill(w.ro))}</div>
          <div class="say km">${esc(fill(w.say))}</div>
        </div>
        <div class="row3"><button class="say-btn" id="play">🔊 ${esc(T.listen)}</button><button class="say-btn" id="slow">🐢 ${esc(T.slow)}</button></div>
        <button class="btn primary" id="said">🎤 ${esc(T.saidIt)} ▶</button>`;
      document.getElementById('quit').onclick = quit;
      document.getElementById('play').onclick = () => speak(ttsOf(w));
      document.getElementById('slow').onclick = () => speak(ttsOf(w), 0.55);
      document.getElementById('said').onclick = () => {
        const d = day();
        if (d.say < XP.sayMaxDay) { d.say += XP.say; addXP(XP.say); }
        save(); sfx.ok();
        logEvent('speak', { id: w.id, jp: w.jp });
        if (++i < items.length) show(); else { mode = null; confetti(20); render(); }
      };
      setTimeout(() => speak(ttsOf(w)), 250);
    };
    show();
  }

  // ---------- きろく ----------
  function renderRecord() {
    const t = todayStr();
    const lw = learnedWords(); const lk = learnedKana();
    let a = 0; let o = 0; let sec = 0;
    for (let i = 0; i < 7; i++) { const d = S.days[addDays(t, -i)]; if (d) { a += d.ans; o += d.ok; } }
    Object.values(S.days).forEach((d) => { sec += d.sec || 0; });
    const acc = a ? Math.round((o / a) * 100) : 0;
    // 28日カレンダー（日曜はじまり・4週）
    const start = (() => { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() - 21 - d.getDay()); return todayStr(d); })();
    const cells = [];
    for (let i = 0; i < 28; i++) {
      const k = addDays(start, i); const d = S.days[k];
      const cls = k > t ? 'future' : d && d.done ? 'done' : d && d.ans > 0 ? 'some' : 'none';
      cells.push(`<div class="cal ${cls} ${k === t ? 'today' : ''}"><small>${+k.slice(8)}</small>${cls === 'done' ? '🏆' : cls === 'some' ? '✓' : ''}</div>`);
    }
    const weak = weakWords().slice(0, 8);
    const bi = beltIdx();
    app.innerHTML = `
      <h1 class="page km">📅 ${esc(T.record)}</h1>
      <div class="tiles">
        <div class="tile"><b>🔥 ${streak()}</b><small class="km">${esc(T.streak)}</small><small class="dim">BEST ${bestStreak()}</small></div>
        <div class="tile"><b>⭐ ${S.xp}</b><small class="km">${esc(T.xp)}</small></div>
        <div class="tile"><b>📗 ${lw.length}</b><small class="km">${esc(T.words)}</small><small class="dim">💪 ${mastered(lw).length}</small></div>
        <div class="tile"><b>あ ${lk.length}/${KANA.length}</b><small class="km">${esc(T.kana)}</small></div>
        <div class="tile"><b>${acc}%</b><small class="km">${esc(T.accuracy)} (7)</small></div>
        <div class="tile"><b>${Math.round(sec / 60)}</b><small class="km">${esc(T.minutes)}</small></div>
      </div>
      <section class="card">
        <h2 class="km">🏎️ ${esc(T.belt)}</h2>
        <div class="belts">${BELTS.map((b, j) => `<div class="beltline ${j <= bi ? 'got' : 'locked'}"><img class="garage-car" src="${carSrc(j)}" alt="" loading="lazy"><span>${j <= bi ? esc(b[1]) : '？？？'}<br><small class="km">${j <= bi ? esc(b[2]) : ''}</small></span><small>${b[0]} XP</small></div>`).join('')}</div>
      </section>
      <section class="card">
        <h2 class="km">🚗 ${esc(T.carBook)} <span class="count">${(S.carCards || []).length}/${CAR_CARDS.length}</span></h2>
        <div class="ccgrid">${CAR_CARDS.map((c, j) => (S.carCards || []).includes(j) ? `<button class="ccell" data-cc="${j}"><span>${c[0]}</span><small>${esc(c[1])}</small></button>` : `<div class="ccell lock"><span>❔</span><small>#${j + 1}</small></div>`).join('')}</div>
        <small class="km dim">🎁 ${esc(T.get30)}</small>
      </section>
      <section class="card">
        <h2 class="km">${esc(T.calendar)}</h2>
        <div class="calgrid">${T.weekDays.map((w) => `<div class="cal head km">${esc(w)}</div>`).join('')}${cells.join('')}</div>
      </section>
      <section class="card">
        <h2 class="km">🏅 ${esc(T.badges)}</h2>
        <div class="badges">${BADGES.map(([id, ic, km]) => `<div class="badge ${S.badges[id] ? 'got' : ''}"><span>${ic}</span><small class="km">${esc(km)}</small></div>`).join('')}</div>
      </section>
      ${weak.length ? `<section class="card"><h2 class="km">🎯 ${esc(T.weak)}</h2>${weak.map((w) => `<button class="weakrow" data-say="${esc(ttsOf(w))}"><b>🔊 ${esc(fill(w.jp))}</b><span class="km">${esc(fill(w.km))}</span><small>❌${card(w.id).w}</small></button>`).join('')}</section>` : ''}
      <div id="sync" class="sync"></div>`;
    app.querySelectorAll('[data-say]').forEach((el) => (el.onclick = () => speak(el.dataset.say)));
    app.querySelectorAll('[data-cc]').forEach((el) => (el.onclick = () => showCarCard(+el.dataset.cc, false)));
  }

  // ---------- せってい ----------
  function renderSettings() {
    const q = loadQueue().length;
    app.innerHTML = `
      <h1 class="page km">⚙️ ${esc(T.settings)}</h1>
      <section class="card">
        <label class="km lbl">${esc(T.yourName)}</label>
        <input id="nm" maxlength="20" autocomplete="off" value="${esc(S.name)}">
        <button class="btn" id="nmSave">${esc(T.save)}</button>
      </section>
      <section class="card">
        <div class="setrow"><span class="km">🔈 ${esc(T.sound)}</span><button class="btn small" id="snd">${esc(S.sound ? T.on : T.off)}</button></div>
        <button class="btn" id="vt">🔊 ${esc(T.voiceTest)}</button>
        <p class="km dim" id="vmsg"></p>
      </section>
      <section class="card">
        <div class="km">${CFG.GAS_URL ? (q ? `⏳ ${esc(T.waiting)} (${q})` : `✓ ${esc(T.synced)}`) : '—'}</div>
        <small class="dim">${S.lastSync ? new Date(S.lastSync).toLocaleString() : ''}</small>
        ${CFG.GAS_URL ? '<button class="btn small" id="sendNow">⤴︎ SYNC</button>' : ''}
      </section>
      <p class="dim center">SAMURAI NIHONGO v${VERSION}</p>`;
    document.getElementById('nmSave').onclick = () => { S.name = document.getElementById('nm').value.trim().slice(0, 20); save(); sfx.ok(); toast('✓'); };
    document.getElementById('snd').onclick = () => { S.sound = !S.sound; save(); render(); };
    document.getElementById('vt').onclick = () => { pickVoice(); speak('こんにちは。いっしょに にほんごを べんきょう しましょう。'); document.getElementById('vmsg').textContent = jaVoice || !('speechSynthesis' in window) ? (jaVoice ? jaVoice.name : T.noVoice) : ''; };
    const sn = document.getElementById('sendNow'); if (sn) sn.onclick = () => { flush(); toast('⤴︎'); };
  }

  // ---------- 起動 ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.SNH = { S: () => S, snapshot, flush }; // 確認用
  render();
  flushSoon();
})();
