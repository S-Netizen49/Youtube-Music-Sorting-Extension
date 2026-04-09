// popup.js — YTMusic AI Sorter (Claude + Gemini)

const $ = id => document.getElementById(id);

// ─── State ────────────────────────────────────────────────────────────────────
let songs = [];
let playlists = {};
let sortMode = 'genre';
let activeModel = 'claude'; // 'claude' | 'gemini'

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { claudeKey, geminiKey, savedSongs, savedModel } = await chrome.storage.local.get([
    'claudeKey', 'geminiKey', 'savedSongs', 'savedModel'
  ]);

  if (claudeKey) $('claudeKeyInput').value = claudeKey;
  if (geminiKey) $('geminiKeyInput').value = geminiKey;

  if (savedModel) switchModel(savedModel);

  if (savedSongs && savedSongs.length) {
    songs = savedSongs;
    renderSongsList();
    $('sortBtn').disabled = false;
    $('fetchNote').style.display = 'block';
  }

  document.querySelectorAll('.model-tab').forEach(tab => {
    tab.addEventListener('click', () => switchModel(tab.dataset.model));
  });

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

  $('saveClaudeBtn').addEventListener('click', saveClaudeKey);
  $('saveGeminiBtn').addEventListener('click', saveGeminiKey);
  $('fetchBtn').addEventListener('click', fetchSongs);
  $('sortBtn').addEventListener('click', sortSongs);
});

// ─── Model Switch ─────────────────────────────────────────────────────────────
function switchModel(model) {
  activeModel = model;
  chrome.storage.local.set({ savedModel: model });

  document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.model-tab[data-model="${model}"]`)?.classList.add('active');

  $('claudeBlock').style.display = model === 'claude' ? 'block' : 'none';
  $('geminiBlock').style.display = model === 'gemini' ? 'block' : 'none';

  const dot = $('modelDot');
  const txt = $('modelIndicatorText');
  if (model === 'claude') {
    dot.className = 'model-dot';
    txt.textContent = 'Using Claude Sonnet';
  } else {
    dot.className = 'model-dot gemini';
    txt.textContent = 'Using Gemini 1.5 Flash';
  }
}

// ─── API Keys ─────────────────────────────────────────────────────────────────
async function saveClaudeKey() {
  const key = $('claudeKeyInput').value.trim();
  if (!key.startsWith('sk-ant-')) {
    log('Invalid Claude key (must start with sk-ant-)', 'error');
    return;
  }
  await chrome.storage.local.set({ claudeKey: key });
  log('Claude API key saved ✓', 'success');
}

async function saveGeminiKey() {
  const key = $('geminiKeyInput').value.trim();
  if (!key.startsWith('AIza')) {
    log('Invalid Gemini key (must start with AIza)', 'error');
    return;
  }
  await chrome.storage.local.set({ geminiKey: key });
  log('Gemini API key saved ✓', 'success');
}

// ─── Fetch Songs ──────────────────────────────────────────────────────────────
async function fetchSongs() {
  setStatus('FETCHING', 'loading');
  log('Auto-scrolling to load all songs...');
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
      func: autoScrollAndScrape,
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

async function autoScrollAndScrape() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getCount = () => document.querySelectorAll('ytmusic-responsive-list-item-renderer').length;

  let prevCount = 0;
  let stableRounds = 0;

  while (stableRounds < 3) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
    const newCount = getCount();
    if (newCount === prevCount) { stableRounds++; }
    else { stableRounds = 0; prevCount = newCount; }
  }

  const items = [];
  const seen = new Set();

  document.querySelectorAll('ytmusic-responsive-list-item-renderer').forEach(row => {
    try {
      const titleEl = row.querySelector('yt-formatted-string.title, .title, [title].title, .primary-text yt-formatted-string');
      const title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title');
      const artistEl = row.querySelector('.secondary-flex-columns yt-formatted-string:first-child, .flex-columns .secondary-text, yt-formatted-string.byline');
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

  window.scrollTo(0, 0);
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

  preview.innerHTML = songs.map(s => `
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
  `).join('');
}

// ─── Sort with AI ─────────────────────────────────────────────────────────────
async function sortSongs() {
  if (!songs.length) { log('Fetch songs first', 'error'); return; }

  const { claudeKey, geminiKey } = await chrome.storage.local.get(['claudeKey', 'geminiKey']);
  const key = activeModel === 'claude' ? claudeKey : geminiKey;

  if (!key) {
    log(`Enter your ${activeModel === 'claude' ? 'Claude' : 'Gemini'} API key first`, 'error');
    return;
  }

  setStatus('SORTING', 'loading');
  $('sortBtn').disabled = true;
  $('progressWrap').style.display = 'block';
  setProgress(5);

  const customText = $('customPrompt').value.trim();
  const prompt = buildPrompt(songs, sortMode, customText);

  try {
    let rawText;
    if (activeModel === 'claude') {
      rawText = await callClaude(key, prompt);
    } else {
      rawText = await callGemini(key, prompt);
    }

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

// ─── Claude API Call ──────────────────────────────────────────────────────────
async function callClaude(apiKey, prompt) {
  log('Calling Claude AI...');
  setProgress(20);

  const systemPrompt = `You are a music curator AI. Categorize songs into meaningful playlists.
Respond with ONLY valid JSON, no markdown, no explanation:
{"playlists":[{"name":"Playlist Name","emoji":"🎸","description":"Short description","songs":["Song Title - Artist"]}]}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  setProgress(60);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();
  return data.content.map(b => b.text || '').join('');
}

