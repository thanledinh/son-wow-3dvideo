// Phần thông tin dưới cảnh 3D, theo kiểu daily.zappa.vn nhưng đổi trang bằng cầu nâng thay cho xe kéo bảng:
// - Sân khấu: poster của các chặng (.page[data-stop]) được gom thành từng trang trọn màn hình (.deck). Máy tính: cả
//   chặng (tối đa ba tấm) một trang. Điện thoại: mỗi tấm một trang. Cuộn hết đoạn của một trang thì cầu nâng của nó kéo
//   trang lùi vào trong, cùng lúc cầu nâng của trang kế đẩy trang đó từ dưới lên.
// - Thanh lộ trình ở đáy: mỗi chặng một chấm, chiếc xe chạy theo vị trí cuộn, bấm chấm để tới chặng đó.
const root = document.documentElement;
const SEG = 130;       // một trang giữ bao nhiêu vh cuộn
const HOLD = 0.45;     // phần đầu của đoạn đó trang đứng yên; phần còn lại là lúc đổi trang
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * x * (x * (x * 6 - 15) + 10);

const boards = document.querySelector(".boards");
const chapters = [...boards.querySelectorAll(".page")].map((el) => ({ el, imgs: [...el.querySelectorAll(".poster")], first: 0, last: 0 }));
const wide = matchMedia("(min-width: 1000px)");

// Tấm đầu (poster-cao-cap.mp4) là đoạn phim ngắn không tiếng, chạy MỘT lần rồi dừng ở khung cuối; mỗi lần lướt tới lại
// thì tua về đầu và chạy lại. (Trước đây là ảnh WebP động cắt còn 10 hình/giây cho nhẹ; người dùng: nhìn lag quá. Phim
// giữ đủ 24 hình/giây của bản gốc mà nhẹ bằng nửa.)
const hero = chapters[0]?.imgs[0];
let heroSeen = false;
let heroReady = false;
// (người dùng: sếp kêu cái gif tải chậm.) Phim 0,9 MB trước đây chỉ bắt đầu tải khi lướt tới gần, mạng chậm là tới nơi
// vẫn chưa có hình. Giờ tải sẵn cả file ngay khi cảnh 3D tải xong (lúc người xem còn ở màn START và đoạn 3D), giữ trong bộ
// nhớ; tới nơi là phát ngay. Tải sẵn hỏng thì quay về cách cũ: gán thẳng địa chỉ file.
let heroBlob = null;
function preloadHero() {
  if (!hero || heroBlob || heroReady) return;
  heroBlob = fetch(hero.dataset.src)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
    .then((b) => URL.createObjectURL(b))
    .catch(() => null);
}
for (const ev of ["gam:ready", "gam:fail"]) document.addEventListener(ev, preloadHero, { once: true });
function fetchHero() {
  if (!hero || heroReady) return;
  heroReady = true;
  hero.dataset.loaded = "1";
  (heroBlob || Promise.resolve(null)).then((url) => {
    hero.src = url || hero.dataset.src;
    replayHero();
  });
}
function replayHero() {
  if (!hero || !heroReady) return;
  try { hero.currentTime = 0; } catch { /* chưa có dữ liệu: cứ phát từ đầu */ }
  hero.play?.().catch(() => {});        // (tắt tiếng + playsinline nên trình duyệt cho tự phát)
}
const track = document.createElement("div");
track.className = "deck-track";
const stage = document.createElement("div");
stage.className = "deck-stage";
track.appendChild(stage);
boards.prepend(track);
root.classList.add("pg-js");

let decks = [];
let coat = null;
let ctx = null;
function build() {
  stage.innerHTML = '<canvas class="deck-coat" aria-hidden="true"></canvas>';
  coat = stage.firstChild;
  ctx = coat.getContext("2d");
  decks = [];
  for (const ch of chapters) {
    const groups = wide.matches ? [ch.imgs] : ch.imgs.map((img) => [img]);
    ch.first = decks.length;
    for (const group of groups) {
      const deck = document.createElement("section");
      deck.className = "deck";
      deck.setAttribute("aria-label", ch.el.getAttribute("aria-label") || ch.el.dataset.stop);
      deck.innerHTML = `<div class="lift" style="--n:${group.length}"><div class="deck-row"></div></div>`;
      const row = deck.querySelector(".deck-row");
      for (const img of group) {
        // poster chưa tới lượt thì chưa tải (bớt ~6 MB lúc mở trang): giữ địa chỉ trong data-src, hàm warm() gán lại khi sắp tới.
        // (bỏ src TRƯỚC khi đụng tới loading: đặt loading="eager" lúc còn src là trình duyệt tải ngay)
        if (!img.dataset.src) img.dataset.src = img.getAttribute("src");
        if (!img.dataset.loaded) img.removeAttribute("src");
        row.appendChild(img);
      }
      stage.appendChild(deck);
      decks.push(deck);
    }
    ch.last = decks.length - 1;
  }
  track.style.height = `calc(${decks.length * SEG}vh + 100vh)`;
}

