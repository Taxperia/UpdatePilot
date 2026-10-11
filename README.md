# UpdatePilot

A Windows desktop update manager built with Node.js and Electron. UpdatePilot scans installed applications, checks official publisher sources and the WinGet catalog, and downloads compatible installers for you to run.

The interface supports **English, German, French, and Turkish**, with English as the default, dark and light themes, and a compact application list.

## Download

Download `UpdatePilot-3.0.0-x64.exe` from the [latest release](https://github.com/Taxperia/UpdatePilot/releases/latest) and run it on Windows x64. The portable application includes its runtime; Node.js and Python are not required.

Install **App Installer / WinGet** for catalog matching and catalog downloads. Check availability with:

```powershell
winget --version
```

Releases include a source archive and `SHA256SUMS.txt`. Calculate the executable's checksum with:

```powershell
Get-FileHash .\UpdatePilot-3.0.0-x64.exe -Algorithm SHA256
```

Compare the result with `SHA256SUMS.txt`. The executable is not code signed; a checksum checks file integrity, not publisher identity. Downloads require repository access while the repository is private.

## Features

- Scan Windows registry entries in machine and user scopes and match applications using WinGet package identifiers.
- Prefer supported publishers' official APIs and release repositories, with clearly labeled catalog fallback.
- Choose the latest Node.js release, latest LTS release, or an update within the installed major version.
- Download Windows installers appropriate for the application's architecture and installation scope.
- Schedule update checks, optionally download packages automatically, and receive Windows notifications.
- Configure startup, system tray behavior, themes, language, and compact view.
- Track applications through a manually assigned GitHub repository or HTTPS download URL when automatic matching is unavailable.

## How updates work

1. UpdatePilot reads installed application records and matches them against the WinGet catalog.
2. It checks supported publishers' official sources. Other matched applications use `winget show` for catalog versions.
3. Select **Update** in an application row or its details to download an installer. Progress and results appear in the interface.
4. Packages are saved to the `UpdatePilot` subfolder of your Windows Downloads folder. Open that folder and run the installer yourself.
5. After installation, rescan to refresh the installed version.

**Update downloads a package; installers are never run automatically.** Optional automatic downloads are disabled by default and limited to two concurrent jobs when enabled.

The interface distinguishes official, catalog, GitHub, and manual sources. Catalog data may lag behind a publisher's releases. Older catalog versions are labeled as stale and cannot be downloaded as an update. A failed check is reported as an error rather than marking an application up to date.

## Supported release sources

| Application | Source and behavior |
| --- | --- |
| Node.js | Official distribution index; separate latest, LTS, and installed-major channels. Downloads require a matching official SHA-256 checksum. |
| Cursor and Visual Studio Code | Official update APIs, preserving architecture and user/system installation scope. |
| Firefox | Mozilla Product Details API, distinguishing release and ESR channels and preserving the installed language. |
| Chrome | Google VersionHistory API. Google's current Windows MSI is used when the catalog is missing or behind; this is an evergreen installer rather than a version-pinned archive. |
| Git, GitHub CLI, DBeaver, PowerToys, Tailscale, Notepad++, RustDesk, WinDirStat, Zen Browser | Known publisher GitHub release repositories. |
| Other matched applications | WinGet catalog versions and downloads. |

User-assigned GitHub repositories take priority. Compatible `.exe`, `.msi`, `.msix`, or `.zip` assets are selected; a GitHub-provided SHA-256 digest is verified when available. WinGet download hash verification remains enabled. Manual URLs without a supplied digest do not provide independent checksum verification.

Applications without a supported source or a WinGet match remain unmatched until a repository or manual package is assigned. Similar repository names are not automatically trusted. Microsoft Store-only packages and macOS/Linux are outside this release's scope.

## Settings

Open **Settings** in the lower-left corner. Changes are saved immediately.

| Section | Options |
| --- | --- |
| General | Start with Windows, minimize to tray, confirm exit during downloads, start minimized, and startup page. |
| Appearance | Dark/light theme and compact list. |
| Updates | Check at startup, scheduled checks every 15 minutes / 1 hour / 6 hours / 1 day, automatic downloads, and prerelease filtering. |
| Notifications | Windows notifications, download completion/error preferences, and a test notification. |
| Language | English, German, French, and Turkish. |
| Advanced | Include user-scope applications and quit the application. |

Windows startup is disabled by default. Enabling it adds a user-scoped startup entry; disabling it removes that entry. Portable startup uses the original executable path rather than its temporary extraction directory. Windows notification settings may suppress notifications.

**Reset defaults** restores English and the dark theme without deleting tracked applications, downloads, or history. Press **Escape**, click outside the dialog, or select **Done** to close settings.

## Local data and privacy

- Configuration: `%LOCALAPPDATA%\UpdatePilot\config.json`
- History: `%LOCALAPPDATA%\UpdatePilot\history.jsonl`
- Packages: your Windows Downloads folder, under `UpdatePilot`

Configuration and history are stored locally. Version checks and downloads make network requests to the catalog, GitHub, and package publishers. GitHub credentials are not sent to the renderer. Local configuration may contain credentials and should not be shared without redaction.

Settings from the previous Python implementation are preserved, including repository mappings, ignored versions, and manual packages. The first Node.js launch creates a `config.json.python-backup` copy of existing settings. Corrupt configuration is not silently overwritten. Historical Python sources remain in `legacy-python/`; the desktop application does not use them.

## Development

Requirements: **Windows**, **Node.js 22+**, and **WinGet** for catalog operations.

```powershell
git clone https://github.com/Taxperia/UpdatePilot.git
cd UpdatePilot
npm.cmd ci
npm.cmd start
```

You can also double-click `UpdatePilot.bat`. It opens a packaged executable when present, otherwise the development application. If the application is already running, launching it again brings the existing window forward.

Build the portable executable:

```powershell
npm.cmd run dist
```

Output: `dist/UpdatePilot-3.0.0-x64.exe`. The distribution includes the project license and copyright notice alongside the unpacked application.

### Validation

```powershell
npm.cmd test
npm.cmd run diagnose
npm.cmd run qa -- --smoke
npm.cmd run qa -- --smoke --smoke-settings
npm.cmd run qa -- --smoke --smoke-download
npm.cmd run qa -- --smoke --smoke-node-download
npm.cmd run qa -- --smoke --smoke-node-download --smoke-node-track=series
npm.cmd run pack
node scripts/packaged-smoke.js
node scripts/packaged-smoke.js --portable
```

Tests cover version comparison, source selection, data migration, architecture matching, download integrity, settings, scheduling, and notifications. Diagnostics and UI smoke tests write reports to `.qa/` and use separate configuration directories. Download smoke tests download real packages without installing them. `--smoke-settings --native-test` additionally tests a temporary QA startup entry and a real Windows notification.

## Architecture

| Path | Responsibility |
| --- | --- |
| `electron/` | Desktop window, restricted IPC, isolated preload bridge, notifications, and UI validation. |
| `src/scanner.js`, `src/winget.js` | Read-only application discovery, catalog matching, and verified catalog downloads. |
| `src/official-sources.js`, `src/github.js`, `src/download.js` | Publisher APIs, release channels, asset selection, HTTPS downloads, and checksum verification. |
| `src/app-state.js`, `src/storage.js`, `src/versioning.js` | Application state, compatible local persistence, and version comparison. |
| `src/preferences.js`, `src/update-scheduler.js`, `src/desktop-services.js` | Settings, scheduling, Windows startup, and notifications. |
| `web/` | HTML/CSS/JavaScript interface and shared translations. |

The renderer has Node.js integration disabled, context isolation enabled, and sandboxing enabled. No local HTTP server is needed.

## Security

See [SECURITY.md](SECURITY.md) for supported versions, vulnerability reporting, and download verification limits.

## License

Copyright (C) 2026 Tamer Albayrak. UpdatePilot is licensed under the [GNU General Public License v3.0 only](LICENSE), SPDX identifier `GPL-3.0-only`. See [NOTICE](NOTICE) for the project notice. Third-party components retain their own licenses and notices.
