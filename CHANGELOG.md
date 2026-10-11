# Changelog

## 3.0.0 — 2026-10-11

First GitHub release of the Node.js / Electron desktop application.

### Features

- Windows application discovery with registry scanning and WinGet matching.
- Official publisher version checks with labeled catalog fallback.
- Separate Node.js latest, LTS, and installed-major update channels.
- Architecture-aware installer downloads, progress reporting, and source-dependent checksum verification.
- Scheduled checks and optional automatic downloads, limited to two concurrent jobs. Installers are never launched automatically.
- Windows notifications, tray integration, optional startup, dark/light themes, and persistent settings.
- English, German, French, and Turkish interfaces.
- Migration of existing settings from the historical Python implementation.

### Repository and distribution

- English README and project description.
- GPL-3.0-only license, copyright notice, and security policy.
- Portable Windows x64 executable, corresponding source archive, and SHA-256 checksums.

### Requirements and limits

- Windows x64 for the portable executable; Node.js and Python are not required at runtime.
- App Installer / WinGet is required for catalog operations.
- The executable is not code signed. Compare downloads with `SHA256SUMS.txt` for file integrity.
- Official sources cover supported publishers; other applications use catalog or manually assigned sources.
- Release downloads require repository access while the repository is private.
