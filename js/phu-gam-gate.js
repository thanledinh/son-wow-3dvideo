// Màn mở đầu: chìa khóa + nút START, lấy từ daily.zappa.vn (repo store-pring, web/index.html: keySVG, vòng tua, Engine, ignite)
// rồi đổi sang logo GB và màu xanh của logo. js/phu-gam.js báo "gam:ready" khi tải đủ 100%; bấm START thì
// báo lại "gam:go" để cảnh 3D bắt đầu mở màn.
const root = document.documentElement;
const gate = document.getElementById("gate");

// ----- nhạc nền: assets/phu-gam/nhac-nen.mp3 (từ daily.zappa.vn), phát lặp. Bật khi bấm START (trình duyệt chỉ cho phát tiếng
// sau một lần chạm), vào nhẹ trong ~1,5 giây; nút loa ở thanh trên cùng để tắt / bật; ẩn tab thì tạm dừng -----
const soundBtn = document.getElementById("sound");
const Music = (() => {
  const a = new Audio("assets/phu-gam/nhac-nen.mp3?v=2");
  a.loop = true;
  a.preload = "none";                     // chỉ tải khi bấm START (file 2 MB: bản gốc 5 MB nén lại còn 64 kbps)
  const VOL = 0.55;
  let on = false;
  let fadeT = 0;
  let held = false;                       // video quy trình đang phát tiếng: nhạc nền nhường (xem cuối khối này)
  function set(v) {
    on = v;
    clearInterval(fadeT);
    if (v && held) return on;             // bật loa lúc video đang chạy: ghi nhận, nhạc vào lại khi video dừng
    if (v) {
      a.volume = 0;
      a.play().catch(() => {
        on = false;
        soundBtn?.setAttribute("aria-pressed", "false");
      });
      fadeT = setInterval(() => {
        a.volume = Math.min(VOL, a.volume + VOL / 30);
        if (a.volume >= VOL) clearInterval(fadeT);
      }, 50);
    } else {
      a.pause();
    }
    return on;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) a.pause();
    else if (on && !held) a.play().catch(() => {});
  });
  // (người dùng: vào video có thêm nhạc nữa bị đá nhau) video quy trình có tiếng riêng: lúc nó chạy thì nhạc nền dừng,
  // video tạm dừng / hết / bị tắt tiếng thì nhạc nền vào lại nhẹ nhàng (nếu loa đang bật). Nút loa vẫn giữ trạng thái.
  function hold(v) {
    if (v === held) return;
    held = v;
    if (v) {
      clearInterval(fadeT);
      a.pause();
    } else if (on && !document.hidden) set(true);
  }
  for (const v of document.querySelectorAll("video[controls]")) {
    const sync = () => hold(!v.paused && !v.ended && !v.muted && v.volume > 0);
    for (const ev of ["play", "playing", "pause", "ended", "volumechange", "emptied"]) v.addEventListener(ev, sync);
  }
  return { set, get on() { return on; } };
})();
function setSound(v) {
  const ok = Music.set(v);
  soundBtn?.setAttribute("aria-pressed", String(!!ok && v));
}
soundBtn?.addEventListener("click", () => setSound(!Music.on));

if (gate) boot();