// Đoạn cuộn của sân khấu, tính bằng px.
function span() {
  const r = track.getBoundingClientRect();
  const range = Math.max(1, r.height - stage.offsetHeight);
  return { top: r.top, range, seg: range / decks.length };
}

// ----- vệt phun -----
// Cây súng phun GB chụp từ mô hình 3D của trang, nền trong suốt, hai góc nhìn (vòi hướng sang trái): a = nhìn chéo thấy nhãn
// lon, b = nhìn từ trên xuống, lon rủ xuống. Súng chuyển dần giữa hai góc theo hướng đi, kèm nghiêng theo hướng đi.
const GUNS = [
  { src: "assets/phu-gam/info/spray-gun-a.webp", w: 790, tipY: 28 },
  { src: "assets/phu-gam/info/spray-gun-b.webp", w: 815, tipY: 59 },
].map((g) => Object.assign(g, { img: Object.assign(new Image(), { src: g.src }) }));
const ROWS = 72;
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const wob = (y, a, b, c) => Math.sin(y * a + 1.3) * 0.5 + Math.sin(y * b + 4.1) * 0.3 + Math.sin(y * c + 2.2) * 0.2;
// hạt li ti của lớp phủ, lát thành họa tiết
const grain = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 192;
  const g = c.getContext("2d");
  for (let i = 0; i < 1500; i++) {
    const light = hash(i) > 0.35;
    g.fillStyle = light ? `rgba(190,205,212,${0.05 + hash(i + 3) * 0.16})` : `rgba(0,0,0,${0.2 + hash(i + 5) * 0.3})`;
    const r = 0.5 + hash(i + 9) * (light ? 1.5 : 2.2);
    g.beginPath();
    g.arc(hash(i + 1) * 192, hash(i + 2) * 192, r, 0, 6.283);
    g.fill();
  }
  return c;
})();

