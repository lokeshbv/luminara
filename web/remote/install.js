// Android home-screen installation for the Luminara remote.
"use strict";

(() => {
  const section = document.getElementById("android-install");
  if (!section || !/Android/i.test(navigator.userAgent)) return;
  section.hidden = false;

  const installButton = document.getElementById("pwa-install");
  const status = document.getElementById("pwa-status");
  const secureLink = document.getElementById("pwa-secure-link");
  let installEvent = null;

  if (window.matchMedia("(display-mode: standalone)").matches) {
    status.textContent = "Luminara is installed on this device.";
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    installEvent = null;
    installButton.hidden = true;
    status.textContent = "Luminara is installed on this device.";
  });

  installButton.addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const result = await installEvent.userChoice;
    installEvent = null;
    installButton.hidden = true;
    if (result.outcome === "accepted") status.textContent = "Luminara is being installed.";
  });

  async function loadSecureAddress() {
    try {
      const response = await fetch("/api/info");
      if (!response.ok) throw new Error("Unable to load the secure address.");
      const info = await response.json();
      if (info.secure_url) {
        secureLink.href = info.secure_url;
        secureLink.hidden = false;
        const fallback = info.secure_ip_url
          ? ` If the hostname does not open, use ${info.secure_ip_url}.`
          : "";
        status.textContent = `After installing the certificate, open ${info.secure_url} in Chrome.${fallback}`;
      } else {
        status.textContent = "This box has no HTTPS certificate yet. Update Luminara, then reopen these settings.";
      }
    } catch (error) {
      status.textContent = error.message || "Unable to load Android setup details.";
    }
  }

  document.addEventListener("luminara:settings-open", loadSecureAddress);
})();
