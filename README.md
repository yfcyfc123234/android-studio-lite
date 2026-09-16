# Android Studio Lite

You ain't going back to android studio for a while.

<p align="center">
  <img src="assets/android_studio_lite.png" width="800" alt="Android Studio Lite"/>
</p>

---

## Private fork notes (yfcyfc123234)

- Device dropdown lists **online physical devices** (`adb devices`) plus local AVDs.
- Run on a physical device skips emulator boot and sets `ANDROID_SERIAL` for Gradle install.
- Prefer physical device when both are available.


1. **Install** the extension (Extensions view → search "Android Studio Lite" → Install).
2. **Set Android SDK path**
  - Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to your SDK root, **or**
  - Settings → search `android-studio-lite.sdkPath` → set the path.
  - Restart the editor after changing env vars.
3. **Open an Android project** (folder with `gradlew`).
4. Open the **Android Studio Lite** view in the sidebar (Android icon in the activity bar).
5. **Select an AVD** in the dropdown (or start an emulator from the AVD view).
6. **Select a module** (e.g. `app`) in the dropdown.
7. Click **Run**. The extension builds, installs, and launches the app on the device.
8. Turn **Logcat** on to see logs for that app in the Logcat output channel.

---

## Prerequisites

- **Editor:** VS Code or Cursor v1.74.0+
- **Android SDK** with Platform Tools (ADB). If you use Android Studio, the SDK is usually at:
  - macOS: `~/Library/Android/sdk`
  - Windows: `%LOCALAPPDATA%\Android\Sdk`
- **Android project:** Workspace folder must contain a Gradle wrapper (`gradlew` / `gradlew.bat`).

---

## Configuration


| What                | How                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| SDK path (required) | Set `ANDROID_HOME` or `ANDROID_SDK_ROOT`, or set `android-studio-lite.sdkPath` in Settings.                    |
| AVD / Emulator      | Auto-detected from SDK. Override with `android-studio-lite.emulator`, `android-studio-lite.avdHome` if needed. |
| ADB                 | Auto-detected from SDK `platform-tools`. Override with `android-studio-lite.adbPath` if needed.                |


After changing environment variables, restart the editor.

---

## Running your app

1. Open the **Android Studio Lite** sidebar view.
2. **Device:** Choose a physical device or AVD from the dropdown.
3. **Module:** Choose the app module (e.g. `app` / `:toyota`). Variants are loaded from Gradle; pick the one you want in Build Variant.
4. Click **Run**.
5. **Shot:** Capture the current device screen — choose save-to-file or copy-to-clipboard (configurable).

---

## Screenshots

- Command Palette: `Android Studio Lite: Take Screenshot`
- Settings:
  - `android-studio-lite.screenshot.saveMode`: `ask` (default) | `file` | `clipboard`
  - `android-studio-lite.screenshot.savePath`: folder for PNG files (empty → `<workspace>/screenshots`)

---

## Logcat (app logs only)

- **Turn Logcat on** via the Logcat toggle in the Android Studio Lite sidebar.
- Logcat shows **only the app you last ran** (filtered by PID).
- Logs stream in the **Logcat** output channel (Output panel → channel dropdown → "Logcat").
- **Before first use:** Run your app once from the sidebar so the extension knows which app/device to attach to.
- **Commands:** Start/Stop/Clear via Command Palette (`Android Studio Lite: Start Logcat`, etc.).

---

## Build variants & devices

- **Build variant:** Use the Build Variant view in the sidebar or Command Palette: `Android Studio Lite: Select Build Variant`. Variants (e.g. debug, release, flavors) are loaded from your Gradle project.
- **Devices:** Device list and emulator start are in the AVD section of the sidebar. Command Palette: `Android Studio Lite: Start Emulator`, `Android Studio Lite: Select Device`.

---

## Commands reference

**Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`):


| Command                                   | Purpose                     |
| ----------------------------------------- | --------------------------- |
| Update SDK Root Path                      | Set Android SDK path.       |
| Update Emulator Path / AVD Manager Path   | Override paths if needed.   |
| Start Emulator / Select Device            | Launch or choose device.    |
| Select Build Variant                      | Choose build configuration. |
| Run App                                   | Build, install, launch.     |
| Start Logcat / Stop Logcat / Clear Logcat | Control log stream.         |
| Stop App / Uninstall / Clear Data         | App lifecycle on device.    |


---

## Troubleshooting


| Issue                            | What to do                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| No devices                       | Run `adb devices`. Ensure USB debugging authorized or emulator running. Check `android-studio-lite.sdkPath` (or `ANDROID_HOME`). |
| Build variants empty             | Open an Android project root (with `gradlew`). Make sure Gradle wrapper is executable.                                           |
| Logcat shows “Run the app first” | Run the app once from the sidebar so the extension can attach Logcat to that app.                                                |
| Emulator not found               | Install SDK Platform Tools & Emulator (e.g. via Android Studio SDK Manager). Set SDK path.                                       |


---

