"use strict";
(() => {
  // extension/src/background.ts
  chrome.runtime.onInstalled.addListener(async () => {
    const saved = await chrome.storage.local.get("preference");
    if (typeof saved.preference !== "string") await chrome.storage.local.set({ preference: "" });
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "cloak-action") return;
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("Select a browser tab first.");
      const tabId = tab.id;
      if (!tab.url || !/^https?:/.test(tab.url)) throw new Error("Open a regular HTTP or HTTPS page first.");
      if (message.action === "status") {
        try {
          return await chrome.tabs.sendMessage(tabId, { type: "status" });
        } catch {
          return { active: false, groups: 0 };
        }
      }
      if (message.action === "off" || message.action === "original") {
        try {
          return await chrome.tabs.sendMessage(tabId, { type: "restore" });
        } catch {
          return { status: "original", groups: 0 };
        }
      }
      if (message.action === "personalize" || message.action === "on") {
        const { preference } = await chrome.storage.local.get("preference");
        const text = String(message.preference ?? preference ?? "").slice(0, 500);
        if (!text.trim()) throw new Error("Describe what you want to find before personalizing.");
        await chrome.storage.local.set({ preference: text });
        try {
          await chrome.tabs.sendMessage(tabId, { type: "status" });
        } catch {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        }
        return await chrome.tabs.sendMessage(tabId, { type: "personalize", preference: text });
      }
      throw new Error("Unknown Cloak action.");
    })().then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  });
})();
