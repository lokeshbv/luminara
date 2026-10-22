// TV launcher. Arrow keys and Enter come from the remote (as real key events via
// CDP) or from a USB keyboard; both take the same path below. The screensaver and
// on-screen messages live in web/inject/overlay.js, which runs on every page.
"use strict";

const $ = (id) => document.getElementById(id);

let allServices = [];
let services = [];          // visible ones (Settings can hide apps)
let state = { recent: {}, remotes: 0, settings: {}, update: {} };
let selected = "";          // focused service id
let focusArea = "tiles";    // "tiles" | "update"
let updateBtn = 0;          // 0 = Install, 1 = Later
let ws = null;

// ---- artwork (logo files are cached by the server; fall back to the glyph) ----

function art(service, kind) {
  const style = service[kind];
  if (!style) return glyph(service);
  const img = new Image();
  img.src = `/logos/${encodeURIComponent(service.id)}/${kind}?v=${style.v}`;
  img.alt = service.name;
  if (style.filter === "white") img.className = "white";
  img.onerror = () => img.replaceWith(glyph(service));
  return img;
}

function glyph(service) {
  const span = document.createElement("span");
  span.className = "glyph";
  span.textContent = service.glyph;
  return span;
}

// ---- tiles & hero ------------------------------------------------------------

function render() {
  const hidden = new Set(state.settings?.hidden_apps || []);
  services = allServices.filter((s) => !hidden.has(s.id));
  if (selected !== "@settings" && !services.some((s) => s.id === selected)) {
    // The focused app was hidden: move focus and tell the remotes.
    selected = services[0]?.id || "";
    if (selected && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "select", id: selected }));
  }
  $("tiles").style.setProperty("--cols", String(Math.min(Math.max(services.length + 1, 1), 5)));
  const tiles = services.map((s) => {
    const li = document.createElement("li");
    li.className = "tile";
    li.setAttribute("role", "option");
    li.setAttribute("aria-label", s.name);
    li.style.setProperty("--tile", s.tile);
    li.style.setProperty("--c", s.color);
    li.dataset.id = s.id;
    const shade = document.createElement("span");
    shade.className = "shade";
    const sweep = document.createElement("span");
    sweep.className = "sweep";
    li.append(shade, art(s, "logo"), sweep);
    li.addEventListener("click", () => { select(s.id); launch(); });
    // The remote's touchpad cursor focuses tiles just like the D-pad does.
    li.addEventListener("mouseenter", () => { focusArea = "tiles"; paintUpdate(); select(s.id); });
    return li;
  });
  const settings = document.createElement("li");
  settings.className = "tile settings-tile";
  settings.setAttribute("role", "option");
  settings.setAttribute("aria-label", "Wi-Fi and Bluetooth settings");
  settings.dataset.id = "@settings";
  settings.innerHTML = '<span class="shade"></span><span class="settings-gear" aria-hidden="true">⚙</span><span class="settings-label">Settings</span><span class="sweep"></span>';
  settings.addEventListener("click", () => { selected = "@settings"; focusArea = "tiles"; paint(true); window.tvDeviceSettings?.open(); });
  settings.addEventListener("mouseenter", () => { focusArea = "tiles"; paintUpdate(); select("@settings"); });
  tiles.push(settings);
  $("tiles").replaceChildren(...tiles);
  paint(true);
}

