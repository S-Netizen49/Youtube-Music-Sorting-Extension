// background.js — Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('YTMusic AI Sorter installed');
});

// Handle messages between popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_TAB') {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
  }
  return true;
});
