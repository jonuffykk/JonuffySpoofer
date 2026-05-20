# Jonuffy Spoofer

Desktop utility for re-uploading animation assets on Roblox. Connects directly to Roblox Studio via a local plugin to scan, spoof, and replace animation IDs — all without leaving the app.

[![Latest Release](https://img.shields.io/github/v/release/jonuffykk/JonuffySpoofer)](https://github.com/jonuffykk/JonuffySpoofer/releases/latest)
[![Discord](https://img.shields.io/discord/128880573?label=Discord&color=5865F2)](https://discord.gg/CNSZssFz23)

## Download

[github.com/jonuffykk/JonuffySpoofer/releases](https://github.com/jonuffykk/JonuffySpoofer/releases/latest)

Windows portable — no installation required.

## Usage

1. Open the app → go to **Credentials** and paste your `.ROBLOSECURITY` cookie and an Open Cloud API key with **Read & Write Assets** permission
2. Go to **Plugin** → click **Install Plugin** — copies automatically to your Roblox Studio plugins folder. Restart Studio if already open.
3. Go to **Run** → click **Scan Animations** — the plugin scans all Animation objects and script sources in your place
4. Click **Run Spoofer** — assets are downloaded and re-uploaded to your account or group via Open Cloud
5. Click **Send to Studio** — the plugin replaces all old IDs in the place instantly

## Features

- Live Studio connection via local server — scan and replace without copy-pasting
- Animation spoofing via Roblox Open Cloud API
- Scans Animation objects and LuaSourceContainer script sources for complete coverage
- Auto-update check on startup — Update button in sidebar highlights when a new version is available
- Group upload support with real-time permission checking
- Configurable concurrency, retry limits, retry delay, and Place ID override
- Asset history cache — already-mapped assets are skipped automatically
- Session auto-save and resume for interrupted runs
- Transfer log with live progress per asset (download + upload)
- Run report with total, downloaded, uploaded, cached, skipped, and failure counts
- Failure categorization: invalid cookie, API key issues, rate limits, network errors
- Adaptive rate-limit handling with per-asset cooldown and automatic retry
- Batch asset delivery with single-asset fallback when batch fails
- Download-only mode for saving assets without re-uploading
- One-click plugin install, reinstall, and update directly from the app

## Links

- [Discord](https://discord.gg/qMrJHxnS9T)
- [Roblox Profile](https://www.roblox.com/users/228880573/profile)
- [GitHub](https://github.com/jonuffykk)

## Tech

Electron · Tailwind CSS · Roblox Open Cloud API · Lua plugin
