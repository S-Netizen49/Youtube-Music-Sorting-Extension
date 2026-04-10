// popup.js — YTMusic AI Sorter (Gemini + Ollama)

const $ = id => document.getElementById(id);

// ─── State ────────────────────────────────────────────────────────────────────
let songs = [];
let playlists = {};
let sortMode = 'genre';
let activeModel = 'gemini'; // 'gemini' | 'ollama'
const MAX_SONGS = 10;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { geminiKey, savedSongs, savedModel, lastPlaylists } = await chrome.storage.local.get([
    'geminiKey', 'savedSongs', 'savedModel', 'lastPlaylists'
  ]);

  if (geminiKey) $('geminiKeyInput').value = geminiKey;

  // Restore last used model (persists across popup close/reopen)
  if (savedModel) switchModel(savedModel);
  else switchModel('gemini');

  // Restore songs (persists across popup close/reopen)
  if (savedSongs && savedSongs.length) {
    songs = savedSongs;
    renderSongsList();
    $('sortBtn').disabled = false;
    $('fetchNote').style.display = 'block';
  }

  // Restore last playlists (persists across popup close/reopen)
  if (lastPlaylists && lastPlaylists.length) {
    playlists = lastPlaylists;
    renderPlaylists(playlists);
    $('resultsSection').style.display = 'block';
  }

  // Model tabs
  document.querySelectorAll('.model-tab').forEach(tab => {
    tab.addEventListener('click', () => switchModel(tab.dataset.model));
  });

  // Sort chips
  document.querySelectorAll('.sort-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.classList.contains('disabled')) return;
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

  $('saveGeminiBtn').addEventListener('click', saveGeminiKey);
  $('fetchBtn').addEventListener('click', fetchSongs);
  $('sortBtn').addEventListener('click', sortSongs);
  $('testOllamaBtn').addEventListener('click', testOllama);
});