function boot() {
  const $ = (s) => gate.querySelector(s);
  const hint = $("#gateHint");
  const startBtn = $("#gateStart");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const skip = !!location.hash || new URLSearchParams(location.search).has("debug");
  if (skip) {
    gate.remove();
    return;
  }
  root.classList.add("gated");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const eout = (t) => 1 - (1 - t) ** 3;
  const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  function tween(a, b, ms, ease, cb) {
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        cb(a + (b - a) * ease(k));
        k < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }

  // ----- chìa khóa (SVG), vẽ như bên daily; huy hiệu giữa là huy hiệu lục giác GB Premium Car Care -----
  function keySVG() {
    let leaves = "";
    for (const a of [78, 58, 38, 18, -2, -22]) {
      const r = (a * Math.PI) / 180, x = 110 + 45 * Math.cos(r), y = 168 + 45 * Math.sin(r), rot = a - 62;
      leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="7" ry="2.7" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      leaves += `<ellipse cx="${(220 - x).toFixed(1)}" cy="${y.toFixed(1)}" rx="7" ry="2.7" transform="rotate(${-rot} ${(220 - x).toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    const pt = (a, sx = 1) => `${(110 + sx * 45 * Math.cos(a)).toFixed(1)} ${(168 + 45 * Math.sin(a)).toFixed(1)}`;
    const btn = (cx, icon) => `<g transform="translate(${cx} 292)"><circle r="15.5" fill="url(#kbtn)" stroke="rgba(76,196,220,.55)" stroke-width=".9"/><circle r="12.5" fill="none" stroke="rgba(255,255,255,.05)"/><g fill="none" stroke="#8fe0f0" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icon}</g></g>`;
    const lock = '<rect x="-5" y="-1.5" width="10" height="8" rx="1.6"/><path d="M-3.4 -1.5v-2.6a3.4 3.4 0 0 1 6.8 0v2.6"/>';
    const unlock = '<rect x="-5" y="-1.5" width="10" height="8" rx="1.6"/><path d="M-3.4 -1.5v-2.6a3.4 3.4 0 0 1 6.6 -1"/>';
    const trunk = '<path d="M-7 4.5h14v-3.5l-2.4-4.5h-9.2L-7 1z"/><path d="M-4.5 1.2h9"/>';
    return `
  <svg viewBox="0 0 220 400" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="kchrome" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f6f6f6"/><stop offset=".22" stop-color="#8f8f8f"/><stop offset=".42" stop-color="#ffffff"/>
        <stop offset=".6" stop-color="#555"/><stop offset=".8" stop-color="#dadada"/><stop offset="1" stop-color="#6e6e6e"/>
      </linearGradient>
      <linearGradient id="kgold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#d4f5fb"/><stop offset=".38" stop-color="#4cc4dc"/><stop offset=".68" stop-color="#1f6f82"/><stop offset="1" stop-color="#8fe0f0"/>
      </linearGradient>
      <radialGradient id="kbody" cx=".34" cy=".22" r=".95">
        <stop offset="0" stop-color="#262b2e"/><stop offset=".55" stop-color="#0e1011"/><stop offset="1" stop-color="#050505"/>
      </radialGradient>
      <radialGradient id="kbtn" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#25292b"/><stop offset="1" stop-color="#0b0b0b"/></radialGradient>
      <linearGradient id="kgloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="kglint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#e8fbff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="kclip"><rect x="36" y="82" width="148" height="284" rx="58"/></clipPath>
    </defs>
    <ellipse cx="110" cy="40" rx="33" ry="29" fill="none" stroke="url(#kchrome)" stroke-width="7"/>
    <ellipse cx="110" cy="40" rx="33" ry="29" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1" transform="translate(-1 -1)"/>
    <rect x="97" y="60" width="26" height="26" rx="7" fill="url(#kchrome)"/>
    <rect x="28" y="74" width="164" height="300" rx="66" fill="url(#kchrome)"/>
    <rect x="36" y="82" width="148" height="284" rx="58" fill="url(#kbody)"/>
    <rect x="44" y="90" width="132" height="268" rx="51" fill="none" stroke="#4cc4dc" stroke-opacity=".7" stroke-width="1.3" stroke-dasharray="4.5 3.5"/>
    <path d="M${pt(1.43)}A45 45 0 0 0 ${pt(-0.42)}M${pt(1.43, -1)}A45 45 0 0 1 ${pt(-0.42, -1)}" fill="none" stroke="url(#kgold)" stroke-width="1.1"/>
    <g fill="url(#kgold)">${leaves}</g>
    <polygon points="110,131 142.5,149.5 142.5,186.5 110,205 77.5,186.5 77.5,149.5" fill="#050505" stroke="#4bc3dc" stroke-width="5" stroke-linejoin="round"/>
    <image href="assets/phu-gam/gb-mark.webp" x="89" y="149" width="42" height="17.9" preserveAspectRatio="xMidYMid meet"/>
    <rect x="80" y="177" width="60" height="8.5" fill="#4bc3dc"/>
    <text x="110" y="183.2" text-anchor="middle" font-size="4" letter-spacing=".55" fill="#050505" font-weight="600">PREMIUM CAR CARE</text>
    <text x="110" y="236" text-anchor="middle" font-size="8" letter-spacing="2.2" fill="#8fe0f0" font-weight="500">PHỦ GẦM</text>
    <path d="M86 250h48" stroke="url(#kgold)" stroke-width=".8"/>
    ${btn(72, lock)}${btn(110, unlock)}${btn(148, trunk)}
    <rect x="84" y="322" width="52" height="20" rx="10" fill="url(#kbtn)" stroke="rgba(76,196,220,.45)" stroke-width=".9"/>
    <circle cx="110" cy="332" r="2.2" fill="#d0402f"/>
    <g clip-path="url(#kclip)">
      <ellipse cx="78" cy="120" rx="46" ry="74" fill="url(#kgloss)" transform="rotate(-24 78 120)"/>
      <g transform="skewX(-18)"><rect class="glint" x="-80" y="70" width="44" height="320" fill="url(#kglint)"/></g>
    </g>
  </svg>`;
  }
  $("#gateKey").innerHTML = keySVG();

  // ----- vạch đồng hồ vòng tua -----
  (() => {
    let s = "";
    for (let i = 0; i <= 16; i++) {
      const v = i / 2, a = ((135 + (v / 8) * 270) * Math.PI) / 180, mj = i % 2 === 0;
      const r1 = mj ? 73 : 76.5, r2 = 80;
      s += `<line class="${mj ? "mj" : ""} ${v >= 6.5 ? "red" : ""}" x1="${(100 + r1 * Math.cos(a)).toFixed(2)}" y1="${(100 + r1 * Math.sin(a)).toFixed(2)}" x2="${(100 + r2 * Math.cos(a)).toFixed(2)}" y2="${(100 + r2 * Math.sin(a)).toFixed(2)}"/>`;
    }
    $("#gateTicks").innerHTML = s;
  })();
  const tfill = $("#gateFill");
  const rpmEl = $("#gateRpm");
  function setTacho(k) {                          // k = nghìn vòng/phút
    tfill.style.strokeDashoffset = (414.7 * (1 - Math.min(k, 8) / 8)).toFixed(1);
    rpmEl.textContent = k.toFixed(1);
  }

  // ----- tiếng nẹt bô lúc bấm START (assets/phu-gam/no-may.mp3, bản ghi xe thật của daily.zappa.vn: CC0). Tải và giải mã sẵn
  // bằng Web Audio để bấm là kêu ngay; không có Web Audio thì phát bằng thẻ <audio> -----
  const Engine = (() => {
    const SRC = "assets/phu-gam/no-may.mp3";
    let ctx = null, buf = null, el = null;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
    if (ctx) {
      fetch(SRC).then((r) => r.arrayBuffer()).then((d) => new Promise((ok, no) => ctx.decodeAudioData(d, ok, no))).then((b) => (buf = b)).catch(() => {});
    }
    return {
      start() {
        try {
          if (navigator.audioSession) navigator.audioSession.type = "playback";
        } catch {}
        if (ctx && buf) {
          ctx.resume();
          const g = ctx.createGain();
          g.gain.value = 1;
          g.connect(ctx.destination);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(g);
          src.start();
        } else {
          el = new Audio(SRC);
          el.play().catch(() => {});
        }
      },
    };
  })();

  // ----- tải xong thì cho nhấn START -----
  let ready = false;
  let started = false;
  function onReady() {
    if (ready) return;
    ready = true;
    startBtn.disabled = false;
    gate.classList.remove("wait");                   // tải đủ 100% rồi mới hiện chìa khóa
  }
  gate.classList.add("wait");
  startBtn.disabled = true;
  document.addEventListener("gam:fail", (e) => {
    gate.classList.remove("wait");
    hint.textContent = e.detail;
  });
  document.addEventListener("gam:ready", onReady);
  if (window.__gamReady) onReady();

  function hideGate() {
    root.classList.remove("gated");
    gate.classList.add("gone");
    setTimeout(() => gate.remove(), 1200);
  }
  async function ignite() {
    if (started || !ready) return;
    started = true;
    gate.classList.add("pressed");
    hint.textContent = "Đang khởi động…";
    Engine.start();
    setSound(true);
    if (reduce) {
      setTacho(0.9);
      document.dispatchEvent(new Event("gam:go"));
      hideGate();
      return;
    }
    root.classList.add("shake");
    gate.classList.add("lit");                       // bấm là nẹt bô luôn, không có nhịp đề máy
    await tween(0, 3.8, 380, eout, setTacho);
    await tween(3.8, 0.9, 700, eio, setTacho);
    root.classList.remove("shake");
    hint.textContent = "Sẵn sàng";
    await wait(260);
    gate.classList.add("go");
    document.dispatchEvent(new Event("gam:go"));     // màn mờ đi, cảnh 3D bắt đầu mở màn
    tween(0.9, 3.2, 500, eout, setTacho).then(() => tween(3.2, 1.2, 900, eio, setTacho));
    await wait(900);
    hideGate();
  }
  startBtn.addEventListener("click", ignite);
  $("#gateKey").addEventListener("click", ignite);
  if (!reduce) {
    gate.addEventListener("pointermove", (e) => {
      if (started) return;
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      $("#gateTilt").style.transform = `rotateY(${(x * 22).toFixed(2)}deg) rotateX(${(-y * 14).toFixed(2)}deg)`;
    });
  }
}
