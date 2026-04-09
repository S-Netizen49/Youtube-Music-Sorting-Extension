# 🎵 YTMusic AI Sorter — Chrome Extension MVP

Sort your YouTube Music liked songs into smart playlists using Claude AI.

## Features

- **Fetch** all songs from your YT Music Liked playlist
- **Sort** them using AI into categories: Genre, Mood, Decade, Energy, Language, or Custom
- **Preview** the generated playlists with song lists
- **Initiate** playlist creation on YouTube Music

## Installation (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer Mode** (top right toggle)
3. Click **"Load unpacked"**
4. Select this folder (`yt-music-sorter/`)
5. The extension icon will appear in your toolbar

## How to Use

### Step 1 — Get a Claude API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key (starts with `sk-ant-`)
3. Paste it in the extension popup and click **Save**

### Step 2 — Load Your Liked Songs
1. Go to [music.youtube.com/playlist?list=LM](https://music.youtube.com/playlist?list=LM)
2. **Scroll down** to load all your songs (YT Music uses infinite scroll)
3. Open the extension popup and click **"Fetch Songs"**

### Step 3 — Sort with AI
1. Choose a sorting mode: Genre, Mood, Decade, Energy, Language, or write a Custom prompt
2. Click **"✨ Sort with AI"**
3. Wait for Claude to analyze and categorize your songs (~10–20 seconds)

### Step 4 — Create Playlists
1. Review the generated playlists and expand them to see songs
2. Click **"+ Create"** on any playlist
3. Follow the on-page instructions to create the playlist manually on YT Music

## Sorting Modes

| Mode | Description |
|------|-------------|
| 🎸 Genre | Rock, Hip-Hop, Electronic, Jazz, Pop, etc. |
| 😊 Mood | Happy, Melancholic, Energetic, Chill, etc. |
| 📅 Decade | 60s, 70s, 80s, 90s, 2000s, 2010s, 2020s |
| ⚡ Energy | High / Medium / Low energy levels |
| 🌍 Language | Group by song language/origin |
| ✏️ Custom | Write your own sorting instructions |

## Limitations (MVP)

- **Manual playlist creation**: YT Music doesn't have a public API for creating playlists, so the extension shows you what to create and gives step-by-step instructions. Full automation would require OAuth and the YouTube Data API.
- **Infinite scroll**: You need to manually scroll down your Liked playlist to load all songs before fetching.
- **AI accuracy**: Claude categorizes based on artist/song names only (no audio analysis).

## Future Improvements

- [ ] YouTube Data API v3 integration for automatic playlist creation
- [ ] OAuth login to use the YT API on your behalf
- [ ] Batch song adding to playlists
- [ ] Export playlist to Spotify
- [ ] Re-sort existing playlists
- [ ] Auto-scroll to load all liked songs

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JS (no build step needed)
- Claude API (`claude-sonnet-4-20250514`) for AI categorization
- YouTube Music DOM scraping for song extraction

## File Structure

```
yt-music-sorter/
├── manifest.json       # Extension configuration
├── popup.html          # Extension popup UI
├── src/
│   ├── popup.js        # Popup logic + AI calls
│   ├── content.js      # YT Music page scraper
│   └── background.js   # Service worker
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
