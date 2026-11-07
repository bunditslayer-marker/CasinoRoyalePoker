// Black Tie Poker — what runs in each player's browser.
// It only draws the table and sends your choices; the server deals and checks the rules.

(() => {
  const socket = io();
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18.5h18L19.6 7.8l-4.8 4.1L12 5.5l-2.8 6.4-4.8-4.1z" fill="currentColor"/><rect x="3" y="19.8" width="18" height="1.8" rx=".9" fill="currentColor"/></svg>';

  // The founder's crown: gold with a ruby, a sapphire, an emerald and pearl tips.
  const FOUNDER_CROWN = `<svg class="crown founder-crown" viewBox="0 0 32 24" aria-hidden="true">
    <path d="M4.2 18.2 2.2 6.6l7.4 5.3L16 2.6l6.4 9.3 7.4-5.3-2 11.6z" fill="url(#goldGrad)" stroke="#6f4e17" stroke-width=".7" stroke-linejoin="round"/>
    <rect x="4" y="18.6" width="24" height="3.6" rx="1.2" fill="url(#goldGrad)" stroke="#6f4e17" stroke-width=".7"/>
    <circle cx="2.2" cy="6.2" r="1.7" fill="#fff8e7"/><circle cx="16" cy="2.2" r="1.9" fill="#fff8e7"/><circle cx="29.8" cy="6.2" r="1.7" fill="#fff8e7"/>
    <ellipse cx="16" cy="13.2" rx="2.3" ry="2.7" fill="#c2142c" stroke="#ffe9a6" stroke-width=".6"/>
    <circle cx="9.8" cy="15" r="1.35" fill="#2366d1" stroke="#ffe9a6" stroke-width=".4"/>
    <circle cx="22.2" cy="15" r="1.35" fill="#169457" stroke="#ffe9a6" stroke-width=".4"/>
    <circle cx="10" cy="20.4" r=".8" fill="#c2142c"/><circle cx="16" cy="20.4" r=".8" fill="#fff8e7"/><circle cx="22" cy="20.4" r=".8" fill="#c2142c"/>
  </svg>`;

  // ---------- table colours ----------

  const FELTS = [
    ['#0f4a37', 'Bottle green'], ['#163f73', 'Royal blue'], ['#7a1622', 'Casino red'],
    ['#3e2061', 'Purple'], ['#0d4f57', 'Teal'], ['#1c2230', 'Midnight'],
  ];
  const ROOMS = [
    ['#2b0f15', 'Oxblood'], ['#0f1a2e', 'Navy'], ['#1d1d1f', 'Charcoal'],
    ['#0f2418', 'Forest'], ['#24122b', 'Plum'], ['#2a2116', 'Walnut'],
  ];

  // Mix a colour toward white (amt > 0) or black (amt < 0).
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const mix = (c) => Math.round(c + (t - c) * p);
    const [r, g, b] = [mix(n >> 16), mix((n >> 8) & 255), mix(n & 255)];
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  let themeKey = '';
  function applyTheme(felt, room) {
    const key = felt + room;
    if (key === themeKey) return;
    themeKey = key;
    const root = document.documentElement.style;
    if (!felt) {
      for (const v of ['--felt', '--felt-hi', '--velvet', '--velvet-glow', '--velvet-2', '--plate']) root.removeProperty(v);
      document.querySelector('meta[name=theme-color]').content = '#2b0f15';
      return;
    }
    root.setProperty('--felt', felt);
    root.setProperty('--felt-hi', shade(felt, 0.13));
    root.setProperty('--velvet', room);
    root.setProperty('--velvet-glow', shade(room, 0.07));
    root.setProperty('--velvet-2', shade(room, 0.08));
    root.setProperty('--plate', shade(room, -0.5) + 'e6');
    document.querySelector('meta[name=theme-color]').content = room;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const tokenKey = (code) => `btp-token-${code}`;

  let state = null;
  let myCode = null;
  let lastLogId = 0;
  let lastTurnKey = '';
  let actionsKey = '';
  let raise = null; // { value } while the raise panel is open
  let soundOn = store.get('btp-sound') !== 'off';

  // ---------- sending ----------

  function send(event, data = {}) {
    return new Promise((resolve) => {
      if (!socket.connected) { toast('Reconnecting… try again in a second.'); return resolve({ ok: false }); }
      socket.timeout(8000).emit(event, data, (err, res) => {
        if (err) { toast('No answer from the table. Check your connection.'); return resolve({ ok: false }); }
        if (!res.ok && res.error && !res.needCode) toast(res.error);
        resolve(res);
      });
    });
  }

  // ---------- home screen ----------

  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('t') || '').toUpperCase().slice(0, 4);
  $('#nameInput').value = store.get('btp-name') || '';
  if (urlCode) {
    $('#codeInput').value = urlCode;
    document.body.classList.add('invited');
  }

  function readName() {
    const name = $('#nameInput').value.trim();
    if (!name) { $('#nameInput').focus(); toast('Type your name first.'); return null; }
    store.set('btp-name', name);
    return name;
  }

  $('#createBtn').addEventListener('click', async () => {
    const name = readName();
    if (!name) return;
    unlockAudio();
    const settings = readSettings('opt');
    if (!settings) return;
    await enter('create', { name, settings });
  });

  $('#homeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = readName();
    if (!name) return;
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('#codeInput').focus(); toast('Table codes are 4 letters.'); return; }
    unlockAudio();
    await enter('join', { code, name, token: store.get(tokenKey(code)) });
  });

  // ---------- reserved name: the secret code ----------

  let pendingEntry = null;
  async function enter(event, payload, typedCode) {
    const saved = store.get('btp-owner');
    const ownerCode = typedCode || saved || undefined;
    const res = await send(event, { ...payload, ownerCode });
    if (res.ok) {
      if (typedCode && $('#ownerRemember').checked) store.set('btp-owner', typedCode);
      if ($('#codeSheet').open) $('#codeSheet').close();
      return res;
    }
    if (res.needCode) {
      if (!typedCode && saved) store.del('btp-owner'); // the saved code stopped working
      pendingEntry = { event, payload };
      $('#codeErr').textContent = typedCode ? res.error : '';
      if (!$('#codeSheet').open) { $('#ownerInput').value = ''; $('#codeSheet').showModal(); }
      $('#ownerInput').select();
    }
    return res;
  }
  $('#codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#ownerInput').value;
    if (!code || !pendingEntry) return;
    await enter(pendingEntry.event, pendingEntry.payload, code);
  });
  $('#ownerInput').addEventListener('input', () => { $('#codeErr').textContent = ''; });
  $('#codeBack').addEventListener('click', () => {
    $('#codeSheet').close();
    $('#nameInput').select();
  });

  // Reads blinds, ante, chips and timer from the home options (opt) or admin settings (set).
  function readSettings(prefix) {
    const num = (id) => Math.floor(Number($(`#${prefix}${id}`).value));
    const sb = num('SB');
    const bb = num('BB');
    const ante = num('Ante') || 0;
    const chips = num('Chips');
    if (!(bb >= 1) || !(sb >= 1)) { toast('Blinds need to be at least 1.'); return null; }
    if (sb > bb) { toast("The small blind can't be bigger than the big blind."); return null; }
    if (ante < 0 || ante > bb) { toast('The ante can be from 0 up to the big blind.'); return null; }
    if (!(chips >= bb * 2)) { toast(`Starting chips need to be at least ${bb * 2} (two big blinds).`); return null; }
    return { smallBlind: sb, bigBlind: bb, ante, startingChips: chips, turnSeconds: +$(`#${prefix}Timer`).value };
  }

  // Quick blind buttons like 1/2 fill in the small and big blind.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.quick [data-blinds]');
    if (!b) return;
    const prefix = b.closest('.quick').dataset.for;
    const [sb, bb] = b.dataset.blinds.split('/');
    $(`#${prefix}SB`).value = sb;
    $(`#${prefix}BB`).value = bb;
    const ante = $(`#${prefix}Ante`);
    if (+ante.value > +bb) ante.value = bb;
    markQuick(prefix);
  });
  function markQuick(prefix) {
    const val = `${$(`#${prefix}SB`).value}/${$(`#${prefix}BB`).value}`;
    for (const b of document.querySelectorAll(`.quick[data-for=${prefix}] [data-blinds]`)) b.setAttribute('aria-pressed', String(b.dataset.blinds === val));
  }
  for (const prefix of ['opt', 'set']) {
    for (const id of ['SB', 'BB']) $(`#${prefix}${id}`).addEventListener('input', () => markQuick(prefix));
  }
  markQuick('opt');

  function showHome(message) {
    myCode = null;
    state = null;
    clearTable();
    applyTheme(null);
    $('#game').hidden = true;
    $('#home').hidden = false;
    document.title = 'Black Tie Poker';
    history.replaceState(null, '', location.pathname);
    document.body.classList.remove('invited');
    if (message) toast(message);
  }

  // ---------- connection ----------

  socket.on('joined', ({ code, token }) => {
    if (myCode !== code) { clearTable(); state = null; }
    myCode = code;
    store.set(tokenKey(code), token);
    history.replaceState(null, '', `?t=${code}`);
    $('#home').hidden = true;
    $('#game').hidden = false;
    lastLogId = 0;
  });

  socket.on('state', (s) => {
    if (!myCode || s.code !== myCode) return;
    if (!s.seats.some((p) => p && p.id === s.you)) return showHome('You left the table.');
    const prev = state;
    state = s;
    const t0 = performance.now();
    render(prev);
    if (window.__btpProfile) window.__btpProfile.push(Math.round((performance.now() - t0) * 10) / 10);
  });

  // Rejoin automatically after a refresh or a dropped connection.
  socket.on('connect', () => {
    const code = myCode || urlCode;
    const token = code && store.get(tokenKey(code));
    if (!code || !token) return;
    socket.emit('join', { code, token, name: store.get('btp-name') || 'Player' }, (res) => {
      if (res && !res.ok) {
        store.del(tokenKey(code));
        if (myCode) showHome('That table has closed. Start a new one?');
      }
    });
  });
  socket.on('disconnect', () => { if (myCode) toast('Connection lost. Reconnecting…'); });


  // ---------- drawing the table ----------
  //
  // Everything on the table is a long-lived element that gets updated, never rebuilt.
  // Movement (dealing, chips, folds, wins) uses copies that fly across a top layer with
  // transform and opacity only, so the phone's graphics chip does the work and it stays smooth.

  const SUITS = { s: ['♠', 'spades'], h: ['♥', 'hearts'], d: ['♦', 'diamonds'], c: ['♣', 'clubs'] };
  const RANK = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  const BETTING = ['preflop', 'flop', 'turn', 'river'];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AVATAR_COLOURS = ['#8e3b46', '#2f6f73', '#6b4c9a', '#b5683b', '#3b6ea8', '#4f7d3a', '#a2486f', '#7a6a2f', '#356b5a', '#8a4f2a'];

  const seatEls = new Map(); // player id -> seat parts
  const betEls = new Map(); // player id -> bet chip element
  const boardEls = [];
  const meEls = [];
  let timerKey = '';
  let handTimers = [];

  // Run something later, unless a new hand has started by then.
  function later(ms, fn) {
    const hand = state && state.handNumber;
    const t = setTimeout(() => { if (state && state.handNumber === hand) fn(); }, Math.max(0, ms));
    handTimers.push(t);
  }

  // ---------- cards ----------

  function makeCard(cls = '') {
    const el = document.createElement('div');
    el.className = `card down ${cls}`;
    el.innerHTML = '<div class="cf face"><span class="r"></span><span class="s1"></span><span class="s2"></span></div><div class="cf back"></div>';
    return el;
  }

  function paintCard(el, c) {
    if (el.dataset.face === c) return;
    el.dataset.face = c;
    const rank = RANK[c[0]] || c[0];
    const [sym, name] = SUITS[c[1]];
    el.querySelector('.r').textContent = rank;
    el.querySelector('.s1').textContent = sym + '︎';
    el.querySelector('.s2').textContent = sym + '︎';
    el.classList.toggle('red', c[1] === 'h' || c[1] === 'd');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${rank} of ${name}`);
  }

  // Face up for a real card, face down for '??'. Flips smoothly unless instant.
  function setCard(el, c, instant = false) {
    if (instant) el.classList.add('no-anim');
    if (c && c !== '??') { paintCard(el, c); el.classList.remove('down'); }
    else { el.classList.add('down'); el.setAttribute('aria-label', 'Face-down card'); }
    el.dataset.c = c || '';
    if (instant) { void el.offsetWidth; el.classList.remove('no-anim'); }
  }

  // ---------- moving pieces ----------

  const fxLayer = $('#fx');
  const box = (el) => el.getBoundingClientRect();
  const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function fly(el, from, to, { duration = 400, delay = 0, easing = 'cubic-bezier(.2,.8,.2,1)', arc = 0, s0 = 1, s1 = 1, r0 = 0, r1 = 0, o0 = 1, o1 = 1 } = {}) {
    if (REDUCED) { el.remove(); return Promise.resolve(); }
    fxLayer.append(el);
    const tf = (p, s, r) => `translate(${p.x}px, ${p.y}px) rotate(${r}deg) scale(${s})`;
    const frames = [{ transform: tf(from, s0, r0), opacity: o0 }];
    if (arc) frames.push({ transform: tf({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - arc }, (s0 + s1) / 2, (r0 + r1) / 2), opacity: (o0 + o1) / 2 + 0.25, offset: 0.5 });
    frames.push({ transform: tf(to, s1, r1), opacity: o1 });
    const anim = el.animate(frames, { duration, delay, easing, fill: 'both' });
    return anim.finished.then(() => el.remove(), () => el.remove());
  }

  // A face-down card flying from the deck to where a real card sits.
  function dealGhost(target, delay, onLand, r = box(target), d = box($('#deck')), tilt = null) {
    // A flat card back is all a flying card needs (cheaper than a full 3D card).
    const wrap = document.createElement('div');
    wrap.className = 'ghost-card';
    wrap.style.width = `${r.width}px`;
    wrap.style.height = `${r.height}px`;
    wrap.style.borderRadius = `${r.width * 0.11}px`;
    const from = { x: mid(d).x - r.width / 2, y: mid(d).y - r.height / 2 };
    if (tilt === null) tilt = parseFloat(getComputedStyle(target).rotate) || 0;
    fly(wrap, from, { x: r.left, y: r.top }, { duration: 380, delay, s0: 0.55, r0: -25, r1: tilt, easing: 'cubic-bezier(.15,.75,.25,1)' });
    setTimeout(() => { onLand(); sfx.deal(); }, REDUCED ? 0 : delay + 380);
  }

  function chipGhost(cls = '') {
    const el = document.createElement('div');
    el.className = `ghost-chip ${cls}`;
    return el;
  }

  function floatText(c, text, up, delay) {
    const el = document.createElement('div');
    el.className = `float ${up ? 'up' : 'down'}`;
    el.textContent = text;
    fxLayer.append(el);
    const w = text.length * 11;
    const p = (dy) => `translate(${c.x}px, ${c.y + dy}px) translateX(-50%)`;
    void w;
    if (REDUCED) { setTimeout(() => el.remove(), 1500); return; }
    el.animate([
      { transform: `${p(8)} scale(.7)`, opacity: 0 },
      { transform: `${p(-6)} scale(1.15)`, opacity: 1, offset: 0.14 },
      { transform: `${p(-20)} scale(1)`, opacity: 1, offset: 0.72 },
      { transform: `${p(-34)} scale(1)`, opacity: 0 },
    ], { duration: 1900, delay, easing: 'ease-out', fill: 'both' }).finished.then(() => el.remove(), () => el.remove());
  }

  function pop(el) {
    if (REDUCED) return;
    el.animate([
      { transform: 'scale(.4)', opacity: 0 },
      { transform: 'scale(1.14)', opacity: 1, offset: 0.6 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 340, easing: 'ease-out' });
  }

  // Count numbers up or down smoothly.
  function setNumber(el, to, { delay = 0, duration = 500, instant = false } = {}) {
    if (el._to === to && !instant) return;
    el._to = to;
    cancelAnimationFrame(el._raf);
    clearTimeout(el._wait);
    const from = el._shown ?? to;
    if (instant || from === to || REDUCED) { el._shown = to; el.textContent = fmt(to); return; }
    const run = () => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        el._shown = Math.round(from + (to - from) * e);
        el.textContent = fmt(el._shown);
        if (t < 1) el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    };
    if (delay) el._wait = setTimeout(run, delay); else run();
  }

  // ---------- sounds (made in the browser, no files needed) ----------

  let audio = null;
  function unlockAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  const sfx = (() => {
    let noiseBuf = null;
    const ok = () => soundOn && audio && audio.state === 'running';
    function tone(freq, dur, { type = 'sine', gain = 0.12, at = 0, to = null } = {}) {
      const t = audio.currentTime + at;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    function noise(dur, { freq = 3000, type = 'highpass', gain = 0.1, at = 0 } = {}) {
      if (!noiseBuf) {
        noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.5, audio.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = audio.currentTime + at;
      const src = audio.createBufferSource();
      src.buffer = noiseBuf;
      const f = audio.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = audio.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(audio.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    }
    return {
      deal() { if (ok()) noise(0.05, { freq: 3800, gain: 0.09 }); },
      flip() { if (ok()) noise(0.04, { freq: 2400, gain: 0.07 }); },
      chip() { if (!ok()) return; tone(2400 + Math.random() * 300, 0.06, { gain: 0.06 }); tone(3200, 0.05, { gain: 0.04, at: 0.035 }); },
      chips() { if (!ok()) return; for (let i = 0; i < 4; i++) tone(2200 + Math.random() * 900, 0.05, { gain: 0.05, at: i * 0.045 }); },
      check() { if (!ok()) return; tone(190, 0.06, { gain: 0.22 }); tone(170, 0.06, { gain: 0.18, at: 0.1 }); },
      fold() { if (ok()) noise(0.2, { freq: 1100, type: 'lowpass', gain: 0.12 }); },
      allin() { if (!ok()) return; this.chips(); tone(220, 0.25, { type: 'triangle', gain: 0.1, to: 440 }); },
      win(big) { if (!ok()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, big ? 0.3 : 0.18, { type: 'triangle', gain: big ? 0.14 : 0.09, at: i * 0.09 })); },
      turn() { if (!ok()) return; tone(660, 0.28, { gain: 0.14 }); tone(880, 0.32, { gain: 0.14, at: 0.12 }); },
    };
  })();

  function place(el, left, top) {
    const l = `${left}%`;
    const t = `${top}%`;
    if (el._l !== l) { el._l = l; el.style.left = l; }
    if (el._t !== t) { el._t = t; el.style.top = t; }
  }

  // ---------- seat positions ----------

  function seatsInOrder(s, me) {
    const mine = me ? me.seat : 0;
    return s.seats.filter(Boolean).sort((a, b) => ((a.seat - mine + 8) % 8) - ((b.seat - mine + 8) % 8));
  }

  function layout(s, me) {
    const area = $('#tableArea');
    const wide = area.clientWidth > area.clientHeight * 1.05;
    const rx = wide ? 43 : 39;
    const ry = wide ? 40 : 43;
    const players = seatsInOrder(s, me);
    const pos = new Map();
    players.forEach((p, k) => {
      const th = Math.PI / 2 + (k * 2 * Math.PI) / players.length;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      pos.set(p.id, {
        x: 50 + rx * cos, y: 50 + ry * sin, cos, sin,
        bx: 50 + rx * 0.5 * cos, by: 50 + ry * 0.55 * sin,
        dx: 50 + rx * 0.76 * Math.cos(th + 0.3), dy: 50 + ry * 0.74 * Math.sin(th + 0.3),
      });
    });
    return { players, pos };
  }

  function avatarColour(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
  }

  // ---------- seats ----------

  function createSeat() {
    const root = document.createElement('div');
    root.className = 'seat entering';
    root.innerHTML = `
      <div class="hole"></div>
      <div class="avatar">
        <svg class="ring" viewBox="0 0 56 56" aria-hidden="true"><circle class="track" cx="28" cy="28" r="25"/><circle class="time" cx="28" cy="28" r="25"/></svg>
        <span class="ini"></span><span class="badges"></span>
      </div>
      <div class="plate"><div class="nm"><span class="nm-text"></span></div><div class="ch"></div></div>
      <div class="act"></div>`;
    const S = {
      root,
      hole: root.querySelector('.hole'),
      holeCards: [],
      avatar: root.querySelector('.avatar'),
      ini: root.querySelector('.ini'),
      badges: root.querySelector('.badges'),
      time: root.querySelector('.ring .time'),
      plate: root.querySelector('.plate'),
      nm: root.querySelector('.nm-text'),
      ch: root.querySelector('.ch'),
      act: root.querySelector('.act'),
      badgeKey: '', name: '', label: '', lockLabel: false, holdChips: false,
    };
    $('#seats').append(root);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('entering')));
    return S;
  }

  function labelFor(p, s) {
    const isMe = p.id === s.you;
    if (!p.connected) return ['Away', 'a-away'];
    if (s.stage === 'showdown' && p.shown && p.handName && !isMe) return [p.handName, 'a-hand'];
    switch (p.lastAction) {
      case 'Fold': return ['Fold', 'a-fold'];
      case 'Check': return ['Check', 'a-check'];
      case 'Call': return [`Call ${fmt(p.bet)}`, 'a-call'];
      case 'Bet': return [`Bet ${fmt(p.bet)}`, 'a-bet'];
      case 'Raise': return [`Raise ${fmt(p.bet)}`, 'a-raise'];
      case 'All-in': return ['All-in', 'a-allin'];
      case 'SB': return [`SB ${fmt(p.bet)}`, 'a-blind'];
      case 'BB': return [`BB ${fmt(p.bet)}`, 'a-blind'];
      default: break;
    }
    if (p.sittingOut && !p.inHand) return ['Sitting out', 'a-away'];
    if (p.chips === 0 && !p.inHand) return ['Out of chips', 'a-away'];
    return ['', ''];
  }

  function setLabel(S, text, cls) {
    if (S.label === text + cls) return false;
    S.label = text + cls;
    S.act.className = `act ${cls}`;
    S.act.textContent = text;
    return true;
  }

  function syncSeats(prev, s, ctx) {
    const seen = new Set();
    $('#seats').classList.toggle('dense', ctx.players.length >= 6);
    for (const p of ctx.players) {
      seen.add(p.id);
      const at = ctx.pos.get(p.id);
      let S = seatEls.get(p.id);
      if (!S) { S = createSeat(); seatEls.set(p.id, S); }
      const isMe = p.id === s.you;
      const acting = s.toAct === p.seat && BETTING.includes(s.stage);
      place(S.root, at.x, at.y);
      const c = S.root.classList;
      c.toggle('is-me', isMe);
      c.toggle('acting', acting);
      c.toggle('folded', !!p.folded && p.inHand);
      c.toggle('out', !p.inHand && (p.sittingOut || p.chips === 0 || s.stage !== 'waiting') && s.started);
      c.toggle('founder', !!p.founder);
      c.toggle('admin', s.hostId === p.id);
      c.toggle('right', at.cos > 0.3);
      c.toggle('top', at.sin < -0.6);

      if (S.name !== p.name) {
        S.name = p.name;
        S.nm.textContent = p.name;
        S.ini.textContent = [...p.name.trim()][0]?.toUpperCase() || '?';
        S.avatar.style.setProperty('--avc', avatarColour(p.name));
      }
      const badgeKey = `${p.founder}-${s.hostId === p.id}`;
      if (S.badgeKey !== badgeKey) {
        S.badgeKey = badgeKey;
        S.badges.innerHTML = (p.founder ? `<span class="founder-top" title="Founder">${FOUNDER_CROWN}</span>` : '') +
          (s.hostId === p.id ? `<span class="admin-badge" title="Admin">${CROWN}</span>` : '');
        const shine = S.plate.querySelector('.shine');
        if (p.founder && !shine) S.plate.insertAdjacentHTML('afterbegin', '<span class="shine" aria-hidden="true"></span>');
        if (!p.founder && shine) shine.remove();
      }

      if (!S.holdChips) setNumber(S.ch, p.chips, { instant: ctx.first });
      if (!S.lockLabel) {
        const [text, cls] = labelFor(p, s);
        setLabel(S, text, cls);
      }
      if (!isMe) syncHole(S, p, ctx.prevSeat(p.id), ctx);
      else if (S.holeCards.length) { S.hole.innerHTML = ''; S.holeCards = []; }
    }
    for (const [id, S] of seatEls) {
      if (seen.has(id)) continue;
      seatEls.delete(id);
      S.root.classList.add('entering');
      setTimeout(() => S.root.remove(), 350);
      const b = betEls.get(id);
      if (b) { b.remove(); betEls.delete(id); }
    }
  }

  function syncHole(S, p, prevP, ctx) {
    const cards = p.cards;
    const had = prevP && prevP.cards;
    if (!cards) {
      if (had && p.folded && prevP && !prevP.folded && !ctx.first) foldAway(S);
      if (S.holeCards.length) { S.hole.innerHTML = ''; S.holeCards = []; }
      S.root.classList.remove('reveal');
      return;
    }
    if (S.holeCards.length !== cards.length) {
      S.hole.innerHTML = '';
      S.holeCards = cards.map(() => {
        const el = makeCard('mini');
        S.hole.append(el);
        return el;
      });
    }
    let revealed = false;
    cards.forEach((c, i) => {
      const el = S.holeCards[i];
      if (ctx.newHand && !ctx.first) {
        setCard(el, '??', true);
        el.classList.add('await');
        ctx.dealTargets.set(`${p.id}:${i}`, el);
      } else if (c !== '??' && el.dataset.c !== c) {
        revealed = true;
        if (ctx.first) setCard(el, c, true);
        else {
          if (!el.dataset.c) setCard(el, '??', true); // a folded player showing: appear face down, then flip
          const delay = ctx.revealDelay + ctx.revealIndex * 160 + i * 90;
          el.dataset.c = c;
          later(delay, () => { setCard(el, c); sfx.flip(); });
        }
      } else if (c === '??' && el.dataset.c !== '??') {
        setCard(el, '??', true);
      }
    });
    if (revealed) {
      ctx.revealIndex += 1;
      if (ctx.first) S.root.classList.add('reveal');
      else later(ctx.revealDelay, () => S.root.classList.add('reveal'));
    }
    if (ctx.newHand) S.root.classList.remove('reveal');
  }

  function foldAway(S) {
    if (!S.holeCards.length) return;
    const r = box(S.hole);
    const f = mid(box($('#felt')));
    const copy = S.hole.cloneNode(true);
    // Flat card backs for the flying copy: no 3D needed while it fades away.
    for (const c of copy.querySelectorAll('.card')) {
      c.classList.remove('down');
      c.querySelector('.face').remove();
      c.querySelector('.back').style.transform = 'none';
    }
    copy.style.left = '0px';
    copy.style.top = '0px';
    copy.style.width = `${r.width}px`;
    copy.style.height = `${r.height}px`;
    copy.style.display = 'flex';
    copy.style.position = 'fixed';
    fly(copy, { x: r.left, y: r.top }, { x: r.left + (f.x - mid(r).x) * 0.35, y: r.top + (f.y - mid(r).y) * 0.35 }, { duration: 420, r1: 18, s1: 0.8, o1: 0, easing: 'cubic-bezier(.4,0,.6,1)' });
  }

  // ---------- bets and the pot ----------

  function betEl(id) {
    let el = betEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'bet hide';
      el.innerHTML = '<span class="chipstack one"><i></i><i></i><i></i></span><span class="v"></span>';
      $('#bets').append(el);
      betEls.set(id, el);
    }
    return el;
  }

  function syncBets(prev, s, ctx) {
    const bb = s.settings.bigBlind || 1;
    for (const p of ctx.players) {
      const el = betEl(p.id);
      const at = ctx.pos.get(p.id);
      place(el, at.bx, at.by);
      const prevBet = ctx.sameHand && ctx.prevSeat(p.id) ? ctx.prevSeat(p.id).bet : 0;
      if (p.bet > 0) {
        if (el._bet !== p.bet) {
          el._bet = p.bet;
          el.querySelector('.v').textContent = fmt(p.bet);
          el.querySelector('.chipstack').className = `chipstack ${p.bet >= bb * 6 ? '' : p.bet >= bb * 2 ? 'two' : 'one'}`;
        }
        if (p.bet > prevBet && !ctx.first) {
          const S = seatEls.get(p.id);
          const delay = ctx.newHand ? ctx.dealTime : 0;
          el.classList.add('hide');
          later(delay, () => {
            el.classList.remove('hide');
            const a = mid(box(S.avatar));
            const b = mid(box(el));
            if (!REDUCED) {
              el.animate([
                { transform: `translate(calc(-50% + ${a.x - b.x}px), calc(-50% + ${a.y - b.y}px)) scale(.5)`, opacity: 0 },
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
              ], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
            }
            sfx.chip();
          });
        } else el.classList.remove('hide');
      } else {
        if (prevBet > 0 && !ctx.first && !el.classList.contains('hide')) collectToPot(el);
        el.classList.add('hide');
      }
    }
  }

  function collectToPot(el) {
    const r = box(el);
    const target = mid(box($('#pot').hidden ? $('#board') : $('#pot')));
    const copy = el.cloneNode(true);
    copy.classList.remove('hide');
    copy.style.position = 'fixed';
    copy.style.left = '0px';
    copy.style.top = '0px';
    copy.style.width = `${r.width}px`;
    fly(copy, { x: r.left, y: r.top }, { x: target.x - r.width / 2, y: target.y - r.height / 2 }, { duration: 420, o1: 0.2, s1: 0.8, easing: 'cubic-bezier(.45,0,.25,1)' });
    sfx.chip();
  }

  function syncPot(prev, s, ctx) {
    const bets = s.seats.reduce((n, p) => n + (p ? p.bet : 0), 0);
    const middle = s.pot - bets;
    const potEl = $('#pot');
    const amt = $('#potAmt');
    $('#potTotal').textContent = bets > 0 && middle > 0 ? `Total ${fmt(s.pot)}` : '';
    if (ctx.resultsNew) {
      const total = s.results.pots.reduce((n, p) => n + p.amount, 0);
      potEl.hidden = false;
      setNumber(amt, total, { delay: ctx.collected ? 420 : 0 });
      later(ctx.winAt, () => setNumber(amt, 0, { duration: 600 }));
      later(ctx.winAt + 650, () => { potEl.hidden = true; });
      return;
    }
    if (s.results) return; // leave the finished hand as it is
    if (middle > 0) {
      potEl.hidden = false;
      setNumber(amt, middle, { delay: ctx.collected ? 420 : 0, instant: ctx.first });
    } else if (!ctx.collected) {
      potEl.hidden = true;
      setNumber(amt, 0, { instant: true });
    }
  }

  function syncDealer(s, ctx) {
    const btn = $('#dealerBtn');
    const d = s.seats[s.dealerSeat];
    if (!s.started || !s.handNumber || !d || !ctx.pos.has(d.id) || s.stage === 'waiting') { btn.hidden = true; return; }
    const at = ctx.pos.get(d.id);
    btn.hidden = false;
    place(btn, at.dx, at.dy);
  }

  // ---------- the board ----------

  function syncBoard(prev, s, ctx) {
    if (!boardEls.length) {
      for (let i = 0; i < 5; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const c = makeCard('gone');
        slot.append(c);
        $('#board').append(slot);
        boardEls.push(c);
      }
    }
    let k = 0;
    s.community.forEach((c, i) => {
      const el = boardEls[i];
      if (el.dataset.c === c) return;
      el.dataset.c = c;
      if (ctx.first) { setCard(el, c, true); el.classList.remove('gone'); return; }
      const delay = ctx.boardDelay + k * 140;
      k += 1;
      setCard(el, '??', true);
      el.dataset.c = c;
      el.classList.add('gone');
      later(delay, () => {
        el.classList.remove('gone');
        if (!REDUCED) {
          el.animate([
            { transform: 'translateY(-26px) rotateY(180deg) scale(.7)' },
            { transform: 'rotateY(180deg)' },
          ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
        sfx.deal();
        later(220, () => { setCard(el, c); sfx.flip(); });
      });
    });
    for (let i = s.community.length; i < 5; i++) {
      const el = boardEls[i];
      if (el.dataset.c) { setCard(el, '??', true); el.classList.add('gone'); el.dataset.c = ''; }
    }
    if (ctx.newHand || !s.results) for (const el of boardEls) el.classList.remove('win', 'dim');
  }

  // ---------- your cards ----------

  function syncMe(prev, s, ctx, me) {
    const holder = $('#meCards');
    const panel = $('#mePanel');
    panel.classList.toggle('folded', !!(me && me.folded && me.inHand));
    if (me && me.cards) {
      if (!meEls.length) {
        for (let i = 0; i < 2; i++) {
          const tilt = document.createElement('div');
          tilt.className = 'tilt';
          const c = makeCard('big');
          tilt.append(c);
          holder.append(tilt);
          meEls.push(c);
        }
      }
      me.cards.forEach((c, i) => {
        const el = meEls[i];
        if (ctx.newHand && !ctx.first) {
          setCard(el, '??', true);
          el.classList.add('await');
          el.dataset.c = c;
          ctx.dealTargets.set(`${me.id}:${i}`, el);
        } else if (el.dataset.c !== c || el.classList.contains('down')) {
          if (!el.classList.contains('await')) setCard(el, c, ctx.first);
          el.dataset.c = c;
        }
      });
    } else if (meEls.length) {
      holder.innerHTML = '';
      meEls.length = 0;
    }
    renderMeInfo(s, me, ctx);
  }

  function renderMeInfo(s, me, ctx) {
    const el = $('#meInfo');
    if (!me) { el.innerHTML = ''; return; }
    const pills = [
      me.founder ? `<span class="founder-pill">${FOUNDER_CROWN}<span>Founder</span></span>` : '',
      s.hostId === s.you ? `<span class="admin-pill">${CROWN}<span>Admin</span></span>` : '',
    ].filter(Boolean);
    const pillHtml = pills.length ? `<div class="pills">${pills.join('')}</div>` : '';
    const change = s.results && s.results.changes ? s.results.changes[s.you] : undefined;
    const showResult = change !== undefined && (!ctx.resultsNew || ctx.first);
    const result = showResult && change !== 0
      ? `<div class="result ${change > 0 ? 'won' : 'lost'}">${change > 0 ? `You won ${fmt(change)}` : `You lost ${fmt(-change)}`}</div>`
      : '';
    let html;
    if (me.cards) {
      const sub = me.folded ? 'You folded' : me.allIn ? 'You are all-in' : `${fmt(me.chips)} chips`;
      html = `<div class="info">${pillHtml}<div class="hand-name">${esc(s.yourHand || '')}</div><div class="sub">${sub}</div>${result}</div>`;
    } else {
      let sub;
      if (!s.started) sub = s.hostId === s.you ? 'Start the game when everyone has sat down.' : 'The admin will start the game.';
      else if (s.paused && s.stage === 'waiting') sub = 'The game is paused.';
      else if (me.chips === 0) sub = "You're out of chips.";
      else if (me.sittingOut) sub = "You're sitting out.";
      else sub = "You'll be dealt in next hand.";
      html = `<div class="info centered">${pillHtml}<div class="hand-name">${fmt(me.chips)} chips</div><div class="sub">${sub}</div></div>`;
    }
    if (el._key !== html) { el._key = html; el.innerHTML = html; }
  }

  // ---------- the middle of the table ----------

  function syncCenter(prev, s, ctx) {
    const note = $('#waitNote');
    const n = ctx.players.length;
    let noteHtml = '';
    if (!s.started) {
      noteHtml = `<p>Table code</p><div class="big-code">${esc(s.code)}</div><p>${n === 1 ? 'Invite friends to sit down' : `${n} players seated`}</p>`;
    } else if (s.paused && s.stage === 'waiting') {
      noteHtml = `<div class="big-code" style="font-size:30px;letter-spacing:.02em">Paused</div><p>${s.hostId === s.you ? 'Tap Resume to carry on' : 'The admin paused the game'}</p>`;
    } else if (s.stage === 'waiting') {
      noteHtml = '<p>Waiting for at least 2 players with chips</p>';
    }
    if (note._html !== noteHtml) { note._html = noteHtml; note.innerHTML = noteHtml; }
    const showTable = !noteHtml;
    $('#board').style.display = showTable ? '' : 'none';
    $('#deck').style.visibility = s.started && s.stage !== 'waiting' ? 'visible' : 'hidden';

    const pill = $('#pausePill');
    const pausing = s.paused && s.stage !== 'waiting';
    pill.hidden = !pausing;
    if (pausing) pill.textContent = 'Pausing after this hand';

    const banner = $('#banner');
    if (ctx.newHand || !s.results) { banner.classList.remove('show'); }
    if (ctx.resultsNew || (ctx.first && s.results)) {
      const ws = s.results.winners;
      const who = ws.length === 1
        ? `${esc(ws[0].name)} wins ${fmt(ws[0].amount)}`
        : `${ws.map((w) => esc(w.name)).join(' and ')} split the pot`;
      const how = s.results.uncontested ? 'Everyone else folded' : esc(s.results.pots[0].handName || '');
      banner.innerHTML = `<div class="who">${who}</div><div class="how">${how}</div>`;
      if (ctx.first) banner.classList.add('show');
      else later(ctx.winAt, () => banner.classList.add('show'));
    }
  }

  let tickerTimer = null;
  function ticker(text) {
    const el = $('#ticker');
    el.classList.add('fade');
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => {
      el.textContent = text;
      el.classList.remove('fade');
      tickerTimer = setTimeout(() => el.classList.add('fade'), 2600);
    }, 140);
  }

  // ---------- the big moments ----------

  function runDeal(s, ctx) {
    if (!ctx.newHand || ctx.first) return;
    const order = [];
    const n = s.seats.length;
    for (let i = 1; i <= n; i++) {
      const p = s.seats[(s.dealerSeat + i) % n];
      if (p && p.inHand) order.push(p);
    }
    // Measure everything first, then start the animations (keeps the browser from re-measuring each time).
    const deck = box($('#deck'));
    const jobs = [];
    for (let round = 0; round < 2; round++) {
      for (const p of order) {
        const target = ctx.dealTargets.get(`${p.id}:${round}`);
        if (!target) continue;
        jobs.push({ target, mine: p.id === s.you, r: box(target), tilt: parseFloat(getComputedStyle(target).rotate) || 0 });
      }
    }
    jobs.forEach((j, k) => {
      dealGhost(j.target, k * 85, () => {
        j.target.classList.remove('await');
        if (j.mine) setTimeout(() => { setCard(j.target, j.target.dataset.c); sfx.flip(); }, 160);
      }, j.r, deck, j.tilt);
    });
  }

  function runWin(s, ctx) {
    if (!ctx.resultsNew || ctx.first) {
      if (ctx.first && s.results) applyWinLook(s);
      return;
    }
    const r = s.results;
    later(ctx.winAt, () => {
      $('#ticker').classList.add('fade');
      const potBox = box($('#pot'));
      const from = mid(potBox);
      const iWon = r.winners.some((w) => w.id === s.you);
      sfx.win(iWon);
      const targets = r.winners.map((w) => { const S = seatEls.get(w.id); return S ? [w, mid(box(S.avatar))] : null; }).filter(Boolean);
      for (const [w, to] of targets) {
        const count = Math.min(8, 3 + Math.round(Math.log2(1 + w.amount / (s.settings.bigBlind || 1))));
        for (let i = 0; i < count; i++) {
          const g = chipGhost(['', 'c2', 'c3'][i % 3]);
          const jitter = () => (Math.random() - 0.5) * 22;
          fly(g, { x: from.x - 8 + jitter(), y: from.y - 8 + jitter() }, { x: to.x - 8, y: to.y - 8 }, { duration: 620, delay: i * 55, arc: 40, s1: 0.7, o1: 0.3, easing: 'cubic-bezier(.45,0,.2,1)' });
        }
        later(250, () => sfx.chips());
      }
      later(640, () => applyWinLook(s));
    });
  }

  // Gold rings, labels, +/- amounts and the winning cards lit up.
  function applyWinLook(s) {
    const r = s.results;
    if (!r) return;
    const winnerIds = new Set(r.winners.map((w) => w.id));
    for (const w of r.winners) {
      const S = seatEls.get(w.id);
      if (!S) continue;
      S.root.classList.add('winner');
      S.lockLabel = true;
      setLabel(S, `Wins ${fmt(w.amount)}`, 'a-win');
      pop(S.act);
      S.holdChips = false;
      const p = state.seats.find((x) => x && x.id === w.id);
      if (p) setNumber(S.ch, p.chips, { duration: 700 });
    }
    if (r.changes) {
      const jobs = Object.entries(r.changes)
        .filter(([id, amount]) => amount !== 0 && seatEls.has(id))
        .map(([id, amount]) => [mid(box(seatEls.get(id).avatar)), amount, winnerIds.has(id)]);
      for (const [c, amount, won] of jobs) floatText(c, `${amount > 0 ? '+' : '−'}${fmt(Math.abs(amount))}`, amount > 0, won ? 120 : 0);
    }
    const best = new Set(!r.uncontested && r.winners[0] ? r.winners[0].cards : []);
    if (best.size) {
      for (const el of boardEls) {
        if (!el.dataset.c) continue;
        el.classList.toggle('win', best.has(el.dataset.c));
        el.classList.toggle('dim', !best.has(el.dataset.c));
      }
      for (const el of meEls) el.classList.toggle('win', best.has(el.dataset.c));
      for (const S of seatEls.values()) for (const el of S.holeCards) el.classList.toggle('win', best.has(el.dataset.c));
    }
    renderMeInfo(state, state.seats.find((x) => x && x.id === state.you), { resultsNew: false });
  }

  function resetHandLook() {
    for (const t of handTimers) clearTimeout(t);
    handTimers = [];
    for (const S of seatEls.values()) {
      S.root.classList.remove('winner', 'reveal');
      S.lockLabel = false;
      S.holdChips = false;
      for (const el of S.holeCards) el.classList.remove('win');
    }
    for (const el of meEls) el.classList.remove('win');
    for (const el of boardEls) el.classList.remove('win', 'dim');
  }

  // New actions in the log: pop the label, play the sound, show it in the middle.
  function processEvents(prev, s, ctx) {
    const fresh = s.log.filter((l) => l.id > lastLogId);
    if (s.log.length) lastLogId = s.log[s.log.length - 1].id;
    if (ctx.first) return;
    for (const l of fresh) {
      if (l.kind === 'action') {
        const S = seatEls.get(l.pid);
        if (S) pop(S.act);
        ({ fold: () => sfx.fold(), check: () => sfx.check(), allin: () => sfx.allin() }[l.act] || (() => {}))();
        ticker(prettyCards(l.text));
      } else if (l.kind === 'show') {
        ticker(prettyCards(l.text));
      } else if (l.kind === 'chat' && !$('#logSheet').open) {
        toast(`${l.from}: ${l.text}`);
        $('#unreadDot').hidden = false;
      } else if (l.kind === 'settings' && s.hostId !== s.you) {
        toast(l.text);
      } else if (l.kind === 'founder') {
        toast(l.text);
      }
    }
  }

  // The countdown ring around whoever's turn it is.
  function syncTimer(s) {
    const p = s.toAct >= 0 && BETTING.includes(s.stage) ? s.seats[s.toAct] : null;
    const moves = s.log.filter((l) => l.kind === 'action');
    const key = p ? `${s.handNumber}-${s.stage}-${p.id}-${moves.length ? moves[moves.length - 1].id : 0}-${s.turnEndsIn != null}` : '';
    if (key === timerKey) return;
    timerKey = key;
    for (const S of seatEls.values()) S.time.classList.remove('run');
    if (!p || s.turnEndsIn == null) return;
    const S = seatEls.get(p.id);
    if (!S) return;
    const total = Math.max((s.turnSeconds || 30) * 1000, s.turnEndsIn);
    S.time.style.setProperty('--dur', `${total}ms`);
    S.time.style.setProperty('--delay', `${-(total - s.turnEndsIn)}ms`);
    void S.time.getBoundingClientRect();
    S.time.classList.add('run');
  }

  // ---------- putting it together ----------

  function render(prev) {
    const s = state;
    const me = s.seats.find((p) => p && p.id === s.you);
    const isHost = s.hostId === s.you;
    if (prev && prev.code !== s.code) prev = null;
    const first = !prev || document.hidden;
    const newHand = !!prev && s.handNumber !== prev.handNumber;
    const sameHand = !!prev && !newHand;
    const prevById = new Map(prev ? prev.seats.filter(Boolean).map((p) => [p.id, p]) : []);
    const { players, pos } = layout(s, me);

    if (newHand || (sameHand && prev.results && !s.results)) resetHandLook();

    const collected = sameHand && players.some((p) => {
      const q = prevById.get(p.id);
      return q && q.bet > 0 && p.bet === 0;
    });
    const prevBoard = sameHand ? prev.community.length : 0;
    const newBoardCards = Math.max(0, s.community.length - prevBoard);
    const resultsNew = !!s.results && (!prev || !prev.results || newHand);
    const boardDelay = collected ? 420 : 0;
    const boardTime = newBoardCards ? boardDelay + 260 + (newBoardCards - 1) * 140 + 520 : boardDelay;
    const revealDelay = boardTime;
    const anyReveal = players.some((p) => p.id !== s.you && p.cards && p.cards[0] !== '??' && (!prevById.get(p.id) || !prevById.get(p.id).cards || prevById.get(p.id).cards[0] === '??'));
    const winAt = boardTime + (resultsNew && !s.results.uncontested && anyReveal ? 900 : 260);
    const inHandCount = players.filter((p) => p.inHand).length;

    const ctx = {
      first, newHand, sameHand, players, pos, collected, resultsNew,
      boardDelay, revealDelay, revealIndex: 0, winAt,
      dealTargets: new Map(),
      dealTime: newHand ? inHandCount * 2 * 85 + 380 : 0,
      prevSeat: (id) => prevById.get(id),
    };

    // Winners' stacks wait for the chips to arrive.
    if (resultsNew && !first) {
      for (const w of s.results.winners) {
        const S = seatEls.get(w.id);
        if (S) S.holdChips = true;
      }
    }

    if (!$('#settingsSheet').open) applyTheme(s.settings.felt, s.settings.room);
    $('#codeText').textContent = s.code;
    $('#adminBtn').hidden = !isHost;
    const pb = $('#pauseBtn');
    pb.hidden = !isHost || !s.started;
    pb.classList.toggle('paused', !!s.paused);
    pb.setAttribute('aria-label', s.paused ? 'Resume the game' : 'Pause the game');
    const blinds = `<span>Blinds ${fmt(s.settings.smallBlind)}/${fmt(s.settings.bigBlind)}</span>` +
      `<span>${[s.handNumber ? `Hand ${s.handNumber}` : '', s.settings.ante ? `ante ${fmt(s.settings.ante)}` : ''].filter(Boolean).join(', ').replace(/^a/, 'A')}</span>`;
    const bt = $('#blindsText');
    if (bt._html !== blinds) { bt._html = blinds; bt.innerHTML = blinds; }

    syncSeats(prev, s, ctx);
    syncBets(prev, s, ctx);
    syncDealer(s, ctx);
    syncBoard(prev, s, ctx);
    syncPot(prev, s, ctx);
    syncMe(prev, s, ctx, me);
    syncCenter(prev, s, ctx);
    runDeal(s, ctx);
    runWin(s, ctx);
    processEvents(prev, s, ctx);
    syncTimer(s);
    renderActions(s, me, isHost);
    if ($('#menuSheet').open) renderMenu(s, me, isHost);
    if ($('#logSheet').open) renderLog();
    handleTurn(s, me);
  }

  // ---------- your buttons ----------

  function turnLine(s) {
    if (s.turnEndsIn == null) return '<div class="turn-line"><i></i></div>';
    const total = Math.max((s.turnSeconds || 30) * 1000, s.turnEndsIn);
    return `<div class="turn-line"><i class="run" style="--dur:${total}ms;--delay:${-(total - s.turnEndsIn)}ms"></i></div>`;
  }

  function renderActions(s, me, isHost) {
    const el = $('#actions');
    const a = s.actions;
    const canShow = !!(me && s.stage === 'showdown' && me.inHand && me.cards && !me.shown);
    const key = JSON.stringify([a, s.stage, s.started, s.paused, isHost, me && me.sittingOut, s.canRebuy, s.toAct, s.seats.filter(Boolean).length, !!raise, canShow, s.handNumber]);
    if (key === actionsKey) return;
    actionsKey = key;
    if (!a) raise = null;

    if (a && raise) return drawRaise(s, a);

    if (a) {
      const callLabel = a.canCheck ? 'Check' : a.toCall >= a.chips ? `All-in <small>${fmt(a.toCall)}</small>` : `Call <small>${fmt(a.toCall)}</small>`;
      const raiseBtn = a.raise
        ? `<button class="btn raise" data-act="open-raise">${a.raise.isBet ? 'Bet' : 'Raise'}</button>`
        : `<button class="btn quiet" disabled>Raise</button>`;
      el.innerHTML = `<div class="slide-in">${turnLine(s)}<div class="row">
        <button class="btn fold" data-act="fold">Fold</button>
        <button class="btn call" data-act="${a.canCheck ? 'check' : 'call'}">${callLabel}</button>
        ${raiseBtn}
      </div></div>`;
      return;
    }

    const buttons = [];
    let status = '';
    if (canShow) buttons.push('<button class="btn show-hand" data-act="show">Show hand</button>');
    if (s.canRebuy) buttons.push(`<button class="btn brass" data-act="rebuy">Rebuy ${fmt(s.settings.startingChips)} chips</button>`);
    else if (me && me.sittingOut) buttons.push(`<button class="btn brass" data-act="sit-in">I'm back</button>`);

    if (!s.started) {
      const n = s.seats.filter(Boolean).length;
      if (isHost) {
        buttons.push(`<button class="btn brass" data-act="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Waiting for players' : `Start game with ${n}`}</button>`);
        buttons.push(`<button class="btn ghost" data-act="invite">Invite</button>`);
      } else {
        const host = s.seats.find((p) => p && p.id === s.hostId);
        status = `Waiting for <b>${esc(host ? host.name : 'the admin')}</b> to start the game`;
      }
    } else if (s.paused && s.stage === 'waiting') {
      if (isHost) buttons.push('<button class="btn brass" data-act="resume">Resume game</button>');
      else status = 'The admin paused the game';
    } else if (BETTING.includes(s.stage) && s.toAct >= 0) {
      const p = s.seats[s.toAct];
      if (p) status = `<b>${esc(p.name)}</b> is thinking`;
    } else if (s.stage === 'showdown') {
      status = s.paused ? 'The game pauses after this hand' : 'Next hand coming up';
    }

    if (buttons.length) el.innerHTML = `<div class="slide-in"><div class="row ${buttons.length === 1 ? 'one' : buttons.length === 2 ? 'two' : ''}">${buttons.slice(0, 3).join('')}</div></div>`;
    else el.innerHTML = `<div class="status">${status}</div>`;
  }

  function refreshActions() {
    if (!state) return;
    actionsKey = '';
    renderActions(state, state.seats.find((p) => p && p.id === state.you), state.hostId === state.you);
  }

  function handleTurn(s, me) {
    const mine = !!s.actions;
    const moves = s.log.filter((l) => l.kind === 'action');
    const key = mine ? `${s.handNumber}-${s.stage}-${s.currentBet}-${moves.length ? moves[moves.length - 1].id : 0}` : '';
    if (mine && key !== lastTurnKey) {
      sfx.turn();
      if (navigator.vibrate) navigator.vibrate(60);
      announce('Your turn');
    }
    lastTurnKey = key;
    document.title = mine ? 'Your turn | Black Tie Poker' : 'Black Tie Poker';
  }

  function announce(text) { $('#announcer').textContent = text; }

  window.addEventListener('resize', () => { if (state) { const { pos } = layout(state, state.seats.find((p) => p && p.id === state.you)); for (const [id, at] of pos) { const S = seatEls.get(id); if (S) { S.root.style.left = `${at.x}%`; S.root.style.top = `${at.y}%`; S.root.classList.toggle('right', at.cos > 0.3); } const b = betEls.get(id); if (b) { b.style.left = `${at.bx}%`; b.style.top = `${at.by}%`; } } } });

  // Leaving a table clears it so the next one starts fresh.
  function clearTable() {
    for (const S of seatEls.values()) S.root.remove();
    seatEls.clear();
    for (const b of betEls.values()) b.remove();
    betEls.clear();
    for (const el of boardEls) { setCard(el, '??', true); el.classList.add('gone'); el.dataset.c = ''; }
    $('#meCards').innerHTML = '';
    meEls.length = 0;
    timerKey = '';
    actionsKey = '';
    resetHandLook();
  }

  function potRaise(s, a, fraction) {
    const toCall = a.currentBet - a.myBet;
    return Math.round(a.currentBet + (s.pot + toCall) * fraction);
  }

  function drawRaise(s, a) {
    const r = a.raise;
    const clamp = (v) => Math.max(r.min, Math.min(r.max, Math.round(v)));
    raise.value = clamp(raise.value);
    const verb = r.isBet ? 'Bet' : 'Raise to';
    const half = clamp(potRaise(s, a, 0.5));
    const pot = clamp(potRaise(s, a, 1));
    $('#actions').innerHTML = `${turnLine(s)}<div class="raise-panel">
      <div class="raise-top">
        <button class="step-btn" data-act="minus" aria-label="Less">−</button>
        <div class="amount"><small>${verb}</small><span id="raiseAmt">${fmt(raise.value)}</span></div>
        <button class="step-btn" data-act="plus" aria-label="More">+</button>
      </div>
      <input type="range" id="raiseRange" min="${r.min}" max="${r.max}" step="1" value="${raise.value}" aria-label="${verb} amount">
      <div class="presets">
        <button data-set="${r.min}">Min</button>
        <button data-set="${half}" ${half <= r.min || half >= r.max ? 'disabled' : ''}>½ pot</button>
        <button data-set="${pot}" ${pot <= r.min || pot >= r.max ? 'disabled' : ''}>Pot</button>
        <button data-set="${r.max}">All-in</button>
      </div>
      <div class="row two">
        <button class="btn ghost" data-act="close-raise">Back</button>
        <button class="btn raise" data-act="raise" id="raiseGo">${raise.value >= r.max ? 'All-in' : `${verb} ${fmt(raise.value)}`}</button>
      </div>
    </div>`;
    $('#raiseRange').addEventListener('input', (e) => setRaise(+e.target.value, false));
  }

  function setRaise(v, moveSlider = true) {
    const a = state && state.actions;
    if (!a || !a.raise || !raise) return;
    const r = a.raise;
    raise.value = Math.max(r.min, Math.min(r.max, Math.round(v)));
    $('#raiseAmt').textContent = fmt(raise.value);
    const verb = r.isBet ? 'Bet' : 'Raise to';
    $('#raiseGo').textContent = raise.value >= r.max ? 'All-in' : `${verb} ${fmt(raise.value)}`;
    if (moveSlider) $('#raiseRange').value = raise.value;
  }

  $('#actions').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.dataset.set) return setRaise(+btn.dataset.set);
    const act = btn.dataset.act;
    const a = state && state.actions;
    switch (act) {
      case 'fold': case 'check': case 'call':
        for (const b of $('#actions').querySelectorAll('button')) b.disabled = true;
        if (!(await send('action', { type: act })).ok) refreshActions();
        break;
      case 'open-raise':
        raise = { value: a.raise.min };
        refreshActions();
        break;
      case 'close-raise':
        raise = null;
        refreshActions();
        break;
      case 'minus': setRaise(raise.value - state.settings.bigBlind); break;
      case 'plus': setRaise(raise.value + state.settings.bigBlind); break;
      case 'raise': {
        const amount = raise.value;
        btn.disabled = true;
        const res = await send('action', { type: 'raise', amount });
        if (res.ok) raise = null;
        else btn.disabled = false;
        break;
      }
      case 'start': await send('start'); break;
      case 'rebuy': await send('rebuy'); break;
      case 'sit-in': await send('sitout', { value: false }); break;
      case 'invite': invite(); break;
      case 'show': btn.disabled = true; await send('show'); break;
      case 'resume': await send('pause', { value: false }); break;
    }
  });

  // ---------- log, chat, menu ----------

  function renderLog() {
    const list = $('#logList');
    list.innerHTML = state.log.map((l) =>
      l.kind === 'chat'
        ? `<li class="msg"><b>${esc(l.from)}</b> ${esc(l.text)}</li>`
        : `<li class="${l.kind}">${esc(prettyCards(l.text))}</li>`).join('');
    list.scrollTop = list.scrollHeight;
  }

  function prettyCards(text) {
    // \uFE0E keeps the suit symbols as plain text instead of emoji.
    return text.replace(/\b([2-9TJQKA])([shdc])\b/g, (_, r, su) => (RANK[r] || r) + SUITS[su][0] + '\uFE0E');
  }

  function renderMenu(s, me, isHost) {
    $('#mSettings').hidden = !isHost;
    $('#mPause').hidden = !isHost || !s.started;
    $('#mPause').textContent = s.paused ? 'Resume the game' : 'Pause the game';
    $('#mSitOut').textContent = me && me.sittingOut ? "I'm back, deal me in" : 'Sit out next hand';
    $('#mSound').textContent = `Sound: ${soundOn ? 'on' : 'off'}`;
    const players = s.seats.filter(Boolean).sort((a, b) => b.chips - a.chips);
    $('#standings').innerHTML = players.map((p) => `<li>
      <span class="who">${p.founder ? `<span class="founder-mark" aria-label="Founder">${FOUNDER_CROWN}</span>` : ''}${s.hostId === p.id ? `<span class="admin-mark" aria-label="Admin">${CROWN}</span>` : ''}${esc(p.name)}${p.id === s.you ? ' (you)' : ''}</span>
      <span class="num">${fmt(p.chips)}</span>
      <span class="${p.net >= 0 ? 'up' : 'down'}">${p.net > 0 ? '+' : ''}${fmt(p.net)}</span>
    </li>`).join('');
  }

  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  const open = (id) => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); $(id).showModal(); };

  $('#menuBtn').addEventListener('click', () => {
    if (state) renderMenu(state, state.seats.find((p) => p && p.id === state.you), state.hostId === state.you);
    open('#menuSheet');
  });
  async function togglePause() {
    if (!state) return;
    const res = await send('pause', { value: !state.paused });
    if (res.ok) toast(state.paused ? 'Game resumed' : state.stage === 'waiting' ? 'Game paused' : 'The game will pause after this hand');
  }
  $('#pauseBtn').addEventListener('click', togglePause);
  $('#mPause').addEventListener('click', async () => { $('#menuSheet').close(); await togglePause(); });
  $('#inviteBtn').addEventListener('click', invite);
  $('#mInvite').addEventListener('click', invite);
  $('#mLog').addEventListener('click', () => { open('#logSheet'); $('#unreadDot').hidden = true; renderLog(); });
  $('#mSitOut').addEventListener('click', async () => {
    const me = state.seats.find((p) => p && p.id === state.you);
    await send('sitout', { value: !(me && me.sittingOut) });
    $('#menuSheet').close();
  });
  $('#mSound').addEventListener('click', () => {
    soundOn = !soundOn;
    store.set('btp-sound', soundOn ? 'on' : 'off');
    $('#mSound').textContent = `Sound: ${soundOn ? 'on' : 'off'}`;
    unlockAudio();
  });
  // ---------- admin settings ----------

  let pendingFelt = null;
  let pendingRoom = null;
  let savedSettings = false;

  function swatches(el, list, current, onPick) {
    const known = list.some(([hex]) => hex === current);
    el.innerHTML = list.map(([hex, name]) =>
      `<button type="button" class="swatch" role="radio" aria-checked="${hex === current}" aria-label="${name}" title="${name}" data-hex="${hex}" style="--c:${hex}"></button>`).join('') +
      `<label class="swatch custom" title="Pick any colour" aria-checked="${!known}" style="--c:${known ? 'transparent' : current}">
        <input type="color" value="${current}" aria-label="Pick any colour"><span>Any</span>
      </label>`;
    el.onclick = (e) => {
      const b = e.target.closest('button.swatch');
      if (b) onPick(b.dataset.hex);
    };
    el.querySelector('input[type=color]').oninput = (e) => onPick(e.target.value);
  }

  function drawSwatches() {
    swatches($('#feltSwatches'), FELTS, pendingFelt, (hex) => { pendingFelt = hex; preview(); });
    swatches($('#roomSwatches'), ROOMS, pendingRoom, (hex) => { pendingRoom = hex; preview(); });
  }

  function preview() {
    applyTheme(pendingFelt, pendingRoom);
    // Update the ticks without rebuilding the colour pickers (keeps the picker open on phones).
    for (const [id, cur, list] of [['#feltSwatches', pendingFelt, FELTS], ['#roomSwatches', pendingRoom, ROOMS]]) {
      const known = list.some(([hex]) => hex === cur);
      for (const b of $(id).querySelectorAll('button.swatch')) b.setAttribute('aria-checked', String(b.dataset.hex === cur));
      const custom = $(id).querySelector('.custom');
      custom.setAttribute('aria-checked', String(!known));
      custom.style.setProperty('--c', known ? 'transparent' : cur);
    }
  }

  function openSettings() {
    const st = state.settings;
    $('#setSB').value = st.smallBlind;
    $('#setBB').value = st.bigBlind;
    $('#setAnte').value = st.ante || 0;
    $('#setChips').value = st.startingChips;
    $('#setTimer').value = String(st.turnSeconds);
    markQuick('set');
    pendingFelt = st.felt;
    pendingRoom = st.room;
    savedSettings = false;
    drawSwatches();
    open('#settingsSheet');
  }

  $('#mSettings').addEventListener('click', openSettings);
  $('#adminBtn').addEventListener('click', openSettings);
  // Closing without saving puts the old colours back.
  $('#settingsSheet').addEventListener('close', () => {
    if (!savedSettings && state) { themeKey = ''; applyTheme(state.settings.felt, state.settings.room); }
  });
  $('#saveSettings').addEventListener('click', async () => {
    const settings = readSettings('set');
    if (!settings) return;
    const res = await send('settings', { ...settings, felt: pendingFelt, room: pendingRoom });
    if (res.ok) { savedSettings = true; $('#settingsSheet').close(); toast('Saved. Everyone at the table sees the changes.'); }
  });
  $('#mLeave').addEventListener('click', async () => {
    const code = myCode;
    const res = await send('leave');
    if (res.ok) { store.del(tokenKey(code)); $('#menuSheet').close(); showHome('You left the table.'); }
  });
  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#chatInput').value.trim();
    if (!text) return;
    const res = await send('chat', { text });
    if (res.ok) $('#chatInput').value = '';
  });

  async function invite() {
    if (!myCode) return;
    const url = `${location.origin}/?t=${myCode}`;
    const text = `Join my poker table on Black Tie Poker. Code ${myCode}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Black Tie Poker', text, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Invite link copied. Paste it in your group chat.'); }
    catch { toast(`Send your friends this link: ${url}`); }
  }

  // ---------- toast ----------

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  window.addEventListener('resize', () => { if (state) renderTable(state, state.seats.find((p) => p && p.id === state.you)); });
})();