function paintSpray(t, k) {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const on = t > 0 && t < 1;
  root.classList.toggle("pg-spray", on);
  decks.forEach((deck, i) => {
    const leaving = i === k;
    const coming = i === k + 1 && t > 0;
    deck.classList.toggle("on", leaving || coming);
    if (!on) deck.style.clipPath = "";
  });
  if (!on) return;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  if (coat.width !== Math.round(W * dpr) || coat.height !== Math.round(H * dpr)) {
    coat.width = Math.round(W * dpr);
    coat.height = Math.round(H * dpr);
  }
  const bandW = W * (wide.matches ? 0.26 : 0.46);
  const lx = -90 + ease(t) * (W + bandW + 180);                 // mép đầu của vệt, trung bình
  const gunY = H * (0.5 + 0.34 * Math.sin(t * 6.283 * 2.25));   // súng đi lên xuống như đang phun từng hàng
  const L = [];
  const T = [];
  for (let r = 0; r < ROWS; r++) {
    const y = (r / (ROWS - 1)) * H;
    const bulge = 70 * Math.exp(-(((y - gunY) / (H * 0.13)) ** 2));      // lớp phủ dày ra, nhô tới trước chỗ vòi đang phun
    const head = lx + 24 * wob(y, 0.017, 0.043, 0.11) + (hash(r) - 0.5) * 9 + bulge;
    const tail = lx - bandW + 42 * wob(y, 0.012, 0.031, 0.09) + (hash(r + 99) - 0.5) * 16;
    L.push([head, y]);
    T.push([Math.min(tail, head - 36), y]);
  }
  // trang cũ: bên phải mép đầu; trang mới: bên trái mép đuôi
  const pt = (p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`;
  const oldClip = `polygon(${W}px 0, ${W}px ${H}px, ${L.slice().reverse().map(pt).join(",")})`;
  const newClip = `polygon(0 0, ${T.map(pt).join(",")}, 0 ${H}px)`;
  decks.forEach((deck, i) => {
    if (i === k) deck.style.clipPath = oldClip;
    else if (i === k + 1) deck.style.clipPath = newClip;
  });

  const c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  // lớp phủ giữa hai mép
  c.save();
  c.beginPath();
  L.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  for (let i = ROWS - 1; i >= 0; i--) c.lineTo(T[i][0], T[i][1]);
  c.closePath();
  const fill = c.createLinearGradient(lx - bandW, 0, lx + 40, 0);
  fill.addColorStop(0, "#090b0d");
  fill.addColorStop(0.55, "#0c0f12");
  fill.addColorStop(0.92, "#161b1f");
  fill.addColorStop(1, "#1b2227");
  c.fillStyle = fill;
  c.fill();
  c.clip();
  c.globalAlpha = 0.9;
  c.fillStyle = c.createPattern(grain, "repeat");
  c.fill();
  c.globalAlpha = 1;
  const sheen = c.createLinearGradient(lx - bandW * 0.8, 0, lx - bandW * 0.1, 0);       // vệt sáng bóng trên mặt ướt
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(190,226,236,0.07)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = sheen;
  c.fillRect(0, 0, W, H);
  c.restore();
  // mép đầu ướt, bóng
  c.save();
  c.lineJoin = "round";
  c.beginPath();
  L.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.strokeStyle = "rgba(205,238,246,0.5)";
  c.lineWidth = 2;
  c.shadowColor = "rgba(143,224,240,0.7)";
  c.shadowBlur = 12;
  c.stroke();
  c.restore();
  // mép đuôi
  c.beginPath();
  T.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.strokeStyle = "rgba(255,255,255,0.09)";
  c.lineWidth = 1;
  c.stroke();
  // giọt li ti bắn ra trước mép đầu
  for (let j = 0; j < 80; j++) {
    const y = hash(j) * H;
    const row = Math.min(ROWS - 1, Math.round((y / H) * (ROWS - 1)));
    const ahead = hash(j + 50) ** 2 * 80;
    const a = 0.6 * (1 - ahead / 80);
    const x = L[row][0] + 4 + ahead;
    const r = 0.8 + hash(j + 7) * 2.4;
    c.fillStyle = `rgba(9,11,13,${a})`;
    c.beginPath();
    c.arc(x, y, r, 0, 6.283);
    c.fill();
    c.fillStyle = `rgba(205,238,246,${a * 0.55})`;
    c.beginPath();
    c.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, 6.283);
    c.fill();
  }
  // vòi súng ở mép đầu, ngay hàng đang phun
  const gRow = Math.min(ROWS - 1, Math.max(0, Math.round((gunY / H) * (ROWS - 1))));
  const gx = L[gRow][0] + 10;
  const reach = wide.matches ? 230 : 150;
  for (let j = 0; j < 120; j++) {
    const d = hash(j) ** 1.3 * reach;
    const ang = (hash(j + 7) - 0.5) * 0.6;
    const a = 0.2 * (1 - d / reach) ** 1.4;
    c.fillStyle = `rgba(176,190,197,${a})`;
    c.beginPath();
    c.arc(gx + Math.cos(ang) * d, gunY + Math.sin(ang) * d, 3 + d * 0.11, 0, 6.283);
    c.fill();
  }
  const ph = t * 6.283 * 2.25;
  const down = 0.5 + 0.5 * Math.cos(ph);                         // 1 khi súng đang đi xuống, 0 khi đi lên
  const size = wide.matches ? 330 : 220;
  c.save();
  c.translate(gx, gunY);
  c.rotate(0.3 * Math.cos(ph));                                  // vòi chúc xuống khi đi xuống, ngẩng lên khi đi lên
  c.shadowColor = "rgba(0,0,0,0.6)";
  c.shadowBlur = 22;
  GUNS.forEach((g, i) => {
    if (!(g.img.complete && g.img.naturalWidth)) return;
    const k = size / g.w;
    c.save();
    c.globalAlpha = i ? down : 1 - down;
    c.scale(-k, k);
    c.drawImage(g.img, 0, -g.tipY);
    c.restore();
  });
  c.restore();
}

// Tải poster của trang i khi sắp tới lượt (xem build(): ban đầu các poster chưa có src).
function warm(i) {
  const deck = decks[i];
  if (!deck) return;
  for (const img of deck.querySelectorAll(".poster")) {
    if (img === hero) continue;                  // tấm đầu tải qua fetchHero()
    if (img.getAttribute("src")) continue;
    img.loading = "eager";
    img.src = img.dataset.src;
    img.dataset.loaded = "1";
  }
  if (i === 0) fetchHero();
}

function turn() {
  const { top, range, seg } = span();
  const stageOn = top < innerHeight * 0.5 && top > -range - innerHeight * 0.5;
  if (top < innerHeight * 3) {                       // còn cách sân khấu ~3 màn hình: bắt đầu tải hai trang đầu
    warm(0);
    warm(1);
  }
  root.classList.toggle("pg-stage", stageOn);
  const u = Math.min(range - 0.01, Math.max(0, -top)) / seg;
  const k = Math.floor(u);
  if (stageOn) for (let i = k; i <= k + 2; i++) warm(i);    // trang đang xem và hai trang kế
  // tấm đầu là ảnh động chạy một lần: mỗi lần lướt tới lại thì cho chạy lại từ đầu
  const heroNow = stageOn && k === 0 && u - k < 0.35;
  if (heroNow && !heroSeen) replayHero();
  heroSeen = heroNow;
  // t: 0 → 1 trong lúc đổi trang, vệt phun quét từ trái sang phải.
  const t = k < decks.length - 1 ? clamp01((u - k - HOLD) / (1 - HOLD)) : 0;
  paintSpray(t, k);
}

// ----- thanh lộ trình -----
const route = document.querySelector(".route");
const line = document.getElementById("routeLine");
const now = document.getElementById("routeNow");
const legs = [...document.querySelectorAll("[data-stop]")].map((el) => ({ el, chapter: chapters.find((c) => c.el === el) }));

// Vị trí cuộn mà ở đó chặng bắt đầu.
function startOf(leg) {
  if (!leg.chapter) return leg.el.getBoundingClientRect().top + scrollY;
  const { top, seg } = span();
  return top + scrollY + leg.chapter.first * seg;
}
function goTo(leg) {
  const y = startOf(leg) + (leg.chapter ? 2 : 0);
  letFree();
  scrollTo({ top: y, behavior: "smooth" });
}

const stops = legs.map((leg, i) => {
  const a = document.createElement("a");
  a.className = "stop";
  a.href = `#${leg.el.id}`;
  a.style.setProperty("--x", legs.length > 1 ? i / (legs.length - 1) : 0);
  a.innerHTML = `<b></b><span>${leg.el.dataset.stop}</span>`;
  line.appendChild(a);
  return a;
});
// Chấm lộ trình và các link #chặng trong menu: chặng poster không còn nằm trong dòng trang nên phải tự cuộn tới.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const leg = legs.find((l) => `#${l.el.id}` === a.getAttribute("href"));
  if (!leg) return;
  e.preventDefault();
  goTo(leg);
});