// ---- breathing amber corner bleed ---------------------------------------------
// Modulate two offset radial gradients with slow, cross-coupled sine waves. Their
// independent size, position and opacity shifts create a warm, organic breathing wash.
const amberWash = $("amber-wash");
const appGlow = $("ambient").getContext("2d", { alpha: false });
let appGlowColor = "";
function drawAppGlow(hex) {
  if (hex === appGlowColor) return;
  appGlowColor = hex;
  const { canvas } = appGlow;
  const { width: w, height: h } = canvas;
  const match = /^#?([\da-f]{6})$/i.exec(hex || "");
  const value = match ? parseInt(match[1], 16) : 0x7c5cff;
  const r = value >> 16, g = (value >> 8) & 255, b = value & 255;
  appGlow.setTransform(1, 0, 0, 1, 0, 0);
  appGlow.fillStyle = "#07080c";
  appGlow.fillRect(0, 0, w, h);
  for (const [x, y, strength] of [[0,0,.40],[w,0,.31],[0,h,.31],[w,h,.40]]) {
    const gradient = appGlow.createRadialGradient(x, y, 0, x, y, h * .72);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${strength})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    appGlow.fillStyle = gradient;
    appGlow.fillRect(0, 0, w, h);
  }
}
drawAppGlow("#7c5cff");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let washLastFrame = 0;
let washRaf = 0;
function renderAmberWash(now) {
  washRaf = 0;
  if (document.hidden || reducedMotion.matches) return;
  if (now - washLastFrame >= 32) {
    washLastFrame = now;
    const t = now / 1000;
    const breathA = (Math.sin(t * .42) + 1) / 2;
    const breathB = (Math.sin(t * .31 + 1.7) + 1) / 2;
    const drift = Math.sin(t * .17 + .8);
    const set = (name, value) => amberWash.style.setProperty(name, value);
    set("--wash-a-x", `${2 + drift * 5}%`);
    set("--wash-a-y", `${3 + Math.sin(t * .23) * 5}%`);
    set("--wash-a-w", `${54 + breathA * 12}vw`);
    set("--wash-a-h", `${64 + breathA * 15}vh`);
    set("--wash-a-alpha", (0.34 + breathA * .14).toFixed(3));
    set("--wash-b-x", `${97 - drift * 6}%`);
    set("--wash-b-y", `${96 - Math.sin(t * .19 + 1.3) * 6}%`);
    set("--wash-b-w", `${48 + breathB * 13}vw`);
    set("--wash-b-h", `${58 + breathB * 18}vh`);
    set("--wash-b-alpha", (0.27 + breathB * .11).toFixed(3));
  }
  washRaf = requestAnimationFrame(renderAmberWash);
}
function startAmberWash() {
  if (!washRaf && !document.hidden && !reducedMotion.matches) {
    washRaf = requestAnimationFrame(renderAmberWash);
  }
}
document.addEventListener("visibilitychange", startAmberWash);
reducedMotion.addEventListener("change", startAmberWash);
startAmberWash();
// Runs on every D-pad press, so it only touches what changed: no page-wide style changes
// and nothing that makes the browser lay the page out there and then.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function paint(quiet = false) {
  for (const li of $("tiles").children) {
    const on = String(focusArea === "tiles" && li.dataset.id === selected);
    if (li.getAttribute("aria-selected") !== on) li.setAttribute("aria-selected", on);
  }
  const s = services.find((x) => x.id === selected);
  if (selected === "@settings") {
    const neutral = "#7c5cff";
    drawAppGlow(neutral);
    document.documentElement.style.setProperty("--ambient-rail", neutral);
    $("hero-eyebrow").style.color = neutral;
    setText($("hero-eyebrow"), "Device setup");
    setText($("hero-title"), "Wi-Fi & Bluetooth");
    setText($("hero-sub"), "Open settings on this TV");
    return;
  }
  if (!s) return;

  drawAppGlow(s.color);
  document.documentElement.style.setProperty("--ambient-rail", s.color);
  $("hero-eyebrow").style.color = s.color;

  const opened = state.recent?.[s.id];
  const newest = Math.max(0, ...Object.values(state.recent || {}));
  setText($("hero-eyebrow"), opened && opened === newest ? "Jump back in" : "Watch on");
  setText($("hero-title"), s.name);
  setText($("hero-sub"), [s.tagline, opened ? `Opened ${ago(opened)}` : ""].filter(Boolean).join("  ·  "));
  if (!quiet) {
    document.querySelector(".hero").animate(
      [{ opacity: 0, transform: "translateY(1vh)" }, { opacity: 1, transform: "none" }],
      { duration: 450, easing: "ease-out" });
  }
}

let selectedHere = 0;  // when a press here last moved the focus
function select(id, announce = true) {
  if ((id !== "@settings" && !services.some((s) => s.id === id)) || (id === selected && !announce)) return;
  const changed = id !== selected;
  selected = id;
  paint(!changed);
  if (announce) {
    selectedHere = performance.now();
    if (id !== "@settings" && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "select", id }));
  }
}

function move(step) {
  const ids = [...services.map((s) => s.id), "@settings"];
  const i = ids.indexOf(selected);
  const next = ids[i + step];
  if (next) select(next);
}

function launch() {
  if (selected === "@settings") { window.tvDeviceSettings?.open(); return; }
  if (selected) fetch(`/api/launch/${encodeURIComponent(selected)}`, { method: "POST" }).catch(() => {});
}

// The server announces a launch (from here or from a phone) just before it navigates.
let splashTimer = 0;
function showSplash(id) {
  const s = allServices.find((x) => x.id === id);
  if (!s) return;
  const splash = $("splash");
  splash.style.setProperty("--tile", s.tile);
  splash.querySelector(".splash-logo").replaceChildren(art(s, "logo"));
  splash.classList.add("on");
  clearTimeout(splashTimer);
  splashTimer = setTimeout(() => splash.classList.remove("on"), 12000);  // in case the site never loads
}

