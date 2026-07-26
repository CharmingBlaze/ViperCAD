# ViperCAD Desktop (Go)

Windows desktop build for ViperCAD. Embeds the Vite production bundle in a native WebView2 window and exposes the `window.viperDesktopFiles` bridge used by `src/app/platform/FileDialogs.ts`.

## Prerequisites

- Node.js (for the web build)
- Go 1.22+
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually already installed on Windows 11)

## Build

From the repo root:

```bash
npm run build:exe
```

This runs the web build, copies `dist/` into `desktop/dist/`, and produces `ViperCAD.exe` in the repo root.

## Run

Double-click `ViperCAD.exe`, or:

```bash
./ViperCAD.exe
```

## Development

```bash
npm run dev
```

Use a Chromium-based browser for native file pickers during web development. The Go wrapper is only needed for the standalone `.exe`.
