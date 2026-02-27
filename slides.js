const IMAGE_BY_SLIDE = {
  0: "Quest-3-With-Controllers.webp",
  4: "Quest-3-Elite-Strap-with-Battery.webp"
};

const IMAGE_SEQUENCE_BY_SLIDE = {
  7: [
    {
      file: "Menu Bar.jpg",
      alt: "Quest menu bar",
      bullets: [
        "Press the Meta button",
        "Confirm the menu bar is visible",
        "Get ready to select Library"
      ]
    },
    {
      file: "Library 02.jpg",
      alt: "Controller selecting Library icon",
      bullets: [
        "Point at the Library icon",
        "Select the Library icon",
        "Wait for Library to open"
      ]
    },
    {
      file: "Library 03.jpg",
      alt: "Quest Library open",
      bullets: [
        "Library is now open",
        "Find the app you need",
        "Select the app to launch"
      ]
    }
  ]
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
const imageSequenceIndexBySlide = new Map();
const stableCameraByModel = new WeakMap();
let debugMode = false;
let debugPanel = null;
const slideSlugs = slides.map((slide, idx) => slugify(slide.dataset.title || `${idx + 1}`));

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getUrlSlideHash(index) {
  const slug = slideSlugs[index] || `${index + 1}`;
  return `#${index + 1}-${slug}`;
}

function parseSlideHash(hash) {
  const raw = decodeURIComponent((hash || "").replace(/^#/, "").trim().toLowerCase());
  if (!raw) return null;

  const numeric = raw.match(/^\d+$/);
  if (numeric) return Number(raw) - 1;

  const withPrefix = raw.match(/^slide-(\d+)$/);
  if (withPrefix) return Number(withPrefix[1]) - 1;

  const numericWithSlug = raw.match(/^(\d+)-/);
  if (numericWithSlug) return Number(numericWithSlug[1]) - 1;

  return slideSlugs.indexOf(raw);
}

function syncUrlToSlide(index) {
  const nextHash = getUrlSlideHash(index);
  if (window.location.hash === nextHash) return;
  history.replaceState(null, "", nextHash);
}

function ensureDebugPanel() {
  if (debugPanel) return debugPanel;
  const panel = document.createElement("div");
  panel.className = "debug-panel";
  panel.innerHTML = "<strong>Debug mode</strong><div>Press D to toggle. Click model to sample point. Press C to capture hotspot view.</div><pre id=\"debugOut\">off</pre>";
  document.body.appendChild(panel);
  debugPanel = panel;
  return panel;
}

function setDebugMode(on) {
  debugMode = on;
  const panel = ensureDebugPanel();
  panel.classList.toggle("active", on);
  const out = panel.querySelector("#debugOut");
  if (out) out.textContent = on ? "ON\nClick model to read + place debug probe\nPress C to capture camera orbit/target for active hotspot" : "off";
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

function normalizeCameraValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  const asString = String(value).trim();
  return asString.startsWith("[object") ? "" : asString;
}

function getCurrentCameraOrbit(model) {
  const fromProperty = normalizeCameraValue(model?.cameraOrbit);
  if (fromProperty) return fromProperty;
  return normalizeCameraValue(model?.getAttribute?.("camera-orbit"));
}

function getCurrentCameraTarget(model) {
  const fromProperty = normalizeCameraValue(model?.cameraTarget);
  if (fromProperty) return fromProperty;
  return normalizeCameraValue(model?.getAttribute?.("camera-target"));
}

function parseVec3(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function parseAngleDeg(token) {
  if (!token) return NaN;
  const t = String(token).trim().toLowerCase();
  if (t.endsWith("rad")) {
    const rad = Number.parseFloat(t.slice(0, -3));
    return Number.isFinite(rad) ? (rad * 180) / Math.PI : NaN;
  }
  const cleaned = t.endsWith("deg") ? t.slice(0, -3) : t;
  const deg = Number.parseFloat(cleaned);
  return Number.isFinite(deg) ? deg : NaN;
}

function getCurrentOrbitParts(model) {
  const orbit = getCurrentCameraOrbit(model);
  const parts = orbit.split(/\s+/);
  return {
    theta: parts[0] || "0deg",
    phi: parts[1] || "160deg",
    radius: parts[2] || "84%"
  };
}

function getStableCameraState(model) {
  let state = stableCameraByModel.get(model);
  if (state) return state;

  const orbit = getCurrentOrbitParts(model);
  state = {
    phi: orbit.phi,
    radius: orbit.radius,
    target: getCurrentCameraTarget(model) || "0m 0m 0m"
  };
  stableCameraByModel.set(model, state);
  return state;
}

function closestThetaDeg(targetDeg, currentDeg) {
  let theta = targetDeg;
  while (theta - currentDeg > 180) theta -= 360;
  while (theta - currentDeg < -180) theta += 360;
  return theta;
}

function normalizeOrbitForSmooth(orbit, model, fallback) {
  const parts = String(orbit || "").trim().split(/\s+/);
  if (parts.length < 1) return "";

  const currentThetaDeg = parseAngleDeg(getCurrentOrbitParts(model).theta);
  const rawThetaDeg = parseAngleDeg(parts[0]);
  const thetaDeg = Number.isFinite(rawThetaDeg) && Number.isFinite(currentThetaDeg)
    ? closestThetaDeg(rawThetaDeg, currentThetaDeg)
    : rawThetaDeg;

  const phi = parts[1] || fallback.phi;
  const radius = parts[2] || fallback.radius;
  const theta = Number.isFinite(thetaDeg) ? `${thetaDeg.toFixed(1)}deg` : (parts[0] || "0deg");
  return `${theta} ${phi} ${radius}`;
}

function deriveHotspotView(hotspot, model) {
  const normal = parseVec3(hotspot?.dataset?.normal);
  if (!normal) return null;

  const normalLen = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(normalLen) || normalLen <= 0) return null;

  const nx = normal.x / normalLen;
  const nz = normal.z / normalLen;
  const stable = getStableCameraState(model);
  const currentThetaDeg = parseAngleDeg(getCurrentOrbitParts(model).theta);

  const thetaDeg = (Math.atan2(nx, nz) * 180) / Math.PI;
  const smoothTheta = Number.isFinite(currentThetaDeg)
    ? closestThetaDeg(thetaDeg, currentThetaDeg)
    : thetaDeg;

  return {
    target: stable.target,
    orbit: `${smoothTheta.toFixed(1)}deg ${stable.phi} ${stable.radius}`
  };
}

function applyHotspotView(slide, hotspot) {
  const model = slide.querySelector("model-viewer.viewer-canvas");
  if (!model || !model.loaded || !hotspot) return;
  const stable = getStableCameraState(model);

  let orbit = hotspot.dataset.orbit;
  let target = hotspot.dataset.target || stable.target;
  if (!orbit) {
    const derived = deriveHotspotView(hotspot, model);
    if (derived) orbit = derived.orbit;
  } else {
    orbit = normalizeOrbitForSmooth(orbit, model, stable);
  }

  if (target) model.cameraTarget = target;
  if (orbit) model.cameraOrbit = orbit;
}

async function captureActiveHotspotView() {
  const activeSlide = slides[i];
  if (!activeSlide) {
    writeDebug("No active slide.");
    return;
  }

  const model = activeSlide.querySelector("model-viewer.viewer-canvas");
  const hotspot = activeSlide.querySelector(".hotspot.is-active:not(.debug-probe)");
  if (!model || !hotspot) {
    writeDebug("No active hotspot/model on this slide.");
    return;
  }

  const orbit = getCurrentCameraOrbit(model);
  const target = getCurrentCameraTarget(model);
  if (!orbit || !target) {
    writeDebug("Orbit/target unavailable. Move camera, then press C.");
    return;
  }

  hotspot.dataset.orbit = orbit;
  hotspot.dataset.target = target;
  const line = `data-orbit="${orbit}" data-target="${target}"`;
  const key = hotspot.dataset.key || "hotspot";
  writeDebug(`Saved view for ${key}\n${line}\n(copied to clipboard)`);
  try {
    await navigator.clipboard.writeText(line);
  } catch {
    // Clipboard may be blocked outside secure context.
  }
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
  const model = viewer.querySelector("model-viewer.viewer-canvas");
  if (!model || !model.loaded) {
    viewer.classList.remove("has-connector");
    return;
  }

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
  const dotWithinViewer = x1 >= 0 && x1 <= vr.width && y1 >= 0 && y1 <= vr.height;
  if (!dotWithinViewer) {
    viewer.classList.remove("has-connector");
    return;
  }

  const fixedGroup = label.closest(".hotspot-fixed");
  const isBottomLayout = fixedGroup?.classList.contains("hotspot-fixed-bottom");

  let x2;
  let y2;
  if (isBottomLayout) {
    x2 = lr.left + (lr.width / 2) - vr.left;
    y2 = lr.top - vr.top;
  } else {
    const labelCenterX = lr.left + (lr.width / 2) - vr.left;
    x2 = labelCenterX > x1 ? (lr.left - vr.left) : (lr.right - vr.left);
    y2 = lr.top + (lr.height / 2) - vr.top;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 0) {
    viewer.classList.remove("has-connector");
    return;
  }
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
  const descriptions = Array.from(slide.querySelectorAll(".hotspot-desc"));
  descriptions.forEach((desc) => desc.classList.toggle("is-active", desc.dataset.key === activeKey));
  applyHotspotView(slide, activeHotspot);
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

function advanceHotspotOrSlide() {
  const activeSlide = slides[i];
  if (!activeSlide) {
    next();
    return;
  }

  const slideIndex = slides.indexOf(activeSlide);

  const hotspots = Array.from(activeSlide.querySelectorAll(".hotspot:not(.debug-probe)"));
  if (!hotspots.length) {
    const sequence = IMAGE_SEQUENCE_BY_SLIDE[slideIndex];
    if (!sequence?.length) {
      next();
      return;
    }

    const currentStep = imageSequenceIndexBySlide.get(slideIndex) ?? 0;
    if (currentStep < sequence.length - 1) {
      applyImageSequenceStep(activeSlide, slideIndex, currentStep + 1);
      return;
    }

    next();
    return;
  }

  const current = hotspotIndexBySlide.get(slideIndex) ?? 0;
  if (current < hotspots.length - 1) {
    setHotspot(activeSlide, current + 1);
    return;
  }

  next();
}

function initHotspotClickHandlers() {
  document.querySelectorAll(".viewer3d").forEach((viewer) => {
    let pointerStartX = 0;
    let pointerStartY = 0;
    let dragged = false;
    const DRAG_THRESHOLD_PX = 8;

    viewer.addEventListener("pointerdown", (e) => {
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      dragged = false;
    });

    viewer.addEventListener("pointermove", (e) => {
      if (dragged) return;
      const dx = Math.abs(e.clientX - pointerStartX);
      const dy = Math.abs(e.clientY - pointerStartY);
      if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) dragged = true;
    });

    viewer.addEventListener("click", (e) => {
      const slide = viewer.closest(".slide");
      if (!slide || !slide.classList.contains("active")) return;
      const model = viewer.querySelector("model-viewer.viewer-canvas");
      if (dragged) {
        dragged = false;
        return;
      }

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

    box.classList.add("has-image");
    img.onload = () => box.classList.add("has-image");
    img.onerror = () => box.classList.remove("has-image");
    img.src = `img/${file}`;
    if (img.complete && img.naturalWidth > 0) box.classList.add("has-image");
  });
}

function applyImageSequenceStep(slide, slideIndex, stepIndex) {
  const sequence = IMAGE_SEQUENCE_BY_SLIDE[slideIndex];
  if (!sequence?.length) return;

  const normalized = ((stepIndex % sequence.length) + sequence.length) % sequence.length;
  const step = sequence[normalized];

  const box = slide.querySelector(".img");
  const img = box?.querySelector(".slide-photo");
  const list = slide.querySelector(".panel .list");
  if (!box || !img || !list) return;

  imageSequenceIndexBySlide.set(slideIndex, normalized);
  box.classList.add("has-image");
  img.src = `img/${step.file}`;
  img.alt = step.alt;

  list.innerHTML = "";
  step.bullets.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
}

function initImageSequenceSlides() {
  Object.keys(IMAGE_SEQUENCE_BY_SLIDE).forEach((key) => {
    const slideIndex = Number(key);
    const slide = slides[slideIndex];
    if (!slide) return;

    const box = slide.querySelector(".img");
    if (!box) return;

    applyImageSequenceStep(slide, slideIndex, imageSequenceIndexBySlide.get(slideIndex) ?? 0);

    box.addEventListener("click", (e) => {
      if (!slide.classList.contains("active")) return;
      e.stopPropagation();
      const current = imageSequenceIndexBySlide.get(slideIndex) ?? 0;
      applyImageSequenceStep(slide, slideIndex, current + 1);
    });
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
  syncUrlToSlide(i);
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
  advanceHotspotOrSlide();
});

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "d") {
    e.preventDefault();
    setDebugMode(!debugMode);
    return;
  }
  if (debugMode && e.key.toLowerCase() === "c") {
    e.preventDefault();
    captureActiveHotspotView();
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

window.addEventListener("hashchange", () => {
  const target = parseSlideHash(window.location.hash);
  if (target == null || Number.isNaN(target)) return;
  go(target);
});

applySlideImages();
initImageSequenceSlides();
initHotspotClickHandlers();
initHotspotTracking();
ensureDebugPanel();
buildDots();
const initialHashSlide = parseSlideHash(window.location.hash);
if (initialHashSlide != null && !Number.isNaN(initialHashSlide)) {
  i = (initialHashSlide + slides.length) % slides.length;
}
render();
