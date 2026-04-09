// content.js — Runs on music.youtube.com

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPE_SONGS') {
    const songs = scrapeLikedSongs();
    sendResponse({ songs });
  }
  if (msg.type === 'CREATE_PLAYLIST') {
    handleCreatePlaylist(msg.playlist);
    sendResponse({ ok: true });
  }
  return true;
});

function scrapeLikedSongs() {
  const items = [];
  const seen = new Set();

  const rows = document.querySelectorAll(
    'ytmusic-responsive-list-item-renderer'
  );

  rows.forEach(row => {
    try {
      const titleEl = row.querySelector('yt-formatted-string.title');
      const title = titleEl?.textContent?.trim();

      const artistEl = row.querySelector('.secondary-flex-columns yt-formatted-string:first-child');
      const artist = artistEl?.textContent?.trim();

      const albumEl = row.querySelector('.secondary-flex-columns yt-formatted-string:nth-child(2)');
      const album = albumEl?.textContent?.trim();

      const img = row.querySelector('img');
      const thumb = img?.src || '';

      const link = row.querySelector('a[href*="watch?v="]');
      const videoId = link?.href?.match(/v=([^&]+)/)?.[1] || '';

      const key = `${title}|||${artist}`;
      if (title && artist && !seen.has(key)) {
        seen.add(key);
        items.push({ title, artist, album: album || '', thumb, videoId });
      }
    } catch (_) {}
  });

  return items;
}

async function handleCreatePlaylist(playlist) {
  // Show floating UI notification
  showNotification(playlist);
}

function showNotification(pl) {
  const existing = document.getElementById('ytsorter-notif');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'ytsorter-notif';
  el.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 999999;
    background: #13131a;
    border: 1px solid #7c3aed;
    border-radius: 12px;
    padding: 16px 20px;
    color: #f0f0f8;
    font-family: 'DM Mono', monospace, monospace;
    font-size: 13px;
    max-width: 340px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.2);
    animation: slideIn 0.3s ease;
  `;

  el.innerHTML = `
    <style>
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
    </style>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="font-size:20px">${pl.emoji || '🎵'}</div>
      <div>
        <div style="font-weight:700;color:#7c3aed;font-size:12px;text-transform:uppercase;letter-spacing:1px">YTMusic AI Sorter</div>
        <div style="font-weight:600;font-size:14px">${pl.name}</div>
      </div>
    </div>
    <div style="font-size:11px;color:#6b6b8a;margin-bottom:10px">${pl.songs.length} songs categorized</div>
    <div style="font-size:11px;line-height:1.6;color:#f59e0b;padding:8px 10px;background:rgba(245,158,11,0.1);border-radius:6px;border:1px solid rgba(245,158,11,0.25)">
      📋 To create this playlist on YT Music:
      <ol style="margin:6px 0 0 16px;color:#d4a853">
        <li>Click your profile → Library</li>
        <li>Click "New Playlist"</li>
        <li>Name it: <strong style="color:#f0f0f8">${pl.name}</strong></li>
        <li>Search & add the songs listed in the extension</li>
      </ol>
    </div>
    <button onclick="this.closest('#ytsorter-notif').remove()" style="
      margin-top:10px;width:100%;padding:7px;background:rgba(124,58,237,0.15);
      border:1px solid rgba(124,58,237,0.3);color:#7c3aed;border-radius:6px;
      cursor:pointer;font-family:inherit;font-size:11px;
    ">Got it ✓</button>
  `;

  document.body.appendChild(el);

  // Auto-remove after 15 seconds
  setTimeout(() => el?.remove(), 15000);
}
