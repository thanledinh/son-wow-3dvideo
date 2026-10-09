(() => {
  const canvas = document.getElementById("frames");
  const ctx = canvas.getContext("2d");
  const section = document.getElementById("build");
  const loader = document.getElementById("loader");
  const loaderFill = document.getElementById("loaderFill");
  const loaderPct = document.getElementById("loaderPct");
  const progressFill = document.getElementById("progressFill");
  const hint = document.getElementById("hint");
  // Each text block carries its window on scroll progress 0..1: [fade in start, fully in, fully out, fade out end].
  const copies = [...document.querySelectorAll(".copy")].map((el) => ({
    el,
    range: el.dataset.range.split(",").map(Number),
  }));
  // Scroll progress -> video time (both 0..1). Each stage of the build gets an equal share of the scroll,
  // however long it lasts in the video: wheels, chassis, frame, interior, doors, panels & glass, lights, done.
  const TIMELINE = [
    [0, 0],
    [0.09, 0.07],
    [0.215, 0.28],
    [0.34, 0.48],
    [0.465, 0.62],
    [0.59, 0.705],
    [0.715, 0.8],
    [0.84, 0.89],
    [1, 1],
  ];
  // Phones get the lighter 960px frames; everything else the 1600px set.
  const FRAME_SET = window.matchMedia("(max-width: 760px)").matches ? "frames/mobile" : "frames/desktop";
  // On a portrait phone the landscape footage is shown whole; the car only spans ~30–92% of the frame width,
  // so zoom in and keep that span on screen.
  const PHONE_ZOOM = 1.45;
  const PHONE_POS_X = 0.8;
  const BG = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#07090b";
  const EASE = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0.12;
  const PARALLEL_LOADS = 6;

  let manifest;
  let images = [];
  let target = 0;
  let current = 0;
  let lastImg = null;
  let lastProgress = -1;
  let needsDraw = true;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function videoTime(p) {
    for (let k = 1; k < TIMELINE.length; k++) {
      const [s1, t1] = TIMELINE[k];
      if (p <= s1) {
        const [s0, t0] = TIMELINE[k - 1];
        return t0 + ((p - s0) / (s1 - s0)) * (t1 - t0);
      }
    }
    return 1;
  }

  function frameUrl(i) {
    return manifest.pattern.replace("{n}", String(i + 1).padStart(manifest.pad, "0"));
  }

  // Coarse-to-fine order (every 32nd frame, then every 16th, ...) so scrubbing works before everything is loaded.
  function loadOrder(count) {
    const seen = new Uint8Array(count);
    const order = [];
    for (let step = 32; step >= 1; step >>= 1) {
      for (let i = 0; i < count; i += step) {
        if (!seen[i]) { seen[i] = 1; order.push(i); }
      }
    }
    if (!seen[count - 1]) order.splice(1, 0, count - 1);
    return order;
  }

  function preload() {
    const order = loadOrder(manifest.count);
    // Reveal the page once every 8th frame is in; the rest fills in while the visitor reads the intro.
    const revealAt = Math.min(order.length, Math.ceil(manifest.count / 8));
    let next = 0;
    let done = 0;

    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = "async";
      img.onload = img.onerror = () => {
        if (img.naturalWidth) images[i] = img;
        done++;
        const pct = Math.min(100, Math.round((done / revealAt) * 100));
        loaderFill.style.width = pct + "%";
        loaderPct.textContent = pct + "%";
        if (done === revealAt) loader.classList.add("is-done");
        needsDraw = true;
        pump();
      };
      img.src = frameUrl(i);
    };
    for (let k = 0; k < PARALLEL_LOADS; k++) pump();
  }

  function nearestLoaded(i) {
    if (images[i]) return images[i];
    for (let d = 1; d < manifest.count; d++) {
      if (images[i - d]) return images[i - d];
      if (images[i + d]) return images[i + d];
    }
    return null;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    needsDraw = true;
  }

  function draw(img) {
    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const portraitView = ch > cw;
    // "auto": fill the screen, except landscape footage on a phone, which is shown whole below the headline.
    const fit = manifest.fit === "auto" ? (portraitView && iw > ih ? "contain" : "cover") : manifest.fit;
    const phone = fit === "contain" && portraitView;
    const scale = (fit === "contain" ? Math.min : Math.max)(cw / iw, ch / ih) * (phone ? PHONE_ZOOM : 1);
    const w = iw * scale;
    const h = ih * scale;
    const posX = phone ? PHONE_POS_X : manifest.posX ?? 0.5;
    const posY = phone ? 0.75 : 0.5;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - w) * posX, (ch - h) * posY, w, h);
  }

  function stageAlpha(p, [a, b, c, d]) {
    if (p <= a || p >= d) return 0;
    if (p < b) return (p - a) / (b - a);
    if (p <= c) return 1;
    return 1 - (p - c) / (d - c);
  }

  function updateCopy(p) {
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
    const max = rect.height - window.innerHeight;
    target = clamp(-rect.top / max, 0, 1);
  }

  function tick() {
    const delta = target - current;
    current = Math.abs(delta) < 0.00005 ? target : current + delta * EASE;

    const img = nearestLoaded(Math.round(videoTime(current) * (manifest.count - 1)));
    if (img && (img !== lastImg || needsDraw)) {
      draw(img);
      lastImg = img;
      needsDraw = false;
    }

    if (Math.abs(current - lastProgress) > 0.00001) {
      updateCopy(current);
      lastProgress = current;
    }
    requestAnimationFrame(tick);
  }

  fetch(FRAME_SET + "/manifest.json")
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((m) => {
      manifest = m;
      images = new Array(m.count);
      resize();
      onScroll();
      current = target;
      window.addEventListener("resize", () => { resize(); onScroll(); });
      window.addEventListener("scroll", onScroll, { passive: true });
      preload();
      requestAnimationFrame(tick);
    })
    .catch(() => {
      loaderPct.textContent = "Không đọc được " + FRAME_SET + "/manifest.json — mở trang qua web server (xem README).";
    });
})();
