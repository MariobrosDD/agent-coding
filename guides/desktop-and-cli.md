---
name: desktop-and-cli
description: Desktop applications and command-line tools: Electron, Tauri, WPF/WinUI/WinForms, Qt, GTK, SwiftUI/AppKit for macOS, CLI design and argument parsing, cross-platform paths, packaging, installers and auto-update.
---
# Desktop applications and CLI tools

## Desktop
- Identify the framework and version and follow its architecture (MVVM in WPF/WinUI/MAUI, Qt signals/slots and object ownership, Electron main vs renderer processes, Tauri commands).
- Never block the UI thread; use async work with progress and cancellation; marshal results back to the UI thread.
- Electron: contextIsolation on, nodeIntegration off in renderers, a narrow preload API, validated IPC messages, CSP. Tauri: allow only the APIs you need.
- Store user data in the platform-appropriate location (AppData, ~/Library/Application Support, XDG directories); handle paths with spaces and non-ASCII characters.
- High-DPI, keyboard navigation, screen readers, dark mode, localization.
- Packaging and updates: code signing, notarization (macOS), installers (MSIX, NSIS, WiX, dmg, AppImage/Flatpak), signed auto-updates. Don't change signing settings without asking.

## Command-line tools
- Follow platform conventions: `--help` and `--version`; exit code 0 on success and non-zero on failure; errors to stderr and data to stdout; machine-readable output (`--json`) when useful; no colors when the output is not a TTY or NO_COLOR is set.
- Use a robust argument parser (argparse/typer/click, clap, cobra, commander/yargs, System.CommandLine).
- Cross-platform: path joining and normalization, line endings, shell quoting, case-insensitive file systems, Windows vs POSIX differences.
- Safe by default: confirm destructive operations or offer `--dry-run`; idempotent where possible.
- Test at the process level (exit code, stdout, stderr) as well as with unit tests.
