# Changelog

## v1.6.2

- Fixed every run failing instantly with "Cannot access 'abortSignal' before initialization", introduced in 1.6.1 by declaring the abort signal after the download options that consume it
- Added a pipeline smoke test that executes a run end to end through the Studio check, which catches this class of initialization error before release
- Rewrote the update installer to run completely hidden through a Windows Script Host launcher, eliminating the stray console windows that appeared during an update and could hang under Windows Terminal on Windows 11
- Replaced the fragile `tasklist`/`findstr` process wait with `Wait-Process`, which previously could loop forever when the process id happened to match unrelated output
- The executable swap now retries for up to twenty seconds to ride out the brief file lock held by the portable launcher during shutdown
- Removed the interactive failure prompt that left a window open; update errors are now written to `updates/update.log`
- Installer helper scripts delete themselves after finishing

## v1.6.1

- The Upload Concurrency setting is now honored — uploads run through an independent limiter instead of silently inheriting the download concurrency
- Stop now aborts in-flight downloads and uploads immediately and cancels pending retries and cooldowns, rather than only halting new work
- Aborted transfers no longer count as failures, and the run ends with a clear "Stopped" status
- Extended the unit test suite to cover the concurrency limiter

## v1.6.0

- Rebuilt the Studio connection layer around a heartbeat instead of raw socket state, eliminating the constant connect/disconnect flicker
- Fixed the local server returning HTTP 500 on every poll, which forced the plugin to drop and reconnect every two seconds
- Connection is now considered lost only after three consecutive missed polls, and a poll from a plugin the app lost track of silently restores the session
- Connection status changes are emitted only on real transitions, so the banner no longer thrashes during reconnects
- Enforced a single running instance; launching the app again focuses the existing window instead of contending for the local port
- Local server recovers automatically if the port is briefly held during a restart
- Fixed auto-update that reported success without replacing anything: the downloader now follows GitHub's asset redirect instead of saving an empty response as the installer
- Fixed the installer overwriting the temporary extracted build rather than the real portable executable, so updates now persist after restart and no longer reopen a stale window
- Downloads stream to disk and complete only once fully flushed; non-success responses are treated as failures
- Downloaded installer is validated by size and executable header before it is applied, and rejected if incomplete or corrupted
- Install step retries while the executable is briefly locked during shutdown
- Update check surfaces a clear error when the release feed is unreachable instead of silently reporting up to date
- Update download now shows live transfer speed alongside the progress bar
- Update installer is now verified against a SHA-256 checksum published with each release and rejected on mismatch
- Releases now publish a `SHA256SUMS.txt` asset generated during the build
- Place ID override is functional again and takes priority when resolving asset download locations
- Removed the dead session-persistence layer, the unused audio upload path, the redundant place-id parser branch, and the duplicated version and release-check logic
- Added a unit test suite (`npm test`) covering version comparison, cookie parsing, asset parsing, error classification, and checksum handling

## v1.5.7

- Fixed Studio connection endlessly flipping between connected and disconnected
- Fixed `ReferenceError` on every `/poll` request caused by assigning to an undeclared `lastHeartbeat` under strict mode, which made the local server return HTTP 500 and forced the plugin to drop and reconnect every 2 seconds
- Reverted the v1.5.5 socket-close disconnection detection, which fired instantly because `HttpService:RequestAsync` opens a fresh non-persistent socket per request and closes it right after each response
- Reintroduced heartbeat-based connection tracking: each `/poll` refreshes the heartbeat and a monitor only marks the plugin disconnected after roughly three missed polls (~7s)
- `connected` status update now fires only on real state transitions instead of on every reconnect attempt
- A `/poll` arriving without an active connection is now treated as an implicit reconnect so the app recovers automatically
- Heartbeat monitor timer is unref'd so it never keeps the process alive on its own
- Fixed auto-update reporting success without actually updating; the downloader now follows GitHub's 302 redirect to `objects.githubusercontent.com` instead of saving the empty redirect response as the installer
- Fixed the update installer overwriting the temporary extracted executable instead of the real portable launcher; it now targets `PORTABLE_EXECUTABLE_FILE`, so the update persists after restart and no longer relaunches into a stale window
- Download now streams to disk and resolves only after the file is fully flushed, with non-200 responses treated as failures
- Downloaded installer is size-validated against the release asset before applying; a truncated or corrupted download is rejected instead of installed
- Update batch script retries the copy up to ten times to handle the brief file lock during portable shutdown