function ago(epochSeconds) {
  const mins = Math.round((Date.now() / 1000 - epochSeconds) / 60);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// ---- update banner -------------------------------------------------------------

function updateVisible() {
  const u = state.update || {};
  return Boolean(u.available && u.latest !== state.settings?.update_dismissed);
}

function paintUpdate() {
  const u = state.update || {};
  const show = updateVisible() || u.installing;
  $("update").hidden = !show;
  if (!show && focusArea === "update") focusArea = "tiles";
  if (!show) return;
  const n = (u.commits || []).length;
  $("update-detail").textContent = u.installing ? "Installing… the TV will restart"
    : u.error ? u.error
    : `${n} change${n === 1 ? "" : "s"}: ${(u.commits || []).map((c) => c.subject).slice(0, 3).join(" · ")}`;
  $("update").classList.toggle("busy", Boolean(u.installing));
  $("update-install").classList.toggle("focus", focusArea === "update" && updateBtn === 0);
  $("update-later").classList.toggle("focus", focusArea === "update" && updateBtn === 1);
}

async function updateAction(act) {
  if (state.update?.installing) return;
  await fetch(act === "install" ? "/api/update/install" : "/api/update/dismiss", { method: "POST" }).catch(() => {});
  focusArea = "tiles";
  paint(true);
  paintUpdate();
}
$("update-install").addEventListener("click", () => updateAction("install"));
$("update-later").addEventListener("click", () => updateAction("later"));

// ---- input -------------------------------------------------------------------

addEventListener("keydown", (e) => {
  if (window.tvDeviceSettings?.handleKey(e)) return;
  const k = e.key;
  if (focusArea === "update") {
    if (k === "ArrowLeft" || k === "ArrowRight") updateBtn = k === "ArrowLeft" ? 0 : 1;
    else if (k === "ArrowDown" || k === "Escape") focusArea = "tiles";
    else if (k === "Enter" || k === " ") updateAction(updateBtn === 0 ? "install" : "later");
    else return;
    e.preventDefault();
    paint(true);
    paintUpdate();
    return;
  }
  if (k === "ArrowLeft" || k === "ArrowRight") move(k === "ArrowLeft" ? -1 : 1);
  else if (k === "ArrowUp" && updateVisible()) { focusArea = "update"; updateBtn = 0; paint(true); paintUpdate(); }
  else if (k === "Enter" || k === " ") launch();
  else return;
  e.preventDefault();
});

// ---- clock & greeting ----------------------------------------------------------

function greeting(h) {
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 23) return "Good evening";
  return "Good night";
}

function tick() {
  const now = new Date();
  const h = now.getHours() % 12 || 12;
  const ampm = document.createElement("small");
  ampm.textContent = now.getHours() < 12 ? "AM" : "PM";
  $("clock").replaceChildren(`${h}:${String(now.getMinutes()).padStart(2, "0")}`, ampm);
  $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  $("greeting").textContent = greeting(now.getHours());
  if (services.length) paint(true);  // keep "Opened 5 min ago" fresh
  setTimeout(tick, 60000 - (Date.now() % 60000) + 50);  // wake once a minute
}

// ---- pairing info (refreshed: the Pi may get its IP after we load) -------------

async function loadInfo() {
  try {
    const info = await (await fetch("/api/info")).json();
    $("url").textContent = info.remote_url.replace(/^http:\/\//, "");
    const fallback = $("ip-url");
    fallback.hidden = !info.remote_ip_url || info.remote_ip_url === info.remote_url;
    fallback.textContent = fallback.hidden ? "" : `If the hostname doesn’t open: ${info.remote_ip_url.replace(/^http:\/\//, "")}`;
    $("pin").hidden = !info.pin;
    if (info.pin) $("pin").querySelector("strong").textContent = info.pin;
    $("qr").src = `/qr.svg?u=${encodeURIComponent(info.remote_url)}&p=${info.pin || ""}`;
  } catch { /* server restarting; the next refresh fixes it */ }
}

function paintRemotes(n, previous) {
  const chip = $("remotes");
  chip.hidden = n === 0;
  chip.querySelector("span").textContent = n === 1 ? "1 remote" : `${n} remotes`;
  if (n > previous) { chip.classList.remove("pop"); void chip.offsetWidth; chip.classList.add("pop"); }
  $("pair").classList.toggle("compact", n > 0);
  $("pair-title").textContent = n > 0 ? "Add another phone" : "Use your phone as the remote";
}

// ---- live state ----------------------------------------------------------------

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=tv`);
  ws.onopen = () => { $("status").hidden = true; };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === "launch") return showSplash(msg.id);
    if (msg.t === "repaired") return loadInfo();
    if (msg.t !== "state") return;
    const before = state;
    state = msg;
    paintRemotes(msg.remotes || 0, before.remotes || 0);
    if (JSON.stringify(msg.settings?.hidden_apps) !== JSON.stringify(before.settings?.hidden_apps)) render();
    // Pressing quickly, the server's echo of an earlier press can arrive after a later one:
    // only follow a selection from elsewhere (a phone) when nothing was pressed here just now.
    if (selected !== "@settings" && msg.selected !== selected && performance.now() - selectedHere > 1000) select(msg.selected, false);
    else paint(true);
    paintUpdate();
  };
  ws.onclose = () => { $("status").hidden = false; setTimeout(connect, 2000); };
}

(async function init() {
  try {
    allServices = await (await fetch("/api/services")).json();
  } catch {
    setTimeout(init, 2000);
    return;
  }
  render();
  tick();
  loadInfo();
  setInterval(loadInfo, 60000);
  connect();
})();