// ─── Model Switch ─────────────────────────────────────────────────────────────
function switchModel(model) {
  activeModel = model;
  chrome.storage.local.set({ savedModel: model });

  document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.model-tab[data-model="${model}"]`)?.classList.add('active');

  $('geminiBlock').style.display = model === 'gemini' ? 'block' : 'none';
  $('ollamaBlock').style.display = model === 'ollama' ? 'block' : 'none';

  const dot = $('modelDot');
  const txt = $('modelIndicatorText');
  if (model === 'gemini') {
    dot.className = 'model-dot gemini';
    txt.textContent = 'Using Gemini 2.5 Flash';
  } else {
    dot.className = 'model-dot ollama';
    txt.textContent = 'Using Ollama (local)';
  }

  // Ollama = genre only; Gemini = all modes
  updateSortChips(model);
}

function updateSortChips(model) {
  document.querySelectorAll('.sort-chip').forEach(chip => {
    const mode = chip.dataset.mode;
    if (model === 'ollama' && mode !== 'genre') {
      chip.classList.add('disabled');
      chip.classList.remove('active');
      chip.title = 'Only available with Gemini';
    } else {
      chip.classList.remove('disabled');
      chip.title = '';
    }
  });

  // Force genre when switching to Ollama
  if (model === 'ollama') {
    sortMode = 'genre';
    document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.sort-chip[data-mode="genre"]')?.classList.add('active');
    $('customPrompt').style.opacity = '0.4';
    $('customPrompt').disabled = true;
  }
}

// ─── API Key ──────────────────────────────────────────────────────────────────
async function saveGeminiKey() {
  const key = $('geminiKeyInput').value.trim();
  if (!key.startsWith('AIza')) {
    log('Invalid Gemini key (must start with AIza)', 'error');
    return;
  }
  await chrome.storage.local.set({ geminiKey: key });
  log('Gemini API key saved ✓', 'success');
}

// ─── Test Ollama ──────────────────────────────────────────────────────────────
async function testOllama() {
  const btn = $('testOllamaBtn');
  btn.textContent = 'Testing...';
  btn.disabled = true;
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = data.models?.map(m => m.name) || [];
    if (!models.length) {
      log('Ollama running but no models installed. Run: ollama pull llama3.2', 'error');
      $('ollamaStatus').textContent = '⚠ No models';
      $('ollamaStatus').className = 'ollama-status err';
    } else {
      log(`✓ Ollama ready! Available: ${models.join(', ')}`, 'success');
      $('ollamaStatus').textContent = `✓ ${models[0]}`;
      $('ollamaStatus').className = 'ollama-status ok';
    }
  } catch (e) {
    log(`Cannot reach Ollama (${e.message}). Run: OLLAMA_ORIGINS="chrome-extension://*" ollama serve`, 'error');
    $('ollamaStatus').textContent = '✗ Not connected';
    $('ollamaStatus').className = 'ollama-status err';
  }
  btn.textContent = 'Test Connection';
  btn.disabled = false;
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
      args: [MAX_SONGS], // pass limit into the isolated page context
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

// Injected into page — auto-scrolls then scrapes up to MAX_SONGS
async function autoScrollAndScrape(maxSongs) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getCount = () => document.querySelectorAll('ytmusic-responsive-list-item-renderer').length;

  let prevCount = 0, stableRounds = 0;
  while (stableRounds < 3) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
    const newCount = getCount();
    if (newCount === prevCount) stableRounds++;
    else { stableRounds = 0; prevCount = newCount; }
  }

  const items = [], seen = new Set();

  for (const row of document.querySelectorAll('ytmusic-responsive-list-item-renderer')) {
    if (items.length >= maxSongs) break;

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
  }

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
        : `<div class="song-thumb-placeholder">🎵</div>`}
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

  setStatus('SORTING', 'loading');
  $('sortBtn').disabled = true;
  $('progressWrap').style.display = 'block';
  setProgress(5);

  const customText = $('customPrompt').value.trim();
  // Limit songs sent to Ollama — CPU inference is slow, keep it short
  const songSubset = activeModel === 'ollama' ? songs.slice(0, 10) : songs;
  if (activeModel === 'ollama') log(`Sending ${songSubset.length} songs to Ollama (CPU mode)...`);
  const prompt = buildPrompt(songSubset, sortMode, customText);

  try {
    let rawText;

    if (activeModel === 'gemini') {
      const { geminiKey } = await chrome.storage.local.get('geminiKey');
      if (!geminiKey) { log('Enter your Gemini API key first', 'error'); $('sortBtn').disabled = false; return; }
      try {
        rawText = await callGemini(geminiKey, prompt);
      } catch (geminiErr) {
        log(`Gemini failed (${geminiErr.message}) — falling back to Ollama...`, 'error');
        setProgress(10);
        rawText = await callOllama(prompt);
      }
    } else {
      rawText = await callOllama(prompt);
    }

    setProgress(80);
    log('Parsing results...');

    let parsed;
    try {
      // Extract first JSON object — handles models that add extra text
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in AI response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.log('RAW AI OUTPUT:', rawText);
      throw new Error('AI returned invalid JSON. Try again.');
    }

    playlists = parsed.playlists || [];
    setProgress(100);
    renderPlaylists(playlists);
    log(`✓ Created ${playlists.length} playlists!`, 'success');
    setStatus('DONE', 'ready');
    // Persist playlists so they survive popup close/reopen
    await chrome.storage.local.set({ lastPlaylists: playlists });

  } catch (err) {
    log('Error: ' + err.message, 'error');
    setStatus('ERROR', 'error');
  }

  $('sortBtn').disabled = false;
}

// ─── Gemini API ───────────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  log('Calling Gemini AI...');
  setProgress(20);

  const systemPrompt = `You are a music curator AI. Categorize songs into meaningful playlists.
Respond with ONLY valid JSON, no markdown, no explanation:
{"playlists":[{"name":"Playlist Name","emoji":"🎸","description":"Short description","songs":["Song Title - Artist"]}]}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Gemini error ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Ollama API ───────────────────────────────────────────────────────────────
async function callOllama(prompt) {
  log('Calling Ollama (local)...');
  setProgress(20);

  // Fetch available models and use the exact name (e.g. "llama3.2:latest")
  let model = null;
  let available = [];
  try {
    const tagsRes = await fetch('http://localhost:11434/api/tags');
    if (!tagsRes.ok) throw new Error('tags fetch failed');
    const tags = await tagsRes.json();
    available = tags.models?.map(m => m.name) || [];
  } catch {
    throw new Error('Ollama not running. Start it with: ollama serve');
  }

  if (!available.length) {
    throw new Error('No models installed. Run: ollama pull llama3.2');
  }

  // Pick best available model by prefix match against full name
  const preferred = ['llama3.1', 'llama3.2', 'llama3', 'mistral', 'gemma2', 'gemma', 'phi3', 'phi'];
  model = preferred
    .map(p => available.find(a => a.startsWith(p)))
    .find(Boolean) || available[0];

  log(`Ollama using: ${model}`);
  setProgress(30);

  const systemPrompt = `You are a music genre classifier. Given a list of songs, sort them into genre-based playlists.
Respond with ONLY valid JSON. No explanation, no markdown. Format:
{"playlists":[{"name":"Genre Name","emoji":"🎸","description":"Short description","songs":["Song Title - Artist"]}]}`;

  // Use /api/chat — more reliable across Ollama versions than /api/generate
  // Long timeout needed — CPU inference on local models can take several minutes
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min

  let res;
  try {
    res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.3, num_predict: 2048 }, // reduced for speed
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: prompt }
        ]
      })
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Ollama timed out after 5 min. Try fewer songs or a smaller model.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  setProgress(70);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.message?.content || '';
}

