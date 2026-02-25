const IMAGE_BY_SLIDE = {
  0: "start.jpg",
  1: "hold.jpg",
  4: "headset-fit.jpg",
  5: "battery-strap.jpg",
  7: "glasses.jpg",
  8: "adjust-clarity.jpg",
  9: "store.jpg"
};

const slides = Array.from(document.querySelectorAll(".slide"));
const progress = document.getElementById("progress");
const count = document.getElementById("count");
const dots = document.getElementById("dots");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const auto = document.getElementById("auto");

let i = 0;
let timer = null;
const AUTO_MS = 8000;

const hotspotIndexBySlide = new Map();
let debugMode = false;
let debugPanel = null;

function ensureDebugPanel() {
  if (debugPanel) return debugPanel;
  const panel = document.createElement("div");
  panel.className = "debug-panel";
  panel.innerHTML = "<strong>Debug mode</strong><div>Press D to toggle. Click model to sample point.</div><pre id=\"debugOut\">off</pre>";
  document.body.appendChild(panel);
  debugPanel = panel;
  return panel;
}

function setDebugMode(on) {
  debugMode = on;
  const panel = ensureDebugPanel();
  panel.classList.toggle("active", on);
  const out = panel.querySelector("#debugOut");
  if (out) out.textContent = on ? "ON\nClick model to read + place debug probe" : "off";
  if (!on) {
    document.querySelectorAll(".debug-probe.debug-active").forEach((probe) => probe.classList.remove("debug-active"));
  }
}

function writeDebug(text) {
  const panel = ensureDebugPanel();
  const out = panel.querySelector("#debugOut");
  if (out) out.textContent = text;
}

function fmtVec3(v) {
  return `${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}`;
}

function ensureDebugProbe(model) {
  let probe = model.querySelector(".debug-probe");
  if (probe) return probe;

  probe = document.createElement("button");
  probe.className = "hotspot debug-probe";
  probe.slot = "hotspot-debug-probe";
  probe.setAttribute("aria-label", "Debug probe");
  model.appendChild(probe);
  return probe;
}

function setDebugProbe(model, hit) {
  const probe = ensureDebugProbe(model);
  probe.dataset.position = fmtVec3(hit.position);
  probe.dataset.normal = fmtVec3(hit.normal);
  probe.classList.add("debug-active");
}

async function sampleDebugPoint(event, model) {
  if (!model?.positionAndNormalFromPoint) {
    writeDebug("positionAndNormalFromPoint not available");
    return;
  }

  const hit = model.positionAndNormalFromPoint(event.clientX, event.clientY);
  if (!hit) {
    writeDebug("No surface hit. Click directly on model.");
    return;
  }

  const pos = fmtVec3(hit.position);
  const normal = fmtVec3(hit.normal);
  const line = `data-position="${pos}" data-normal="${normal}"`;

  setDebugProbe(model, hit);
  writeDebug(`pos: ${pos}\nnormal: ${normal}\n${line}`);
  try {
    await navigator.clipboard.writeText(line);
  } catch {
    // Clipboard may be blocked outside secure context.
  }
}

function clearHotspotSequence() {
  document.querySelectorAll(".hotspot.is-active").forEach((h) => h.classList.remove("is-active"));
  document.querySelectorAll(".hotspot-item.is-active").forEach((h) => h.classList.remove("is-active"));
  document.querySelectorAll(".viewer3d.has-connector").forEach((v) => v.classList.remove("has-connector"));
}

function updateHotspotConnector(slide) {
  const viewer = slide.querySelector(".viewer3d");
  if (!viewer) return;

  const dot = viewer.querySelector(".hotspot.is-active");
  const label = viewer.querySelector(".hotspot-item.is-active");
  if (!dot || !label) {
    viewer.classList.remove("has-connector");
    return;
  }

  const vr = viewer.getBoundingClientRect();
  const dr = dot.getBoundingClientRect();
  const lr = label.getBoundingClientRect();

  const x1 = dr.left + (dr.width / 2) - vr.left;
  const y1 = dr.top + (dr.height / 2) - vr.top;

  const labelCenterX = lr.left + (lr.width / 2) - vr.left;
  const x2 = labelCenterX > x1 ? (lr.left - vr.left) : (lr.right - vr.left);
  const y2 = lr.top + (lr.height / 2) - vr.top;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  viewer.style.setProperty("--conn-x", `${x1}px`);
  viewer.style.setProperty("--conn-y", `${y1}px`);
  viewer.style.setProperty("--conn-len", `${len}px`);
  viewer.style.setProperty("--conn-angle", `${angle}deg`);
  viewer.classList.add("has-connector");
}

