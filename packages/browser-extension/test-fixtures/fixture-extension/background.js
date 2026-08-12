// Minimal service worker so the extension ID can be discovered at runtime via
// context.serviceWorkers(). The onInstalled listener keeps it registered.
chrome.runtime.onInstalled.addListener(() => {})