// ─── Build Prompt ─────────────────────────────────────────────────────────────
function buildPrompt(songs, mode, customText) {
  const list = songs.map((s, i) =>
    `${i + 1}. "${s.title}" by ${s.artist}${s.album ? ` (${s.album})` : ''}`
  ).join('\n');

  const modeInstructions = {
    genre:    'Sort by MUSIC GENRE (Rock, Hip-Hop, Electronic, Jazz, Pop, R&B, Classical, Country, Metal, etc.). Create 4-8 genre playlists.',
    mood:     'Sort by MOOD (Happy, Melancholic, Energetic, Chill, Romantic, Intense, etc.). Create 4-7 playlists.',
    decade:   'Sort by DECADE (60s, 70s, 80s, 90s, 2000s, 2010s, 2020s) based on release year. One playlist per decade.',
    energy:   'Sort by ENERGY LEVEL: High Energy (workout/dance), Medium Energy (focus/casual), Low Energy (sleep/chill). 3-4 playlists.',
    language: 'Sort by LANGUAGE/ORIGIN (English, Spanish, French, K-Pop, Japanese, Portuguese, etc.). One playlist per language.',
    custom:   customText || 'Sort into logical, meaningful categories of your choosing.',
  };

  return `${modeInstructions[mode] || modeInstructions.genre}

Here are the ${songs.length} songs to sort:

${list}

Rules:
- Every song goes into exactly ONE playlist
- Playlist names should be catchy and descriptive
- Include a relevant emoji per playlist
- Each playlist needs at least 2 songs
- Return ONLY the JSON, nothing else`;
}

// ─── Render Playlists ─────────────────────────────────────────────────────────
function renderPlaylists(pls) {
  $('resultsSection').style.display = 'block';

  // No inline onclick attributes — Chrome extension CSP blocks them
  $('playlistsContainer').innerHTML = pls.map((pl, idx) => `
    <div class="playlist-card" id="plCard${idx}">
      <div class="playlist-header" id="plHeader${idx}">
        <div class="playlist-left">
          <div class="playlist-emoji">${pl.emoji || '\u{1F3B5}'}</div>
          <div>
            <div class="playlist-name">${esc(pl.name)}</div>
            <div class="playlist-count">${pl.songs.length} songs · ${esc(pl.description || '')}</div>
          </div>
        </div>
        <div class="playlist-right">
          <button class="create-btn" id="createBtn${idx}">+ Create</button>
          <span class="chevron" id="chevron${idx}">\u25BC</span>
        </div>
      </div>
      <div class="playlist-songs" id="plSongs${idx}">
        ${pl.songs.map(s => `<div class="pl-song">${esc(s)}</div>`).join('')}
      </div>
    </div>
  `).join('');

  // Attach listeners after DOM is built — the CSP-safe way
  pls.forEach((_, idx) => {
    $(`plHeader${idx}`).addEventListener('click', () => {
      $(`plSongs${idx}`).classList.toggle('open');
      $(`chevron${idx}`).classList.toggle('open');
    });
    $(`createBtn${idx}`).addEventListener('click', (e) => {
      e.stopPropagation();
      createPlaylist(idx);
    });
  });
}

async function createPlaylist(idx) {
  const pl = playlists[idx];
  const btn = $(`createBtn${idx}`);
  btn.textContent = '⏳'; btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('music.youtube.com')) {
      log('Open YouTube Music to create playlists', 'error');
      btn.textContent = '+ Create'; btn.disabled = false; return;
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
    btn.textContent = '+ Create'; btn.disabled = false;
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
      const input = document.querySelector('input[placeholder*="title"], input[placeholder*="name"], tp-yt-paper-input input');
      if (input) { input.value = playlistName; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }, 500);
  } else {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;background:#1c1c28;border:1px solid #7c3aed;border-radius:10px;padding:14px 18px;color:#f0f0f8;font-family:monospace;font-size:13px;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.4)`;
    n.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:#7c3aed">🎵 YTMusic AI Sorter</div>
      <div style="margin-bottom:4px">Playlist: <strong>${playlistName}</strong></div>
      <div style="font-size:11px;color:#6b6b8a">${songs.length} songs to add</div>
      <div style="font-size:11px;color:#f59e0b;margin-top:8px">⚠️ Please create the playlist manually on YT Music.</div>
    `;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 6000);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(text, type) { const p = $('statusPill'); p.textContent = text; p.className = 'status-pill ' + type; }
function setProgress(pct) { $('progressBar').style.width = pct + '%'; }
function log(msg, type = '') { const el = $('logLine'); el.textContent = msg; el.className = 'log-line ' + type; }
function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }