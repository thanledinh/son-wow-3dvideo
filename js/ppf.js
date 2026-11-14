(() => {
  const section = document.getElementById("peel");
  const stage = section.querySelector(".stage");
  const car = document.getElementById("car");
  const pin = document.getElementById("pin");
  const diagram = document.getElementById("diagram");
  const diagramCta = document.getElementById("diagramCta");
  const progressFill = document.getElementById("progressFill");
  const hint = document.getElementById("hint");
  // Each text block carries its window on scroll progress 0..1: [fade in start, fully in, fully out, fade out end].
  const copies = [...document.querySelectorAll(".copy")].map((el) => ({
    el,
    range: el.dataset.range.split(",").map(Number),
  }));

  const IMG_W = 3840;
  const IMG_H = 2143;
  const HOOD = { x: 0.49, y: 0.4 };   // điểm trên nắp capo (tỉ lệ theo ảnh) để zoom vào và cắm ghim
  const EASE = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0.12;

  let base = { s: 1, x: 0, y: 0 };    // ảnh khi chưa zoom: tỉ lệ và góc trên-trái
  let anchor = { x: 0, y: 0 };        // vị trí capo trên màn hình, cũng là tâm zoom
  let zoomMax = 1.35;
  let target = 0;
  let current = 0;
  let last = -1;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const ramp = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const smooth = (t) => t * t * (3 - 2 * t);

  function layout() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (H > W) {
      // Điện thoại dọc: ảnh ngang rộng gấp 1.7 màn hình, capo ở nửa dưới, chừa phía trên cho sơ đồ.
      const s = (W * 1.7) / IMG_W;
      anchor = { x: W * 0.5, y: H * 0.74 };
      base = { s, x: anchor.x - HOOD.x * IMG_W * s, y: anchor.y - HOOD.y * IMG_H * s };
      zoomMax = 1.5;
    } else {
      // Desktop: phủ kín màn hình, đẩy capo sang 66% chiều ngang để đầu xe (kể cả khi đã zoom) không lấn
      // vào sơ đồ bên trái. Mép trái ảnh là nền studio tối trùng màu trang và nằm dưới lớp .shade.
      const s = Math.max(W / IMG_W, H / IMG_H);
      const x = Math.max(W * 0.66 - HOOD.x * IMG_W * s, W - IMG_W * s);
      const y = (H - IMG_H * s) / 2;
      base = { s, x, y };
      anchor = { x: x + HOOD.x * IMG_W * s, y: y + HOOD.y * IMG_H * s };
      zoomMax = 1.35;
    }
    pin.style.left = anchor.x + "px";
    pin.style.top = anchor.y + "px";
    last = -1;
  }

  function stageAlpha(p, [a, b, c, d]) {
    if (p <= a || p >= d) return 0;
    if (p < b) return (p - a) / (b - a);
    if (p <= c) return 1;
    return 1 - (p - c) / (d - c);
  }

  function render(p) {
    // Zoom quanh capo: capo đứng yên trên màn hình, phần còn lại phóng to ra.
    const z = 1 + (zoomMax - 1) * smooth(ramp(p, 0.08, 0.42));
    const tx = anchor.x + z * (base.x - anchor.x);
    const ty = anchor.y + z * (base.y - anchor.y);
    car.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${(base.s * z).toFixed(5)})`;

    pin.style.opacity = ramp(p, 0.14, 0.24).toFixed(3);
    diagram.style.setProperty("--e", smooth(ramp(p, 0.32, 0.7)).toFixed(4));
    diagramCta.style.opacity = ramp(p, 0.74, 0.84).toFixed(3);

    for (const { el, range } of copies) {
      const alpha = stageAlpha(p, range);
      const y = p < range[1] ? (1 - alpha) * 24 : p > range[2] ? -(1 - alpha) * 24 : 0;
      el.style.opacity = alpha.toFixed(3);
      el.style.setProperty("--y", y.toFixed(1) + "px");
      el.classList.toggle("is-active", alpha > 0.5);
    }
    progressFill.style.transform = `scaleX(${p.toFixed(4)})`;
    hint.style.opacity = clamp(1 - p * 14, 0, 1).toFixed(3);
  }

  function onScroll() {
    const rect = section.getBoundingClientRect();
    target = clamp(-rect.top / (rect.height - window.innerHeight), 0, 1);
  }

  function tick() {
    const delta = target - current;
    current = Math.abs(delta) < 0.00005 ? target : current + delta * EASE;
    if (Math.abs(current - last) > 0.00001) {
      render(current);
      last = current;
    }
    requestAnimationFrame(tick);
  }

  layout();
  onScroll();
  current = target;
  window.addEventListener("resize", () => { layout(); onScroll(); });
  window.addEventListener("scroll", onScroll, { passive: true });
  requestAnimationFrame(tick);
})();
