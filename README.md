# Jonuffy Spoofer

A desktop utility for Roblox creators who want to swap animation and audio assets inside their experiences. Jonuffy Spoofer handles uploading replacements through Roblox Open Cloud and provides a Roblox Studio plugin to apply the new IDs across your place.

Inspired by ISpooferMotion.

## What it does

- Detects your active Roblox session or accepts a cookie manually.
- Uploads animations and sounds to your inventory or a group via Open Cloud.
- Generates a clean map of old ID → new ID.
- Installs a Roblox Studio plugin directly from the app (Plugin tab).
- Scans and replaces every matching asset ID across your place in Studio.

## Getting started

1. Download `JonuffySpoofer-v*.exe` from [Releases](https://github.com/jonuffykk/JonuffySpoofer/releases).
2. Run the app and authenticate (auto-detect or paste your `.ROBLOSECURITY` cookie).
3. Go to the **Plugin** tab and click **Install Plugin** — no manual download needed.
4. Restart Roblox Studio, open the **Spoofer** toolbar button, and use **Scan IDs** to collect assets.
5. Paste the list into the app, set your upload target, and press **Run Spoofer**.
6. Copy the output map back into Studio's **Replace IDs** tab and click **Run**.

## Features

- Animation and audio upload through Roblox Open Cloud API.
- Group upload support with permission checking.
- Built-in queue, run report, and session recovery if the app closes mid-run.
- One-click plugin install and update directly from the Plugin tab.
- Built-in update checker via GitHub releases.
- Adjustable retry count, concurrency limits, and place ID override.
- Asset history cache to skip already-mapped assets.

## Releases

Each release publishes multiple artifacts:

- `JonuffySpoofer-v*.exe` — portable Windows app (plugin bundled inside).
- `JonuffySpoofer-v*.rbxmx` — standalone Studio plugin for manual install.

## Tech stack

- Electron
- Tailwind CSS
- Roblox Open Cloud API

## Author

Jonuffy — [github.com/jonuffykk](https://github.com/jonuffykk)

⭐ _Se este projeto poupou seu tempo e ajudou no desenvolvimento do seu jogo, considere deixar uma estrela!_