// ─── Gemini API Call ──────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  log('Calling Gemini AI...');
  setProgress(20);

  const systemPrompt = `You are a music curator AI. Categorize songs into meaningful playlists.
Respond with ONLY valid JSON, no markdown, no explanation:
{"playlists":[{"name":"Playlist Name","emoji":"🎸","description":"Short description","songs":["Song Title - Artist"]}]}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4000 }
      })
    }
  );

  setProgress(60);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Build Prompt ─────────────────────────────────────────────────────────────
function buildPrompt(songs, mode, customText) {
  const list = songs.map((s, i) => `${i + 1}. "${s.title}" by ${s.artist}${s.album ? ` (${s.album})` : ''}`).join('\n');

  const modeInstructions = {
    genre:    'Sort by MUSIC GENRE (Rock, Hip-Hop, Electronic, Jazz, Pop, R&B, Classical, etc.). Create 4-8 playlists.',
    mood:     'Sort by MOOD (Happy, Melancholic, Energetic, Chill, Romantic, Intense, etc.). Create 4-7 playlists.',
    decade:   'Sort by DECADE (60s, 70s, 80s, 90s, 2000s, 2010s, 2020s) based on release year. One playlist per decade.',
    energy:   'Sort by ENERGY LEVEL: High Energy (workout/dance), Medium Energy (focus/casual), Low Energy (sleep/chill). 3-4 playlists.',
    language: 'Sort by LANGUAGE/ORIGIN (English, Spanish, French, K-Pop, Japanese, Portuguese, etc.). One playlist per language.',
    custom:   customText || 'Sort into logical, meaningful categories of your choosing.',
  };

  return `${modeInstructions[mode] || modeInstructions.genre}

Here are the ${songs.length} liked songs to sort:

${list}

Rules:
- Every song goes into exactly ONE playlist
- Playlist names should be catchy and descriptive
- Include a relevant emoji for each playlist
- Each playlist needs at least 2 songs
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
  $(`plSongs${idx}`).classList.toggle('open');
  $(`chevron${idx}`).classList.toggle('open');
};

window.createPlaylist = async (idx) => {
  const pl = playlists[idx];
  const btn = $(`createBtn${idx}`);
  btn.textContent = '⏳';
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('music.youtube.com')) {
      log('Open YouTube Music to create playlists', 'error');
      btn.textContent = '+ Create';
      btn.disabled = false;
      return;
    }

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

function openCreatePlaylistDialog(playlistName, songs) {
  window.__ytSorterPendingPlaylist = { name: playlistName, songs };

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
    const notification = document.createElement('div');
    notification.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:99999;
      background:#1c1c28;border:1px solid #7c3aed;border-radius:10px;
      padding:14px 18px;color:#f0f0f8;font-family:monospace;font-size:13px;
      max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.4);
    `;
    notification.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:#7c3aed">🎵 YTMusic AI Sorter</div>
      <div style="margin-bottom:4px">Playlist: <strong>${playlistName}</strong></div>
      <div style="font-size:11px;color:#6b6b8a">${songs.length} songs to add</div>
      <div style="font-size:11px;color:#f59e0b;margin-top:8px">⚠️ Please create the playlist manually on YT Music.</div>
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

function setProgress(pct) { $('progressBar').style.width = pct + '%'; }

function log(msg, type = '') {
  const el = $('logLine');
  el.textContent = msg;
  el.className = 'log-line ' + type;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}