function setHotspot(slide, index) {
  const hotspots = Array.from(slide.querySelectorAll(".hotspot:not(.debug-probe)"));
  if (!hotspots.length) return;

  const normalized = ((index % hotspots.length) + hotspots.length) % hotspots.length;
  hotspots.forEach((hotspot, idx) => hotspot.classList.toggle("is-active", idx === normalized));
  hotspotIndexBySlide.set(slides.indexOf(slide), normalized);

  const activeHotspot = hotspots[normalized];
  const activeKey = activeHotspot.dataset.key;
  const fixedLabels = Array.from(slide.querySelectorAll(".hotspot-item"));
  fixedLabels.forEach((label) => label.classList.toggle("is-active", label.dataset.key === activeKey));
  activeHotspot.focus({ preventScroll: true });
  requestAnimationFrame(() => updateHotspotConnector(slide));
}

function updateHotspotSequence() {
  clearHotspotSequence();
  const activeSlide = slides[i];
  if (!activeSlide) return;

  const hotspots = Array.from(activeSlide.querySelectorAll(".hotspot:not(.debug-probe)"));
  if (!hotspots.length) return;

  const savedIndex = hotspotIndexBySlide.get(i) ?? 0;
  setHotspot(activeSlide, savedIndex);
}

function nextHotspot(slide) {
  const hotspots = Array.from(slide.querySelectorAll(".hotspot:not(.debug-probe)"));
  if (!hotspots.length) return;

  const slideIndex = slides.indexOf(slide);
  const current = hotspotIndexBySlide.get(slideIndex) ?? 0;
  setHotspot(slide, current + 1);
}

function initHotspotClickHandlers() {
  document.querySelectorAll(".viewer3d").forEach((viewer) => {
    viewer.addEventListener("click", (e) => {
      const slide = viewer.closest(".slide");
      if (!slide || !slide.classList.contains("active")) return;
      const model = viewer.querySelector("model-viewer.viewer-canvas");

      if (debugMode && model && (e.target === model || model.contains(e.target))) {
        e.stopPropagation();
        sampleDebugPoint(e, model);
        return;
      }

      e.stopPropagation();
      nextHotspot(slide);
    });
  });
}

function initHotspotTracking() {
  document.querySelectorAll("model-viewer.viewer-canvas").forEach((model) => {
    const refresh = () => {
      const slide = model.closest(".slide");
      if (slide && slide.classList.contains("active")) updateHotspotConnector(slide);
    };
    model.addEventListener("camera-change", refresh);
    model.addEventListener("load", refresh);
  });

  window.addEventListener("resize", () => {
    const activeSlide = slides[i];
    if (activeSlide) updateHotspotConnector(activeSlide);
  });
}

function applySlideImages() {
  slides.forEach((slide, idx) => {
    const box = slide.querySelector(".img");
    if (!box) return;

    const file = IMAGE_BY_SLIDE[idx];
    const img = box.querySelector(".slide-photo");
    if (!file || !img) return;

    img.src = `img/${file}`;
    img.onload = () => box.classList.add("has-image");
    img.onerror = () => box.classList.remove("has-image");
  });
}

function buildDots() {
  dots.innerHTML = "";
  slides.forEach((_, idx) => {
    const b = document.createElement("button");
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      go(idx);
    });
    dots.appendChild(b);
  });
}

function render() {
  slides.forEach((s, idx) => s.classList.toggle("active", idx === i));
  progress.style.width = `${((i + 1) / slides.length) * 100}%`;
  count.textContent = `${i + 1} / ${slides.length}`;
  Array.from(dots.children).forEach((b, idx) => b.classList.toggle("active", idx === i));
  document.title = `Quest 3 - ${slides[i].dataset.title || i + 1}`;
  updateHotspotSequence();
}

function go(idx) {
  i = (idx + slides.length) % slides.length;
  render();
}

const next = () => go(i + 1);
const prev = () => go(i - 1);

function setAuto(on) {
  if (on) {
    timer = setInterval(next, AUTO_MS);
  } else {
    clearInterval(timer);
    timer = null;
  }
}

prevBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  prev();
});

nextBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  next();
});

document.addEventListener("click", (e) => {
  if (e.target.closest("button") || e.target.closest("label") || e.target.closest("input") || e.target.closest(".viewer3d")) return;
  next();
});

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "d") {
    e.preventDefault();
    setDebugMode(!debugMode);
    return;
  }
  if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
    e.preventDefault();
    next();
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prev();
  }
  if (e.key.toLowerCase() === "f") {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});

auto.addEventListener("change", () => setAuto(auto.checked));

applySlideImages();
initHotspotClickHandlers();
initHotspotTracking();
ensureDebugPanel();
buildDots();
render();
