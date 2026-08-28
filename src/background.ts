// The service worker exists for one reason: make the toolbar button open the
// side panel. Everything else happens in the panel, where the user can see it.

function openPanelOnClick(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error("gistpeek: cannot set panel behavior", error));
}

chrome.runtime.onInstalled.addListener(openPanelOnClick);
chrome.runtime.onStartup.addListener(openPanelOnClick);
