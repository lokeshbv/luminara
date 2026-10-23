// On-TV Wi-Fi and Bluetooth controls. Every action is reachable with the D-pad;
// the virtual keyboard means a Wi-Fi password can be entered without a paired keyboard.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const modal = $("device-settings");
  const content = $("settings-content");
  const tabs = [...document.querySelectorAll(".settings-tab")];
  const s = { open: false, tab: "wifi", zone: "tabs", index: 0, networks: [], savedNetworks: [], devices: [], audioOutputs: [],
    connected: "", message: "", busy: false, passwordSsid: "", password: "", keyIndex: 0 };
  const alphabet = [..."abcdefghijklmnopqrstuvwxyz0123456789 !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"];

  function request(url, body) {
    return fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.ok === false) throw new Error(data.error || `Request failed (${r.status})`);
        return data;
      });
  }

  function markFocus() {
    tabs.forEach((b, i) => b.classList.toggle("focus", s.zone === "tabs" && i === tabs.findIndex((tab) => tab.dataset.tab === s.tab)));
    $("settings-close").classList.toggle("focus", s.zone === "close");
    const buttons = [...content.querySelectorAll("button[data-nav]")];
    buttons.forEach((b, i) => b.classList.toggle("focus", s.zone === "items" && i === s.index));
    if (s.zone === "items") buttons[s.index]?.scrollIntoView({ block: "nearest" });
    if (s.zone === "keyboard") {
      const keys = [...content.querySelectorAll(".virtual-key[data-nav]")];
      keys.forEach((b, i) => b.classList.toggle("focus", i === s.keyIndex));
      keys[s.keyIndex]?.scrollIntoView({ block: "nearest" });
    }
  }

  function setMessage(text) {
    s.message = text;
    const node = content.querySelector(".settings-message");
    if (node) node.textContent = text;
  }

  function btn(label, action, extra = "") {
    const b = document.createElement("button");
    b.className = `settings-action ${extra}`;
    b.type = "button";
    b.dataset.nav = "";
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }

  function row(title, detail, action, active = false) {
    const b = document.createElement("button");
    b.className = "settings-row";
    b.type = "button";
    b.dataset.nav = "";
    const a = document.createElement("span");
    a.textContent = title;
    const d = document.createElement("small");
    d.textContent = detail;
    if (active) d.className = "connected";
    b.append(a, d);
    b.addEventListener("click", action);
    return b;
  }

  function refreshFocus() {
    const items = content.querySelectorAll("button[data-nav]");
    if (s.index >= items.length) s.index = Math.max(0, items.length - 1);
    markFocus();
  }

  function render() {
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === s.tab));
    content.replaceChildren();
    if (s.passwordSsid) return renderPassword();
    if (s.tab === "wifi") renderWifi();
    else if (s.tab === "bluetooth") renderBluetooth();
    else renderAudio();
    refreshFocus();
  }

  function renderWifi() {
    const summary = document.createElement("p");
    summary.className = "settings-summary";
    summary.textContent = s.connected ? `Connected to ${s.connected} · Saved networks reconnect automatically` : "Saved networks reconnect automatically at startup";
    const actions = document.createElement("div");
    actions.className = "settings-actions";
    actions.append(btn("Scan for networks", scanWifi));
    content.append(summary, actions);
    const list = document.createElement("div");
    list.className = "settings-list";
    const merged = new Map(s.savedNetworks.map((n) => [n.ssid, n]));
    for (const network of s.networks) merged.set(network.ssid, { ...merged.get(network.ssid), ...network, saved: network.saved || merged.has(network.ssid) });
    if (merged.size) {
      merged.forEach((network) => {
        const item = document.createElement("div");
        item.className = "settings-row";
        const info = document.createElement("span");
        info.textContent = network.ssid;
        const detail = document.createElement("small");
        detail.textContent = `${network.active ? "Connected · " : ""}${network.saved ? "Saved" : `${network.signal}% · ${network.security || "Open network"}`}`;
        info.append(detail);
        item.append(info);
        item.append(network.active ? btn("Disconnect", () => wifiAction(network, "disconnect")) : btn("Connect", () => chooseWifi(network)));
        if (network.saved) item.append(btn("Forget", () => wifiAction(network, "forget")));
        list.append(item);
      });
    } else {
      const empty = document.createElement("p");
      empty.className = "settings-summary";
      empty.textContent = "Choose Scan for networks to find nearby Wi-Fi.";
      list.append(empty);
    }
    content.append(list, messageNode());
  }

  function renderBluetooth() {
    const summary = document.createElement("p");
    summary.className = "settings-summary";
    summary.textContent = "Paired devices stay saved. The last connected device is retried at startup. Put a device in pairing mode, then scan.";
    const actions = document.createElement("div");
    actions.className = "settings-actions";
    actions.append(btn("Scan for devices", scanBluetooth));
    content.append(summary, actions);
    const list = document.createElement("div");
    list.className = "settings-list";
    s.devices.forEach((device) => {
      const item = document.createElement("div");
      item.className = "settings-row";
      const info = document.createElement("span");
      info.textContent = device.name;
      const detail = document.createElement("small");
      detail.textContent = `${device.address} · ${device.connected ? "Connected" : device.paired ? "Paired" : "Available"}`;
      info.append(detail);
      item.append(info, btn(device.connected ? "Disconnect" : device.paired ? "Connect" : "Pair",
        () => device.connected ? bluetoothAction(device, "disconnect") : device.paired ? connectBluetooth(device) : pairBluetooth(device)));
      if (device.paired) item.append(btn("Forget", () => bluetoothAction(device, "forget")));
      list.append(item);
    });
    if (!s.devices.length) {
      const empty = document.createElement("p");
      empty.className = "settings-summary";
      empty.textContent = "Nearby devices will appear here after a scan.";
      list.append(empty);
    }
    content.append(list, messageNode());
  }

  function renderAudio() {
    const summary = document.createElement("p");
    summary.className = "settings-summary";
    summary.textContent = "Choose where TV sound plays. Bluetooth speakers must be connected first.";
    const actions = document.createElement("div");
    actions.className = "settings-actions";
    actions.append(btn("Refresh outputs", loadAudio));
    content.append(summary, actions);
    const list = document.createElement("div");
    list.className = "settings-list";
    s.audioOutputs.forEach((output) => list.append(row(output.name,
      output.default ? "Current output" : "Select for TV sound", () => selectAudio(output), output.default)));
    if (!s.audioOutputs.length) {
      const empty = document.createElement("p");
      empty.className = "settings-summary";
      empty.textContent = "No audio outputs found. Refresh after connecting a speaker.";
      list.append(empty);
    }
    content.append(list, messageNode());
  }

  async function loadAudio() {
    s.busy = true;
    setMessage("Loading audio outputs…");
    try {
      s.audioOutputs = (await request("/api/audio/outputs")).outputs || [];
      s.message = s.audioOutputs.length ? "Select the output for TV sound." : "No audio outputs are available.";
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function selectAudio(output) {
    s.busy = true;
    setMessage(`Switching TV sound to ${output.name}…`);
    try {
      const data = await request("/api/audio/output", { id: output.id });
      s.audioOutputs = (await request("/api/audio/outputs")).outputs || [];
      s.message = `TV sound is using ${data.output?.name || output.name}.`;
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  function messageNode() {
    const p = document.createElement("p");
    p.className = "settings-message";
    p.textContent = s.message;
    return p;
  }

  function renderPassword() {
    const title = document.createElement("p");
    title.className = "settings-summary";
    title.textContent = `Enter the Wi-Fi password for ${s.passwordSsid}`;
    const view = document.createElement("div");
    view.className = "password-view";
    view.setAttribute("aria-label", "Password");
    view.textContent = s.password ? "•".repeat(s.password.length) : "Select characters below";
    const keys = document.createElement("div");
    keys.className = "virtual-keys";
    [...alphabet, "⌫", "Clear", "Connect", "Cancel"].forEach((key, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "virtual-key";
      b.dataset.nav = "";
      b.textContent = key === " " ? "Space" : key;
      b.addEventListener("click", () => useKey(key));
      keys.append(b);
      if (index === s.keyIndex) b.classList.add("focus");
    });
    content.append(title, view, keys, messageNode());
    s.zone = "keyboard";
  }

  function useKey(key) {
    if (key === "⌫") s.password = s.password.slice(0, -1);
    else if (key === "Clear") s.password = "";
    else if (key === "Connect") { connectWifi(s.passwordSsid, s.password); return; }
    else if (key === "Cancel") { s.passwordSsid = ""; s.password = ""; s.zone = "items"; }
    else if (s.password.length < 63) s.password += key;
    render();
  }

  function chooseWifi(network) {
    if (network.active) return;
    if (network.saved) return wifiAction(network, "connect-saved");
    if (network.security) {
      s.passwordSsid = network.ssid;
      s.password = "";
      s.keyIndex = 0;
      render();
    } else connectWifi(network.ssid, "");
  }

  async function scanWifi() {
    s.busy = true;
    setMessage("Scanning for Wi-Fi…");
    try {
      const data = await request("/api/network/wifi/scan", {});
      s.networks = data.networks || [];
      s.message = s.networks.length ? "Select a network to connect." : "No networks found. Try scanning again.";
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function connectWifi(ssid, password) {
    s.busy = true;
    setMessage(`Connecting to ${ssid}…`);
    try {
      await request("/api/network/wifi/connect", { ssid, password });
      s.passwordSsid = "";
      s.password = "";
      s.message = `Connected to ${ssid}.`;
      const data = await request("/api/network/status");
      s.connected = data.wifi?.connected || ssid;
      s.savedNetworks = data.saved_wifi || s.savedNetworks;
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function wifiAction(network, action) {
    s.busy = true;
    setMessage(`${action === "connect-saved" ? "Connecting to" : action === "disconnect" ? "Disconnecting from" : "Forgetting"} ${network.ssid}…`);
    try {
      const path = action === "connect-saved" ? "/api/network/wifi/connect-saved" : `/api/network/wifi/${action}`;
      await request(path, { ssid: network.ssid });
      const data = await request("/api/network/status");
      s.connected = data.wifi?.connected || "";
      s.savedNetworks = data.saved_wifi || [];
      s.message = `${network.ssid} ${action === "forget" ? "forgotten" : action === "disconnect" ? "disconnected" : "connected"}.`;
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function scanBluetooth() {
    s.busy = true;
    setMessage("Scanning for Bluetooth devices…");
    try {
      const data = await request("/api/network/bluetooth/scan", {});
      s.devices = data.devices || [];
      s.message = s.devices.length ? "Select a device to pair or connect." : "No devices found. Keep the device in pairing mode and scan again.";
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function pairBluetooth(device) {
    if (device.paired) { setMessage(`${device.name} is already paired.`); return; }
    s.busy = true;
    setMessage(`Pairing with ${device.name}…`);
    try {
      await request("/api/network/bluetooth/pair", { address: device.address });
      s.devices = (await request("/api/network/status")).bluetooth || [];
      s.message = `${device.name} paired. If it is a keyboard, press a key to check the connection.`;
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function connectBluetooth(device) {
    if (device.connected) { setMessage(`${device.name} is already connected.`); return; }
    s.busy = true;
    setMessage(`Connecting to ${device.name}…`);
    try {
      await request("/api/network/bluetooth/connect", { address: device.address });
      s.devices = (await request("/api/network/status")).bluetooth || [];
      s.message = `${device.name} connected.`;
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function bluetoothAction(device, action) {
    s.busy = true;
    setMessage(`${action === "disconnect" ? "Disconnecting from" : "Forgetting"} ${device.name}…`);
    try {
      await request(`/api/network/bluetooth/${action}`, { address: device.address });
      s.devices = (await request("/api/network/status")).bluetooth || [];
      s.message = `${device.name} ${action === "forget" ? "forgotten" : "disconnected"}.`;
    } catch (e) { s.message = e.message; }
    s.busy = false;
    render();
  }

  async function loadStatus() {
    try {
      const data = await request("/api/network/status");
      s.connected = data.wifi?.connected || "";
      s.savedNetworks = data.saved_wifi || [];
      s.devices = data.bluetooth || [];
      if (data.bluetooth_error) s.message = data.bluetooth_error;
    } catch (e) { s.message = e.message; }
    render();
  }

  function switchTab(tab) {
    s.tab = tab;
    s.zone = "tabs";
    s.index = 0;
    render();
    if (tab === "audio") loadAudio();
  }

  function open() {
    s.open = true;
    s.tab = "wifi";
    s.zone = "tabs";
    s.index = 0;
    s.passwordSsid = "";
    s.password = "";
    s.message = "";
    modal.hidden = false;
    loadStatus();
    scanWifi();
    markFocus();
  }

  function close() {
    s.open = false;
    modal.hidden = true;
    s.passwordSsid = "";
    s.password = "";
  }

  function handleKey(e) {
    if (!s.open) return false;
    const k = e.key;
    if (s.passwordSsid && s.zone === "keyboard") {
      if (k === "Escape") { s.passwordSsid = ""; s.password = ""; s.zone = "items"; render(); }
      else if (k === "Backspace") { s.password = s.password.slice(0, -1); render(); }
      else if (k === "Enter") useKey("Connect");
      else if (k.length === 1 && !e.metaKey && !e.ctrlKey && s.password.length < 63) { s.password += k; render(); }
      else if (k.startsWith("Arrow")) {
        const keys = [...content.querySelectorAll(".virtual-key[data-nav]")];
        const cols = 10, max = keys.length - 1;
        if (k === "ArrowLeft") s.keyIndex = Math.max(0, s.keyIndex - 1);
        if (k === "ArrowRight") s.keyIndex = Math.min(max, s.keyIndex + 1);
        if (k === "ArrowUp") s.keyIndex = Math.max(0, s.keyIndex - cols);
        if (k === "ArrowDown") s.keyIndex = Math.min(max, s.keyIndex + cols);
        markFocus();
      } else return false;
      e.preventDefault();
      return true;
    }
    if (k === "Escape") { close(); e.preventDefault(); return true; }
    if (s.zone === "close") {
      if (k === "Enter" || k === " ") close();
      else if (k === "ArrowDown" || k === "ArrowLeft") { s.zone = "tabs"; markFocus(); }
      e.preventDefault(); return true;
    }
    if (s.zone === "tabs") {
      if (k === "ArrowLeft" || k === "ArrowRight") {
        const index = tabs.findIndex((tab) => tab.dataset.tab === s.tab);
        switchTab(tabs[(index + (k === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length].dataset.tab);
      }
      else if (k === "ArrowDown") { s.zone = "items"; s.index = 0; refreshFocus(); }
      else if (k === "ArrowUp") { s.zone = "close"; markFocus(); }
      else if (k === "Enter" || k === " ") switchTab(s.tab);
      else return false;
      e.preventDefault(); return true;
    }
    const items = [...content.querySelectorAll("button[data-nav]")];
    if (k === "ArrowDown" || k === "ArrowRight") s.index = Math.min(Math.max(0, items.length - 1), s.index + 1);
    else if (k === "ArrowUp" || k === "ArrowLeft") {
      if (s.index === 0) { s.zone = "tabs"; markFocus(); e.preventDefault(); return true; }
      s.index = Math.max(0, s.index - 1);
    } else if (k === "Enter" || k === " ") items[s.index]?.click();
    else return false;
    e.preventDefault(); refreshFocus(); return true;
  }

  $("settings-close").addEventListener("click", close);
  $("settings-close").addEventListener("mouseenter", () => { s.zone = "close"; markFocus(); });
  tabs.forEach((b) => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
    b.addEventListener("mouseenter", () => { s.zone = "tabs"; s.tab = b.dataset.tab; markFocus(); });
  });
  window.tvDeviceSettings = { open, close, handleKey };
})();
