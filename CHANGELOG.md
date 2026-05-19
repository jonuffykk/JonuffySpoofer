# Changelog

## v1.0.2
- Fixed plugin installation not working

## v1.0.1

- Fixed job dependencies in release workflow
- Fixed Discord webhook JSON for notifications
- Updated Node.js to 24 in workflow
- Adjusted artifactName to generate files correctly
- Optimized build process for faster execution

## v1.0.0

- Electron app with Tailwind CSS UI and smooth animations
- Auto-detect Roblox cookie from Roblox Studio on Windows
- Built-in update checker via GitHub releases API
- Deep uninstall from the sidebar
- Plugin tab: install the Studio plugin directly from the app with one click
- Session recovery banner with resume and discard options
- Sound mode toggle for audio spoofing workflows
- Queue panel with live transfer progress for each asset
- Run report with success, failure, and skip counts
- One-click output copy and clipboard paste for asset input
- Advanced options: retry count, concurrency limits, and place ID override
- Real-time download and upload progress per asset
- Adaptive rate-limit handling with cooldown and automatic retry
- Asset history cache to skip already-mapped assets
- Fallback single-asset lookup when batch delivery fails
- Detailed failure categorization with full run report
- Group upload support with permission checking
- Custom toolbar button and UI panel inside Roblox Studio
- Scan tab: collect animation and sound IDs from the entire place
- Replace tab: apply the new ID map returned by the app
- GitHub Actions builds Windows portable EXE and Roblox Studio plugin
- Plugin is bundled inside the EXE and installable from the Plugin tab
- Release notes extracted automatically from this changelog
- Automatic release creation via CHANGELOG updates
