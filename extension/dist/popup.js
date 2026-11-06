"use strict";
(() => {
  // extension/src/popup.ts
  var byId = (id) => document.getElementById(id);
  var preference = byId("preference");
  var status = byId("status");
  var site = byId("site");
  var ai = byId("ai");
  var master = byId("enabled");
  var auto = byId("auto");
  var requireAi = byId("require-ai");
  var currentOrigin = "";
  var show = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  async function action(actionName, text) {
    show(actionName === "personalize" || actionName === "on" ? "Local AI may load on first use \xB7 personalizing\u2026" : "Working\u2026");
    let polling;
    if (actionName === "personalize" || actionName === "on") {
      polling = window.setInterval(() => {
        void chrome.runtime.sendMessage({ type: "cloak-action", action: "ai-status" }).then((value) => {
          if (value?.ai?.message) ai.textContent = value.ai.message;
        }).catch(() => {
        });
      }, 2e3);
    }
    try {
      const result = await chrome.runtime.sendMessage({ type: "cloak-action", action: actionName, preference: text });
      if (result?.site) site.textContent = result.site;
      if (result?.ai) ai.textContent = result.ai.message;
      if (result?.error) {
        if (result.ai) ai.textContent = result.ai.message;
        show(result.error, true);
        return;
      }
      if (result?.status === "personalized") {
        master.checked = true;
        show(`${result.message || "Personalized."} ${result.groups} safe group${result.groups === 1 ? "" : "s"}.`);
      } else if (result?.status === "no-change") {
        master.checked = typeof result.cloakEnabled === "boolean" ? result.cloakEnabled : master.checked;
        show(result.message || "No visible change was needed for this preference.");
      } else if (result?.status === "original") {
        master.checked = typeof result.cloakEnabled === "boolean" ? result.cloakEnabled : master.checked;
        show(result.cloakEnabled === false ? "Cloak is off. Active pages were restored." : "Original page restored.");
      } else {
        master.checked = typeof result?.cloakEnabled === "boolean" ? result.cloakEnabled : !!result?.active;
        show(result?.active ? `Cloak is active on ${result.groups} groups.` : master.checked ? "Cloak is on. This page is in Original mode." : "Cloak is off.");
      }
    } catch (error) {
      show(error instanceof Error ? error.message : "Cloak could not communicate with this page.", true);
    } finally {
      if (polling !== void 0) window.clearInterval(polling);
    }
  }
  void (async () => {
    try {
      const saved = await chrome.storage.local.get({ preference: "", requireRealAi: false });
      preference.value = saved.preference;
      requireAi.checked = saved.requireRealAi === true;
      await action("status");
      const state = await chrome.runtime.sendMessage({ type: "cloak-action", action: "auto-status" });
      currentOrigin = state?.origin || "";
      auto.checked = !!state?.enabled;
    } catch (error) {
      site.textContent = "Website unavailable";
      show(error instanceof Error ? error.message : "Cloak could not load its saved preferences.", true);
    }
  })();
  preference.addEventListener("input", () => {
    void chrome.storage.local.set({ preference: preference.value });
    void chrome.runtime.sendMessage({ type: "cloak-preference-changed" });
  });
  master.addEventListener("change", async () => {
    if (master.checked) await action("on", preference.value);
    else await action("off");
  });
  byId("cloaked").addEventListener("click", () => void action("on", preference.value));
  byId("personalize").addEventListener("click", () => void action("personalize", preference.value));
  byId("original").addEventListener("click", () => void action("original"));
  requireAi.addEventListener("change", () => {
    void chrome.storage.local.set({ requireRealAi: requireAi.checked });
    show(requireAi.checked ? "Verification mode is on: deterministic fallback will fail visibly." : "Verification mode is off.");
  });
  byId("pair").addEventListener("click", async () => {
    show("Pairing local companion\u2026");
    try {
      const response = await fetch("http://127.0.0.1:4319/api/extension/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: byId("pairing").value.trim() }), signal: AbortSignal.timeout(6e3), ...{ targetAddressSpace: "loopback" } });
      if (!response.ok) throw new Error("Pairing failed. Check that the companion is running and enter its current one-time code.");
      const paired = await response.json();
      const result = await chrome.runtime.sendMessage({ type: "cloak-store-token", token: paired.token, models: paired.models });
      if (result?.error) throw new Error(result.error);
      byId("pairing").value = "";
      const connection = await chrome.runtime.sendMessage({ type: "cloak-action", action: "ai-status" });
      ai.textContent = connection?.ai?.message || result.message;
      show("Connected. Reconnecting replaces the saved token.");
    } catch (error) {
      show(error instanceof Error ? error.message : "Could not reach the local companion. Allow local network access if Chrome asks.", true);
    }
  });
  auto.addEventListener("change", async () => {
    try {
      if (!currentOrigin) throw new Error("Auto-Personalize needs a regular website tab.");
      if (auto.checked) {
        const current = new URL(currentOrigin), pattern = `${current.protocol}//${current.hostname}/*`;
        const granted = await chrome.permissions.request({ origins: [pattern] });
        if (!granted) {
          auto.checked = false;
          show("Site permission was not granted. Auto-Personalize remains off.", true);
          return;
        }
      }
      const result = await chrome.runtime.sendMessage({ type: "cloak-action", action: "auto-set", enabled: auto.checked });
      if (result?.error) {
        auto.checked = false;
        show(result.error, true);
      } else show(auto.checked ? `Auto-Personalize enabled for ${result.site}.` : "Auto-Personalize disabled and the current page restored.");
    } catch (error) {
      auto.checked = false;
      show(error instanceof Error ? error.message : "Could not update Auto-Personalize.", true);
    }
  });
})();