## v1.5.6

- Update script now uses temp directory for batch file instead of app directory
- Update verification checks if update file exists before applying
- Replaced `move` with `copy` command for cross-partition compatibility
- Added error handling in batch script with user notification on failure
- Added errorlevel check after copy operation
- Download handler deletes previous update file before downloading new version
- Apply update handler wrapped in try-catch for proper error reporting

## v1.5.5

- Studio plugin now auto-connects on load with 10 retry attempts
- Auto-reconnect triggers when widget is opened if not already connected
- Poll loop automatically attempts reconnection on connection failure
- Disconnection detection now uses socket close event for instant detection
- Removed heartbeat polling in favor of native socket event handling
- Scan state tracking prevents concurrent scan requests (returns 409 if scan in progress)
- New `/cancel-scan` endpoint allows cancelling active scans
- Stop button now pauses processing and cancels active scans
- Scan handler respects cancellation status and terminates gracefully
- Manual connection button remains as fallback only
- Fixed undefined variable error in download retry configuration

## v1.5.2

- Run page redesigned into a single unified card with a live log, group selector, and Run Spoofer button
- Scan and run are now one continuous flow; clicking Run Spoofer immediately begins scanning, downloading, and uploading with no separate steps
- Animations are processed incrementally as they are discovered, so each asset starts downloading and uploading before the scan finishes
- Live log displays each stage in real time as it happens
- Output mappings section removed; mappings are handled internally and sent to Studio automatically
- Progress bar shows a done/total count during runs without a percentage label
- Animations already owned by the upload target are detected by creator ID and skipped entirely
- Cache keys are now identity-scoped to `user:<userId>` or `group:<groupId>` to prevent cross-account collisions
- Animations already present in local history are excluded from the processing queue at scan time
- Run history and session persistence removed from the UI; each run is stateless for simplicity
- All files rewritten from scratch with camelCase throughout and no dead code or comments
- Nav buttons, IPC channels, and internal API identifiers shortened and unified to camelCase
- `window.js` exports renamed to `getWin` and `setupAppLifecycle` to align with handler and main imports
- `main.js` wires the scan handler via an internal `_setScanHandler` bridge so Studio scan events feed the pipeline directly
- `handler.js` processes each entry end-to-end as a single atomic unit: location lookup, download, upload, and cache write
- Batch asset delivery fetches place IDs per creator key and falls back to single-asset lookup on failure
- `downloadAsset` and `uploadAsset` in `roblox.js` simplified to return a plain result object with no transfer ID coupling
- Rate-limit state is module-scoped and shared across all upload calls
- `runWithConcurrency` used as the single shared utility for both the scan processing loop and upload batching
- Temp directory is cleared once before the pipeline starts and once after it completes
- Group permission check fires on group select change and shows an inline warning without blocking other controls
- Settings now stored under `jonuffy.cfg.v2` to avoid stale value conflicts with prior versions
- Tailwind config trimmed to only the tokens used in markup
- Lucide icons re-initialized after any dynamic button content change
- `preload.js` API unified; all renderer events use `window.api.on(event, cb)` with no per-channel duplicates
- `connect.js` rewritten as a minimal HTTP server
- `handler.js` runs the processing loop concurrently with the Studio scan so entries are picked up as they arrive
- `roblox.js` cleaned of unused exports
- `plugin.lua` rewritten with a single polling loop that fetches scan requests and delivers incremental results as each animation is found
- Studio widget now opens only on toolbar button click
- Download timeout increased from 15s to 30s with 3 retries and 3s base delay plus jitter
- `runWithConcurrency` now staggers each worker by 80–200ms to prevent synchronized bursts
- `getPlaceIds` pagination now pauses 500ms between pages to avoid rate limits
- Pipeline worker entry now waits 100–250ms before processing each asset
- 250ms cooldown added after each successful upload before advancing to the next asset
- Studio plugin scan now batches scan results in groups of 10 instead of sending one HTTP request per found asset
- Asset delivery batch request timeout increased from 10s to 15s
- Dark theme toggle added under Settings → App; persisted in `jonuffy.cfg.v2`
- Full dark-mode CSS override layer added for all UI surfaces, modals, inputs, and status indicators
- Theme class applied before first paint to prevent white flash on startup
- Auto-update flow: checks GitHub releases, downloads the portable `.exe` asset in-app with live progress bar
- Update installer uses a self-deleting batch script to swap executables after the app closes; no external installer
- New modal for update download and install with cancel and restart actions

