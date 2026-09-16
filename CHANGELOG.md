# Change Log

All notable changes to the "Android Studio Lite" extension will be documented in this file.

## [Unreleased]

## [0.0.18] - 2026-09-16

### Added
- **Run error recovery module:** Central `runErrorRecovery` classifies common install/device failures. Recoverable conflicts (`VERSION_DOWNGRADE`, signature mismatch, …) prompt uninstall→reinstall; storage/ABI/SDK/device-offline/etc. show modal tips instead of a raw stack toast.

## [0.0.17] - 2026-09-16

### Added
- **Install conflict recovery (AS-style):** On recoverable adb install failures (`INSTALL_FAILED_VERSION_DOWNGRADE`, signature mismatch, etc.), show a modal confirm; if accepted, `adb uninstall` then reinstall and launch.

## [0.0.16] - 2026-09-16

### Fixed
- **AGP 9 module discovery:** Build Variant / Module dropdown no longer stays empty on AGP 9 (`android.newDsl`). The init script now collects variants via `androidComponents.onVariants`, and still falls back to legacy `applicationVariants` / `libraryVariants` for AGP 7/8 or `android.newDsl=false`.

### Added
- **Physical device support:** The Run dropdown lists online devices from `adb devices` alongside local AVDs. Running on a physical device skips emulator boot and sets `ANDROID_SERIAL` for Gradle install/launch.
- **Build Variant cascade:** Changing an application module's variant (e.g. `toyotaRelease`) aligns library modules to a compatible variant with the same `buildType` (and best flavor overlap), similar to Android Studio.
- **Release Run/install:** Application release variants now expose `install*` tasks (not only `bundle`), using project-scoped paths like `:toyota:installToyotaRelease`.
- **Device screenshot:** Take Screenshot (sidebar **Shot** / Command Palette). Settings: `screenshot.saveMode` (`ask` / `file` / `clipboard`) and `screenshot.savePath`.
- **Qodo review fixes:** Preserve selected Run target across refreshes; launch via `execFile` args (no shell interpolation); classify online `emulator-*` separately from physical devices.

## [0.0.10] - 2026-03-06

### Changed
- **Marketplace:** Added categories (Debuggers, Testing) and keywords (android, emulator, logcat, gradle, kotlin, etc.) for better discoverability and ranking.

## [0.0.9] - 2026-03-06

### Added
- **Built-in Logcat:** Logcat is now implemented in the extension (no optional `out/` modules). A dedicated "Logcat" output channel shows logs only for the app you last ran (filtered by PID). Run the app from the AVD selector, then turn on the Logcat toggle to stream that app’s logs.
- **Last-run persistence:** After a successful Run, the extension stores the app’s applicationId and device serial so Logcat can target the same app and device when you start it.

### Changed
- **Logcat architecture:** Removed all optional `require()` of `out/commands`, `out/providers`, and `out/services`. Replaced with `LogcatService` in `src/service/LogcatService.ts` using Manager config (ADB path), workspace state (last-run app/device), and existing `logcatParser` for formatting. Start/stop/clear/setLogLevel commands now use this service.
- **Logcat toggle:** Always visible in the AVD selector. Turning it on starts app-only logcat and shows the Logcat channel; turning it off stops the stream and shows the Android Studio Lite channel.

### Fixed
- "Logcat services not initialized" no longer appears; Logcat is always available in this build.

## [0.0.8] - 2026-03-06

### Added
- **Kotlin import folding:** `editor.foldingImportsByDefault` now works for `.kt` files. Added a `FoldingRangeProvider` that marks the import block with `FoldingRangeKind.Imports` so VS Code can auto-fold it (activation: `onLanguage:kotlin`).
- **"Open an Android project" placeholder:** When the workspace is not an Android project (no Gradle wrapper), the Android Studio Lite webview and Build Variant section show an "Open an Android project" message with an "Open Folder" button (same behavior as File → Open Folder). AVD section is unchanged and always shown.
- **Emulator boot service:** Run flow now uses fire-and-forget emulator spawn (`detached: true`, `stdio: 'ignore'`, `unref()`) so the extension no longer hangs waiting for the emulator process. ADB polling runs in parallel to detect when the device is fully booted before building/installing.

### Fixed
- **Module config fetched twice:** Coalesced concurrent `getModuleBuildVariants` calls so multiple callers (bootstrap, onReady, refresh-modules) share a single in-flight promise and Gradle is only run once.
- **Webview reload on activity bar switch:** Set `retainContextWhenHidden: true` for webview views so the Android Studio Lite panel no longer reloads when switching between Git, Explorer, and Android Studio Lite.
- **Run stuck on "Starting emulator...":** Emulator process is no longer awaited; serial is resolved by AVD name (`adb devices -l` / `adb emu avd name`), then we wait for `sys.boot_completed` and `init.svc.bootanim` on that serial before running the Gradle install and launching the app.
- **Gradle error on non-Android project:** Opening a non-Android project no longer shows "Gradle wrapper (gradlew) not found…". `sendModules()` now skips calling Gradle when the workspace is not an Android project and sends an empty module list instead.

### Changed
- Run-app flow: launch and boot wait are handled by `EmulatorBootService.launchAndWait()` (spawn then poll ADB). Resolved ADB serial is used for install/launch when multiple emulators are present.

## [0.0.7] - 2025-03-06

### Fixed
- Extension no longer fails to activate when `out/commands`, `out/providers`, or `out/services` are missing (e.g. when building VSIX from a tag without those sources). Logcat modules are loaded optionally; logcat commands show a message when logcat is unavailable.

## [0.0.3] - 2025-01-12

### Added
- Logcat toggle button in AVD selector webview for quick access to logcat output
- Toggle functionality to switch between Logcat and Android Studio Lite output channels
- Auto-device selection when starting logcat if no device is selected
- Improved logcat formatting matching Android Studio's output format
- Toggle button component with macOS-style design

### Fixed
- Fixed logcat commands not being registered in extension activation
- Fixed device selection requirement for logcat (now auto-selects first available device)
- Removed ANSI escape sequences from logcat output for cleaner display
- Improved logcat column alignment and formatting

### Changed
- Updated logcat output formatting to match Android Studio's exact format
- Improved logcat column spacing and alignment
- Enhanced logcat integration with better error handling

## [0.0.2] - 2025-01-11

### Fixed
- Fixed build variants not loading in published extension by including Gradle init script in package
- Fixed modules not appearing in webview dropdown due to missing Gradle script
- Improved error handling for Gradle script path resolution

### Changed
- Updated extension icon to use new transparent Android Studio logo
- Improved build process to include necessary script files

## [0.0.1] - 2025-01-11

### Added
- Initial release of Android Studio Lite
- Device management with real-time detection
- Build variant detection using Gradle init scripts
- App lifecycle controls (run, stop, uninstall, clear data)
- Live logcat integration with filtering
- AVD management and emulator support
- Webview-based AVD selector with module selection
- Multi-module project support
