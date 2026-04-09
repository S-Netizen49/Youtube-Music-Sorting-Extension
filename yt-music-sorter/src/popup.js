// popup.js — YTMusic AI Sorter

const $ = id => document.getElementById(id);

// ─── State ────────────────────────────────────────────────────────────────────
let songs = [];
let playlists = {};
let sortMode = 'genre';

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved API key
  const { apiKey, savedSongs } = await chrome.storage.local.get(['apiKey', 'savedSongs']);
  if (apiKey) $('apiKeyInput').value = apiKey;
  if (savedSongs && savedSongs.length) {
    songs = savedSongs;
    renderSongsList();
    $('sortBtn').disabled = false;
    $('fetchNote').style.display = 'block';
  }

  // Chip selection
  document.querySelectorAll('.sort-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      sortMode = chip.dataset.mode;
      const isCustom = sortMode === 'custom';
      $('customPrompt').style.opacity = isCustom ? '1' : '0.4';
      $('customPrompt').disabled = !isCustom;
    });
  });
  $('customPrompt').disabled = true;
  $('customPrompt').style.opacity = '0.4';

  $('saveKeyBtn').addEventListener('click', saveApiKey);
  $('fetchBtn').addEventListener('click', fetchSongs);
  $('sortBtn').addEventListener('click', sortSongs);
});

// ─── API Key ──────────────────────────────────────────────────────────────────
async function saveApiKey() {
  const key = $('apiKeyInput').value.trim();
  if (!key.startsWith('sk-ant-')) {
    setStatus('Invalid key format', 'error');
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  setStatus('Key saved ✓', 'ready');
  log('API key saved', 'success');
}

// ─── Fetch Songs from YT Music ────────────────────────────────────────────────
async function fetchSongs() {
  setStatus('FETCHING', 'loading');
  log('Fetching songs from page...');
  $('fetchBtn').disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('music.youtube.com')) {
      log('Please open YouTube Music first', 'error');
      setStatus('ERROR', 'error');
      $('fetchBtn').disabled = false;
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeSongs,
    });

    const scraped = results[0]?.result || [];

    if (!scraped.length) {
      log('No songs found. Go to music.youtube.com/playlist?list=LM', 'error');
      setStatus('ERROR', 'error');
      $('fetchBtn').disabled = false;
      return;
    }

    songs = scraped;
    await chrome.storage.local.set({ savedSongs: songs });
    renderSongsList();
    $('sortBtn').disabled = false;
    $('fetchNote').style.display = 'block';
    log(`✓ Loaded ${songs.length} songs`, 'success');
    setStatus('READY', 'ready');
  } catch (err) {
    log('Error: ' + err.message, 'error');
    setStatus('ERROR', 'error');
  }

  $('fetchBtn').disabled = false;
}

// Injected into page to scrape songs
function scrapeSongs() {
  const items = [];
  const seen = new Set();

  // Try multiple selector strategies for YT Music
  const rows = document.querySelectorAll(
    'ytmusic-responsive-list-item-renderer, ' +
    'ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer, ' +
    '[data-testid="song-row"]'
  );

  rows.forEach(row => {
    try {
      // Title
      const titleEl = row.querySelector(
        '.title, ' +
        'yt-formatted-string.title, ' +
        '[title].title, ' +
        '.primary-text yt-formatted-string'
      );
      const title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title');

      // Artist
      const artistEl = row.querySelector(
        '.secondary-flex-columns yt-formatted-string:first-child, ' +
        '.flex-columns .secondary-text, ' +
        'yt-formatted-string.byline'
      );
      const artist = artistEl?.textContent?.trim();

      // Album
      const albumEl = row.querySelector(
        '.secondary-flex-columns yt-formatted-string:nth-child(2)'
      );
      const album = albumEl?.textContent?.trim();

      // Thumbnail
      const img = row.querySelector('img');
      const thumb = img?.src || '';

      // Video ID from links
      const link = row.querySelector('a[href*="watch?v="]');
      const videoId = link?.href?.match(/v=([^&]+)/)?.[1] || '';

      const key = `${title}|||${artist}`;
      if (title && artist && !seen.has(key)) {
        seen.add(key);
        items.push({ title, artist, album: album || '', thumb, videoId });
      }
    } catch (_) {}
  });

  // Fallback: try generic approach
  if (!items.length) {
    document.querySelectorAll('a[href*="watch?v="]').forEach(a => {
      const videoId = a.href?.match(/v=([^&]+)/)?.[1];
      const title = a.textContent?.trim() || a.getAttribute('title') || 'Unknown';
      if (videoId && title && !seen.has(videoId)) {
        seen.add(videoId);
        items.push({ title, artist: 'Unknown', album: '', thumb: '', videoId });
      }
    });
  }

  return items;
}