## v1.5.0

- Core code optimized across all modules for reduced memory usage and faster execution
- Mapping output is now deterministic and deduplicated end-to-end
- Redundant IPC calls coalesced and non-critical UI updates deferred to improve response time
- Fixed a Lua syntax error in the Studio plugin that prevented the script from running
- Fixed a timer leak in `downloadAsset` where the abort timer was not always cleared
- Fixed duplicate error propagation in `runSpoofer` that caused double renderer notifications
- Removed dead code including the `listFails` function and an unused `onUpdateAvailable` listener across main and renderer processes
- Added defensive error handling around group permission checks to prevent unhandled promise rejections
- Run history now persists complete sessions with full transfer state, output, and summary
- Session restoration loads the full queue state and report cards
- Studio plugin shows real-time connection status in a dock widget with theme-aware colors
- Plugin auto-reconnects on app launch with visual feedback on connection loss
- Server resets state atomically on reconnect and handles concurrent scan and replace requests safely
- Studio banner updates immediately on connect and disconnect with accurate place name and status color
- Scan progress streams percentage and found count back to the app in real time
- Batch delivery fallback refined; chunk size adapts on failure and single-asset retry cycles through all available place IDs
- Download concurrency throttles automatically when batch errors are detected
- All network timeouts, retry delays, and cooldown periods are configurable in Settings

## v1.4.7

- Removed audio spoofing mode; the tool is now animation-only
- Added an Update button in the sidebar that checks GitHub releases on click and on startup
- Update button highlights when a newer version is available
- Scan now covers only Animation objects and LuaSourceContainer script sources for lower Studio overhead
- Scan loop yields every 100 objects instead of 50
- Studio integration rewritten; the app now runs a local HTTP server on port 28476
- Plugin connects automatically on Studio launch with no manual pairing
- Scan results flow from Studio to the app over the local connection
- Plugin polls for scan requests and mappings and confirms replace completion back to the app
- Studio connection banner shown in the Run tab when a place is connected
- Duplicate scan results filtered automatically on arrival
- Plugin rewritten in Lua as a unified scanner for Animation objects and LuaSourceContainer sources
- All backend modules rewritten: handler.js, roblox.js, connect.js, window.js, main.js, preload.js, builder.js
- Dead code and all module-level comments removed across the codebase
- Error handling and retry logic unified into shared utilities
- Toggle system rewritten for reliability
- History filter and search update the queue list reactively
- Plugin page shows the installed file path when the plugin is already present
- Fully flat interface with standardized spacing and font sizes across all pages
- Unused dependencies removed from package.json
- Build limited to Windows portable only
- Discord webhook notification extracts the matching changelog section automatically on release

## v1.0.2

- Fixed plugin installation not working
- Fixed job dependencies in the release workflow
- Fixed Discord webhook JSON for notifications
- Updated Node.js to 24 in the workflow
- Corrected artifact naming to generate files properly
- Electron app with Tailwind CSS UI
- Built-in update checker via GitHub releases API
- Deep uninstall option in the sidebar
- Plugin tab for installing the Studio plugin directly from the app
- Session recovery with resume support
- Queue panel with live transfer progress per asset
- Run report with success, failure, and skip counts
- Advanced options including retry count, concurrency limits, and place ID override
- Adaptive rate-limit handling with cooldown and automatic retry
- Asset history cache to skip already-mapped assets
- Fallback single-asset lookup when batch delivery fails
- Group upload support with permission checking
- GitHub Actions builds the Windows portable EXE and Studio plugin
- Plugin bundled inside the EXE and installable from the Plugin tab
- Automatic release creation triggered by CHANGELOG updates
