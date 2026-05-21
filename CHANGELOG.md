# Changelog

## v1.5.0

- Core code optimization across all modules — reduced memory footprint and faster execution paths
- Mapping system overhaul — output generation is now deterministic and deduplicated end-to-end
- Response time reduced by coalescing redundant IPC calls and deferring non-critical UI updates
- Fixed Lua syntax error (`+=` replaced with `= +`) in the Studio plugin preventing script runtime failure
- Fixed timer leak in `downloadAsset` — abort timer now always clears in a `finally` block
- Fixed duplicate error propagation in `runSpoofer` — removed extra `throw err` after `fail()` to prevent double renderer notifications
- Removed dead code (`listFails` function, unused `onUpdateAvailable` listener and preload export) across main and renderer processes
- Added defensive `try/catch` around group permission checks in the UI to prevent unhandled promise rejections
- Run history is now persisted as complete sessions — each run is stored with full transfer state, output, and summary for later inspection
- Session restoration loads the full queue state and report cards instead of just the mapping list
- Studio plugin now displays real-time connection status in a dedicated dock widget with themed UI colors
- Plugin auto-reconnects on app launch with exponential back-off and visual feedback on connection loss
- Connection stability improved — server now resets state atomically on reconnect and handles concurrent scan/replace requests safely
- Studio banner updates instantly on connect/disconnect with accurate place name and status dot color
- Scan progress now streams percentage and found count back to the app in real time via the local HTTP bridge
- Batch asset delivery fallback refined — chunk size adapts dynamically on failure, and single-asset retry uses all available place IDs
- Download concurrency auto-throttles when batch errors are detected to minimize further rate-limit hits
- All network timeouts, retry delays, and cooldown periods are now configurable through the Settings panel

## v1.4.7

- Removed Sound/audio spoofing mode — animation-only
- Removed audio quota display and Sound mode tab from the Run page
- Added Update button above Uninstall in the sidebar — checks GitHub releases on click and on startup
- Update button highlights in brand color when a newer version is available
- Added Update Plugin button in the Plugin tab — shown when an update is detected
- Scan now only covers Animation objects and LuaSourceContainer script sources (faster, no Sound lookups)
- Scan loop yields every 100 objects instead of 50 for lower Studio overhead
- Open Cloud API key placeholder updated to state Read & Write Assets permission requirement
- How to Use steps rewritten to reflect the full animation-only workflow end to end
- Release name in GitHub Actions now shows "Jonuffy Spoofer vX.X.X" instead of the tag only
- Release body now populated with the matching changelog section automatically
- Rewrote Studio integration: app now runs a local HTTP server on localhost:28476
- Plugin connects automatically on Studio launch — no manual pairing needed
- Scan results flow directly from Studio to the app over the local connection
- Send to Studio button pushes the output map back and triggers replacement instantly
- Plugin polls for scan requests and mappings, then confirms replace completion to the app
- Studio connection banner shown in the Run tab when a place is connected
- Scan button now sends a typed request (Animation or Audio) and waits for the plugin response
- Duplicate scan results are filtered automatically on arrival
- Rewrote plugin in Lua: unified asset scanner for Animation and Sound objects plus LuaSourceContainer sources
- Plugin detects asset type from new IDs and replaces Animation, Sound, and script sources in one pass
- Rewrote all backend modules: handler.js, roblox.js, connect.js, window.js, main.js, preload.js, builder.js
- Removed all module-level comments and dead code across the entire codebase
- Unified error handling and retry logic into shared utilities (retryAsync, retryWithCooldown, runWithConcurrency)
- Toggle system rewritten with setToggle/bindToggle — no more fragile class replacement
- History filter and search are now reactive — filter updates the queue list in real time
- Plugin page shows installed file path when plugin is already present (reinstall state)
- Textareas for asset IDs and output reduced in height for better layout balance
- Removed all border-radius and box shadows — fully flat white interface
- Standardized spacing, font sizes, and alignment across all pages
- Removed unused dependencies (axios, keytar) from package.json
- Removed macOS and Linux build configs — Windows portable only
- Discord webhook notification extracts changelog section automatically on release

## v1.0.2

- Fixed plugin installation not working
- Fixed job dependencies in release workflow
- Fixed Discord webhook JSON for notifications
- Updated Node.js to 24 in workflow
- Adjusted artifactName to generate files correctly
- Optimized build process for faster execution
- Electron app with Tailwind CSS UI
- Built-in update checker via GitHub releases API
- Deep uninstall from the sidebar
- Plugin tab: install the Studio plugin directly from the app
- Session recovery with resume support
- Sound mode toggle for audio spoofing
- Queue panel with live transfer progress per asset
- Run report with success, failure, and skip counts
- Advanced options: retry count, concurrency limits, place ID override
- Adaptive rate-limit handling with cooldown and automatic retry
- Asset history cache to skip already-mapped assets
- Fallback single-asset lookup when batch delivery fails
- Group upload support with permission checking
- GitHub Actions builds Windows portable EXE and Roblox Studio plugin
- Plugin bundled inside the EXE and installable from the Plugin tab
- Automatic release creation via CHANGELOG updates