// ─── Render Songs List ────────────────────────────────────────────────────────
function renderSongsList() {
  const preview = $('songsPreview');
  $('songsCount').innerHTML = `<strong>${songs.length}</strong> songs loaded`;

  if (!songs.length) {
    preview.innerHTML = '<div class="empty-state">No songs found</div>';
    return;
  }

  preview.innerHTML = songs.slice(0, 50).map(s => `
    <div class="song-item">
      ${s.thumb
        ? `<img class="song-thumb" src="${s.thumb}" alt="" />`
        : `<div class="song-thumb-placeholder">🎵</div>`
      }
      <div class="song-info">
        <div class="song-title">${esc(s.title)}</div>
        <div class="song-artist">${esc(s.artist)}${s.album ? ' · ' + esc(s.album) : ''}</div>
      </div>
    </div>
  `).join('') + (songs.length > 50 ? `<div class="song-item"><div class="song-artist" style="padding:4px 0">...and ${songs.length - 50} more</div></div>` : '');
}

// ─── Sort with AI ─────────────────────────────────────────────────────────────
async function sortSongs() {
  if (!songs.length) { log('Fetch songs first', 'error'); return; }

  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) { log('Enter your Claude API key first', 'error'); return; }

  setStatus('SORTING', 'loading');
  $('sortBtn').disabled = true;
  $('progressWrap').style.display = 'block';
  setProgress(5);
  log('Preparing AI sort...');

  const customText = $('customPrompt').value.trim();
  const prompt = buildPrompt(songs, sortMode, customText);

  try {
    log('Calling Claude AI...');
    setProgress(20);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a music curator AI. You analyze song lists and categorize them into meaningful playlists.
Always respond with ONLY valid JSON, no markdown, no explanation. The format must be:
{
  "playlists": [
    {
      "name": "Playlist Name",
      "emoji": "🎸",
      "description": "Short description",
      "songs": ["Song Title - Artist", ...]
    }
  ]
}`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    setProgress(60);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.content.map(b => b.text || '').join('');

    setProgress(80);
    log('Parsing results...');

    let parsed;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (_) {
      throw new Error('AI returned invalid JSON. Try again.');
    }

    playlists = parsed.playlists || [];
    setProgress(100);
    renderPlaylists(playlists);
    log(`✓ Created ${playlists.length} playlists!`, 'success');
    setStatus('DONE', 'ready');
    await chrome.storage.local.set({ lastPlaylists: playlists });

  } catch (err) {
    log('Error: ' + err.message, 'error');
    setStatus('ERROR', 'error');
  }

  $('sortBtn').disabled = false;
}

function buildPrompt(songs, mode, customText) {
  const list = songs.map((s, i) => `${i + 1}. "${s.title}" by ${s.artist}${s.album ? ` (${s.album})` : ''}`).join('\n');

  const modeInstructions = {
    genre: 'Sort these songs into playlists by MUSIC GENRE (e.g. Rock, Hip-Hop, Electronic, Jazz, Pop, R&B, Classical, Country, etc.). Create 4-8 genre playlists.',
    mood: 'Sort these songs into playlists by MOOD (e.g. Happy & Upbeat, Melancholic, Energetic, Chill & Relaxed, Romantic, Angry & Intense, etc.). Create 4-7 mood playlists.',
    decade: 'Sort these songs into playlists by DECADE (60s, 70s, 80s, 90s, 2000s, 2010s, 2020s). Based on when the song was released. Create one playlist per decade that has songs.',
    energy: 'Sort these songs into playlists by ENERGY LEVEL: High Energy (workout, dance), Medium Energy (focused work, casual listening), Low Energy (sleep, meditation, relaxation). Create 3-4 energy-level playlists.',
    language: 'Sort these songs into playlists by LANGUAGE / ORIGIN (English, Spanish, French, Korean/K-Pop, Japanese, Portuguese/Brazilian, etc.). Create one playlist per language group.',
    custom: customText || 'Sort these songs into logical, meaningful playlist categories of your choosing.',
  };

  return `${modeInstructions[mode] || modeInstructions.genre}

Here are the ${songs.length} liked songs to sort:

${list}

Important rules:
- Every song must go into exactly ONE playlist
- Playlist names should be catchy and descriptive
- Include a relevant emoji for each playlist
- Each playlist should have at least 2 songs (combine small groups)
- Use your best judgment based on artist/song names even without audio data
- Return ONLY the JSON, nothing else`;
}

// ─── Render Playlists ─────────────────────────────────────────────────────────
function renderPlaylists(pls) {
  $('resultsSection').style.display = 'block';
  const container = $('playlistsContainer');

  container.innerHTML = pls.map((pl, idx) => `
    <div class="playlist-card" id="plCard${idx}">
      <div class="playlist-header" onclick="togglePlaylist(${idx})">
        <div class="playlist-left">
          <div class="playlist-emoji">${pl.emoji || '🎵'}</div>
          <div>
            <div class="playlist-name">${esc(pl.name)}</div>
            <div class="playlist-count">${pl.songs.length} songs · ${esc(pl.description || '')}</div>
          </div>
        </div>
        <div class="playlist-right">
          <button class="create-btn" id="createBtn${idx}" onclick="event.stopPropagation(); createPlaylist(${idx})">
            + Create
          </button>
          <span class="chevron" id="chevron${idx}">▼</span>
        </div>
      </div>
      <div class="playlist-songs" id="plSongs${idx}">
        ${pl.songs.map(s => `<div class="pl-song">${esc(s)}</div>`).join('')}
      </div>
    </div>
  `).join('');
}

window.togglePlaylist = (idx) => {
  const songs = $(`plSongs${idx}`);
  const chevron = $(`chevron${idx}`);
  songs.classList.toggle('open');
  chevron.classList.toggle('open');
};

window.createPlaylist = async (idx) => {
  const pl = playlists[idx];
  const btn = $(`createBtn${idx}`);
  btn.textContent = '⏳';
  btn.disabled = true;

  // Send message to content script to create playlist on YT Music
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('music.youtube.com')) {
      log('Open YouTube Music to create playlists', 'error');
      btn.textContent = '+ Create';
      btn.disabled = false;
      return;
    }

    // Store the playlist data and open YT Music playlist creation
    await chrome.storage.local.set({ pendingPlaylist: pl });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: openCreatePlaylistDialog,
      args: [pl.name, pl.songs]
    });

    btn.textContent = '✓ Done';
    btn.classList.add('created');
    log(`Playlist "${pl.name}" creation initiated`, 'success');
  } catch (err) {
    log('Error: ' + err.message, 'error');
    btn.textContent = '+ Create';
    btn.disabled = false;
  }
};

// Injected into YT Music page to trigger playlist creation UI
function openCreatePlaylistDialog(playlistName, songs) {
  // Store songs in page context for the content script to use
  window.__ytSorterPendingPlaylist = { name: playlistName, songs };

  // Try to find and click the "New playlist" button
  const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-item, ytmusic-menu-navigation-item-renderer'));
  const newPlaylistBtn = buttons.find(b =>
    b.textContent?.toLowerCase().includes('new playlist') ||
    b.textContent?.toLowerCase().includes('create playlist')
  );

  if (newPlaylistBtn) {
    newPlaylistBtn.click();
    setTimeout(() => {
      const titleInput = document.querySelector('input[placeholder*="title"], input[placeholder*="name"], tp-yt-paper-input input');
      if (titleInput) {
        titleInput.value = playlistName;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 500);
  } else {
    // Navigate to library where playlists can be created
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 99999;
      background: #1c1c28; border: 1px solid #7c3aed; border-radius: 10px;
      padding: 14px 18px; color: #f0f0f8; font-family: monospace; font-size: 13px;
      max-width: 320px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;
    notification.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px; color:#7c3aed">🎵 YTMusic AI Sorter</div>
      <div style="margin-bottom:4px">Creating playlist: <strong>${playlistName}</strong></div>
      <div style="font-size:11px; color:#6b6b8a">${songs.length} songs will be added</div>
      <div style="font-size:11px; color:#f59e0b; margin-top:8px">⚠️ Please manually create the playlist on YT Music — full automation requires YTM API access.</div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 6000);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(text, type) {
  const pill = $('statusPill');
  pill.textContent = text;
  pill.className = 'status-pill ' + type;
}

function setProgress(pct) {
  $('progressBar').style.width = pct + '%';
}

function log(msg, type = '') {
  const el = $('logLine');
  el.textContent = msg;
  el.className = 'log-line ' + type;
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
