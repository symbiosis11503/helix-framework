# Helix Tauri Desktop Prototype

[繁體中文](./README.zh-TW.md)

This folder contains the first attach-first Tauri MVP prototype for Helix desktop.

## What it does
- opens a native desktop shell
- checks whether `127.0.0.1:18860` is reachable
- when ready, loads `http://127.0.0.1:18860/v2/` into an embedded iframe

## What it does not do yet
- start or bundle the Helix runtime automatically
- ship signed / notarized public releases
- provide auto-update, tray mode, or deep OS integration
- `spawn mode` is explicitly out of `0.10.0` scope and deferred to `0.10.1+`

## Dev commands
From the repo root:

```bash
npm run tauri:dev
npm run tauri:build -- --bundles app
```

## Truth boundary
This is a prototype path for `0.10.0` exploration only. Do not add a public website download card until a real desktop artifact is intentionally released.
