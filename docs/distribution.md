# How to Get Helix

[繁體中文](./distribution.zh-TW.md)

Helix ships through 4 distribution paths, each suited to a different kind of user:

1. **npm global install** — best for developers who already have Node.js
2. **portable tarball** — best for users who want "download, extract, run" with no project setup
3. **PWA installable web app** — best for users who want the Web Console in their Dock / Start menu
4. **Tauri native desktop (planned)** — a real desktop installer, coming next sprint

> Currently shipping publicly: **npm**, **portable tarball**, **PWA installable web app**.

---

## 1. npm global install

### Who it's for
- You already have Node.js
- You want the `helix` command directly
- You're comfortable editing `helix.config.js` in your own project

### Install

```bash
npm install -g helix-agent-framework
```

### Run

```bash
helix init
helix login --provider gemini --api-key YOUR_KEY
helix start
```

### Pros
- The standard, canonical install path
- Easy upgrades: `npm install -g` again
- CLI / REPL / Web Console all available

### Cons
- Requires Node.js installed
- If your machine lacks native-build prerequisites, `better-sqlite3` may need build tools first

---

## 2. portable tarball

### Who it's for
- You don't want to deal with a Node project first
- You want "download → extract → run"
- Ops / devops scenarios, quick single-machine testing

### What's inside
A portable tarball contains:
- Node.js runtime
- `helix` launcher script
- `helix-bundle.mjs` (esbuild-bundled Helix)
- native modules compiled for this OS / arch
- `README.txt`

### Current release assets (v0.9.0)
- Release page: `https://github.com/symbiosis11503/helix-framework/releases/tag/v0.9.0`
- macOS (Apple Silicon): `helix-portable-darwin-arm64.tar.gz`
- Linux (x86_64): `helix-portable-linux-x86_64.tar.gz`

### Usage

```bash
# 1. Download the matching asset from GitHub Releases
# 2. Extract
mkdir my-helix
cd my-helix
tar -xzf helix-portable-<os>-<arch>.tar.gz
cd helix-portable-<os>-<arch>

# 3. Run
./helix init
./helix login --provider gemini --api-key YOUR_KEY
./helix start
```

### Pros
- No Node.js installation required
- Extract and it runs
- Great for clean-machine smoke tests or internal distribution

### Notes
- This is a **portable tarball**, not a single-file binary
- Each OS / architecture needs its own build
- GitHub Actions matrix produces multi-platform builds per release

---

## 3. PWA installable web app

### Who it's for
- You already have Helix runtime running
- You want the Web Console in your Dock / desktop / launcher
- You want a near-desktop feel, accepting that underneath it's still a web app

### Usage
1. Start Helix:
   ```bash
   helix start
   ```
2. Open:
   - `http://localhost:18860/v2/`
3. Click the **Install** button in the Chrome / Edge address bar
4. It'll appear in the Dock / App Launcher / Start Menu (depending on platform)

### What you get
- `manifest.json`
- service worker
- standalone display
- app icon + theme color
- **installable web app**

### Notes
- This is not a native desktop app
- It still depends on the Helix runtime running on your machine
- Install flow differs slightly between Safari / Chrome / Edge

---

## 4. Tauri native desktop (planned)

### Goal
Future releases will ship:
- `.dmg` (macOS)
- `.exe` (Windows)
- `.AppImage` (Linux)

### Positioning
- Proper installer for desktop-first users
- Reuses the current PWA / webview capability
- Backend integrates with the existing runtime / binary path

### Current status
- **Not yet released**
- Scheduled for the next sprint

---

## Which one should I pick?

### If you're a developer
Pick: **npm global install**

### If you want to download-and-go
Pick: **portable tarball**

### If you want the Console in your Dock / desktop
Pick: **PWA installable web app**

### If you want a real desktop installer
Wait: **Tauri native desktop**

---

## Recommended adoption paths

### Path A: Standard developer
```bash
npm install -g helix-agent-framework
helix init
helix login --provider gemini --api-key YOUR_KEY
helix start
```

### Path B: Low-friction trial
1. Download a portable tarball
2. Extract and run `./helix start`
3. Install `/v2/` as a PWA for desktop-like access

---

## See also
- [README](../README.md)
- [Getting Started](./getting-started.md)
- [Config Reference](./CONFIG_REFERENCE.md)
- [FAQ](./FAQ.md)
- [Examples](../examples/)
