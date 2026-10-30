// Network settings in the phone remote. The API is the same one used by the TV settings.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  let wifi = [], savedWifi = [], bluetooth = [], audioOutputs = [], selectedSsid = "";

  async function request(path, body) {
    const options = body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    };
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `${options.method || "GET"} ${path} failed (${res.status})`);
    return data;
  }

  function status(id, text, error = false) {
    const node = $(id);
    node.textContent = text;
    node.classList.toggle("error", error);
  }

  function actionButton(label, action, accent = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill small${accent ? " accent" : ""}`;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderWifi() {
    const list = $("net-wifi-list");
    list.replaceChildren();
    const merged = new Map(savedWifi.map((n) => [n.ssid, n]));
    for (const network of wifi) merged.set(network.ssid, { ...merged.get(network.ssid), ...network, saved: network.saved || merged.has(network.ssid) });
    for (const network of merged.values()) {
      const row = document.createElement("div");
      row.className = "network-row";
      const label = document.createElement("span");
      label.textContent = network.ssid;
      const detail = document.createElement("small");
      detail.textContent = `${network.active ? "Connected · " : ""}${network.saved ? "Saved" : `${network.signal}% · ${network.security || "Open network"}`}`;
      label.append(detail);
      row.append(label);
      if (network.active) row.append(actionButton("Disconnect", () => wifiAction(network, "disconnect")));
      else row.append(actionButton("Connect", () => chooseWifi(network), true));
      if (network.saved) row.append(actionButton("Forget", () => wifiAction(network, "forget")));
      list.append(row);
    }
    if (!wifi.length) list.textContent = "Scan to find nearby networks.";
  }

  function renderBluetooth() {
    const list = $("net-bt-list");
    list.replaceChildren();
    for (const device of bluetooth) {
      const row = document.createElement("div");
      row.className = "network-row";
      const label = document.createElement("span");
      label.textContent = device.name;
      const detail = document.createElement("small");
      detail.textContent = `${device.address} · ${device.connected ? "Connected" : device.paired ? "Paired" : "Available"}`;
      label.append(detail);
      row.append(label, actionButton(device.connected ? "Disconnect" : device.paired ? "Connect" : "Pair",
        () => bluetoothAction(device, device.connected ? "disconnect" : device.paired ? "connect" : "pair"), device.connected));
      if (device.paired) row.append(actionButton("Forget", () => bluetoothAction(device, "forget")));
      list.append(row);
    }
    if (!bluetooth.length) list.textContent = "Scan to find nearby speakers and keyboards.";
  }

  function renderAudio() {
    const select = $("net-audio-output");
    const current = audioOutputs.find((output) => output.default);
    select.replaceChildren(...audioOutputs.map((output) => {
      const option = document.createElement("option");
      option.value = String(output.id);
      option.textContent = `${output.name}${output.default ? " · Current" : ""}`;
      option.selected = output.default;
      return option;
    }));
    select.disabled = !audioOutputs.length;
    $("net-audio-test").disabled = !audioOutputs.length;
    if (!audioOutputs.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No audio outputs available";
      select.append(option);
      status("net-audio-status", "Connect a speaker, then refresh outputs.");
    } else {
      status("net-audio-status", `Current output: ${current?.name || "Unknown"}`);
    }
  }

  async function loadAudio() {
    status("net-audio-status", "Loading audio outputs…");
    try {
      audioOutputs = (await request("/api/audio/outputs")).outputs || [];
      renderAudio();
    } catch (e) { status("net-audio-status", e.message, true); }
  }

  async function selectAudio() {
    const id = Number($("net-audio-output").value);
    if (!Number.isInteger(id) || id < 1) return;
    const output = audioOutputs.find((item) => item.id === id);
    status("net-audio-status", `Switching TV sound to ${output?.name || "selected output"}…`);
    $("net-audio-output").disabled = true;
    try {
      const data = await request("/api/audio/output", { id });
      audioOutputs = (await request("/api/audio/outputs")).outputs || [];
      renderAudio();
      status("net-audio-status", `TV sound is using ${data.output?.name || output?.name || "selected output"}.`);
    } catch (e) { status("net-audio-status", e.message, true); await loadAudio(); }
  }

  async function testAudio() {
    const id = Number($("net-audio-output").value);
    if (!Number.isInteger(id) || id < 1) return;
    const output = audioOutputs.find((item) => item.id === id);
    status("net-audio-status", `Playing a test tone through ${output?.name || "selected output"}…`);
    $("net-audio-test").disabled = true;
    try {
      await request("/api/audio/test", { id });
      status("net-audio-status", `Test tone sent to ${output?.name || "selected output"}.`);
    } catch (e) { status("net-audio-status", e.message, true); }
    finally { $("net-audio-test").disabled = false; }
  }

  async function loadStatus() {
    try {
      const data = await request("/api/network/status");
      const wifiEnabled = data.wifi?.enabled !== false;
      $("net-wifi-power").textContent = wifiEnabled ? "Turn Wi-Fi off" : "Turn Wi-Fi on";
      status("net-wifi-status", !wifiEnabled ? "Wi-Fi is off" : data.wifi?.connected ? `Connected to ${data.wifi.connected}` : "Not connected to Wi-Fi");
      savedWifi = data.saved_wifi || [];
      wifi = [...wifi];
      renderWifi();
      bluetooth = data.bluetooth || [];
      const bluetoothEnabled = data.bluetooth_enabled !== false;
      $("net-bt-power").textContent = bluetoothEnabled ? "Turn Bluetooth off" : "Turn Bluetooth on";
      status("net-bt-status", data.bluetooth_error || (!bluetoothEnabled ? "Bluetooth is off" : bluetooth.length ? "Paired and nearby devices" : "No paired Bluetooth devices"), !!data.bluetooth_error);
      renderBluetooth();
    } catch (e) {
      status("net-wifi-status", e.message, true);
      status("net-bt-status", e.message, true);
    }
  }

  async function setRadio(kind, enabled) {
    const isWifi = kind === "wifi";
    const button = $(isWifi ? "net-wifi-power" : "net-bt-power");
    const statusId = isWifi ? "net-wifi-status" : "net-bt-status";
    const label = isWifi ? "Wi-Fi" : "Bluetooth";
    button.disabled = true;
    status(statusId, `${enabled ? "Turning on" : "Turning off"} ${label}…`);
    try {
      const result = await request(`/api/network/${kind}/radio`, { enabled });
      await loadStatus();
      status(statusId, result.message || `${label} turned ${enabled ? "on" : "off"}.`);
      if (kind === "bluetooth" && enabled) await loadAudio();
    } catch (e) { status(statusId, e.message, true); }
    finally { button.disabled = false; }
  }

  async function scanWifi() {
    status("net-wifi-status", "Scanning for Wi-Fi…");
    $("net-wifi-scan").disabled = true;
    try {
      wifi = (await request("/api/network/wifi/scan", {})).networks || [];
      status("net-wifi-status", wifi.length ? "Choose a network to connect." : "No networks found. Try again.");
      renderWifi();
    } catch (e) { status("net-wifi-status", e.message, true); }
    finally { $("net-wifi-scan").disabled = false; }
  }

  function chooseWifi(network) {
    if (network.active) return;
    if (network.saved) return wifiAction(network, "connect-saved");
    if (!network.security) return connectWifi(network.ssid, "");
    selectedSsid = network.ssid;
    $("net-wifi-ssid").textContent = selectedSsid;
    $("net-wifi-pass").value = "";
    $("net-wifi-password").hidden = false;
    $("net-wifi-pass").focus();
  }

  async function connectWifi(ssid, password) {
    status("net-wifi-status", `Connecting to ${ssid}…`);
    try {
      await request("/api/network/wifi/connect", { ssid, password });
      $("net-wifi-password").hidden = true;
      selectedSsid = "";
      status("net-wifi-status", `Connected to ${ssid}. The remote may reconnect after your phone joins this Wi-Fi.`);
      await scanWifi();
    } catch (e) { status("net-wifi-status", e.message, true); }
  }

  async function wifiAction(network, action) {
    if (action === "forget" && !window.confirm(`Forget “${network.ssid}”? Its saved Wi-Fi password will be removed.`)) return;
    const label = action === "connect-saved" ? "Connecting to" : action === "disconnect" ? "Disconnecting from" : "Forgetting";
    status("net-wifi-status", `${label} ${network.ssid}…`);
    try {
      const path = action === "connect-saved" ? "/api/network/wifi/connect-saved" : `/api/network/wifi/${action}`;
      await request(path, { ssid: network.ssid });
      if (action === "forget") savedWifi = savedWifi.filter((n) => n.ssid !== network.ssid);
      await loadStatus();
      await scanWifi();
    } catch (e) { status("net-wifi-status", e.message, true); }
  }

  async function scanBluetooth() {
    status("net-bt-status", "Scanning for Bluetooth devices… keep the device in pairing mode.");
    $("net-bt-scan").disabled = true;
    try {
      bluetooth = (await request("/api/network/bluetooth/scan", {})).devices || [];
      status("net-bt-status", bluetooth.length ? "Tap Pair or Connect beside a device." : "No devices found. Keep it in pairing mode and scan again.");
      renderBluetooth();
    } catch (e) { status("net-bt-status", e.message, true); }
    finally { $("net-bt-scan").disabled = false; }
  }

  async function bluetoothAction(device, action) {
    const label = action === "pair" ? "Pairing with" : action === "connect" ? "Connecting to" : action === "disconnect" ? "Disconnecting from" : "Forgetting";
    status("net-bt-status", `${label} ${device.name}…`);
    try {
      await request(`/api/network/bluetooth/${action}`, { address: device.address });
      await loadStatus();
      await loadAudio();  // connecting a speaker adds its output to PipeWire
      status("net-bt-status", `${device.name} ${action === "forget" ? "forgotten" : action === "disconnect" ? "disconnected" : action === "connect" ? "connected" : "paired"}.`);
    } catch (e) { status("net-bt-status", e.message, true); }
  }

  $("net-wifi-scan").addEventListener("click", scanWifi);
  $("net-wifi-power").addEventListener("click", () => setRadio("wifi", $("net-wifi-power").textContent === "Turn Wi-Fi on"));
  $("net-wifi-connect").addEventListener("click", () => connectWifi(selectedSsid, $("net-wifi-pass").value));
  $("net-wifi-cancel").addEventListener("click", () => { $("net-wifi-password").hidden = true; selectedSsid = ""; });
  $("net-bt-scan").addEventListener("click", scanBluetooth);
  $("net-bt-power").addEventListener("click", () => setRadio("bluetooth", $("net-bt-power").textContent === "Turn Bluetooth on"));
  $("net-audio-output").addEventListener("change", selectAudio);
  $("net-audio-test").addEventListener("click", testAudio);
  $("net-audio-refresh").addEventListener("click", loadAudio);
  document.addEventListener("luminara:settings-open", () => { loadStatus(); loadAudio(); });
})();