let current = -1;
function place() {
  // chặng thường đổi khi mép trên của nó qua giữa màn hình; chặng poster đổi đúng lúc trang của nó lên hết
  const y = scrollY;
  const starts = legs.map((leg) => startOf(leg) - (leg.chapter ? 0 : innerHeight * 0.5));
  let i = 0;
  starts.forEach((s, k) => {
    if (s <= y + 1) i = k;
  });
  const last = legs.length - 1;
  const within = i < last ? clamp01((y - starts[i]) / Math.max(1, starts[i + 1] - starts[i])) : 0;
  route.style.setProperty("--p", (last > 0 ? (i + within) / last : 0).toFixed(4));
  if (i !== current) {
    current = i;
    stops.forEach((s, k) => s.classList.toggle("on", k === i));
    now.textContent = legs[i].el.dataset.stop;
  }
}

// ----- hãm -----
// (người dùng: lướt mạnh là nó bay quá đà, thêm cái hãm lại.) Mỗi lần lướt chỉ qua được MỘT trang poster: vị trí cuộn bị
// chặn ở chỗ trang kế vừa lên hết (lướt mạnh tới đâu thì vệt phun cũng quét xong rồi dừng ở trang kế). Chốt chặn nhả khi
// cuộn đã dừng (IDLE), hoặc sau khi giữ HOLD_MS (để người lăn chuột liên tục không bị kẹt), rồi dời sang trang kế tiếp.
// Bấm chấm lộ trình / menu và phím Home, End thì không hãm.
const IDLE = 140;
const HOLD_MS = 450;
let restY = scrollY;      // vị trí lúc bắt đầu lần lướt này
let lo = -Infinity;
let hi = Infinity;
let armed = false;
let free = false;
let heldAt = 0;
let idleTimer = 0;
function limits() {
  const { top, seg } = span();
  const base = top + scrollY;
  lo = -Infinity;
  hi = Infinity;
  for (let i = 0; i < decks.length; i++) {
    const r = Math.round(base + i * seg);
    if (r < restY - 4) lo = r;
    else if (r > restY + 4 && hi === Infinity) hi = r;
  }
}
function settle() {
  armed = false;
  free = false;
  heldAt = 0;
  restY = scrollY;
}
function letFree() {
  free = true;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(settle, 400);
}
function brake() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(settle, free ? 400 : IDLE);
  if (free) return;
  if (!armed) {
    armed = true;
    limits();
  }
  const y = scrollY;
  const to = y > hi ? hi : y < lo ? lo : null;
  if (to === null) return;
  const t = performance.now();
  if (!heldAt) heldAt = t;
  if (t - heldAt > HOLD_MS) {          // giữ đủ lâu mà vẫn còn cuộn: cho đi tiếp, chốt dời sang trang kế
    heldAt = 0;
    restY = to;
    limits();
    return;
  }
  scrollTo({ top: to, behavior: "instant" });
}
addEventListener("keydown", (e) => {
  if (e.key === "Home" || e.key === "End") letFree();
});

let queued = false;
function onScroll() {
  brake();
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    turn();
    place();
  });
}
build();
wide.addEventListener("change", () => {
  build();
  onScroll();
});
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
turn();
place();
route.classList.add("is-on");
