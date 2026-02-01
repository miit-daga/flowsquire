# FlowSquire

A local-first automation platform for organizing files on your computer. No cloud, no AI, no subscriptions — just simple WHEN → DO workflows.

## Features

- **File Watching**: Automatically organize files as they appear
- **Smart PDF Workflow**: Sort PDFs by keywords (invoice, bank, notes, etc.) with automatic compression
- **Downloads Organizer**: Sort images, videos, music, archives, documents, installers, and code files
- **Screenshot Organizer**: Organize screenshots by app, website domain, and date (macOS)
- **Priority-Based Rules**: Higher priority rules execute first
- **Dry-Run Mode**: Preview actions before executing
- **PDF Compression**: Automatically compress large PDFs (>8MB)
- **Interactive Setup**: Guided wizard for first-time configuration

## Installation

```bash
npm install -g flowsquire-agent
```

### Prerequisites

**Ghostscript** (required for PDF compression):

```bash
# macOS
brew install ghostscript

# Ubuntu/Debian
sudo apt-get install ghostscript

# Windows
# Download from https://www.ghostscript.com/download/gsdnld.html
```

> Note: Without Ghostscript, PDF compression will fail, but all other features work normally.

## Quick Start

```bash
# Run interactive setup wizard
flowsquire init

# Start the file watcher
flowsquire start

# Or with dry-run (preview only)
flowsquire start --dry-run
```

### Interactive Setup

During `flowsquire init`, you'll be asked:

1. **Watch folder** — Where to watch for new files (default: ~/Downloads)
2. **Documents folder** — Where to organize documents (default: ~/Documents)
3. **Screenshots folder** — Where screenshots are saved (default: ~/Downloads/Screenshots)
4. **Downloads organizer mode**:
   - `nested` — Organize inside Downloads subfolders (Images/, Videos/, etc.)
   - `system` — Move to system folders (Pictures/, Movies/, Music/, etc.)
5. **Screenshot organizer mode**:
   - `metadata` — Organize by App/Domain (macOS only)
   - `by-app` — Organize by App name only
   - `by-date` — Organize by date (works on all platforms)

## Templates

### PDF Workflow (5 rules)

Automatically organizes PDFs based on filename and size:

| Priority | Rule | Condition | Nested Mode Destination | System Mode Destination |
|----------|------|-----------|------------------------|------------------------|
| 500 | Large PDF Compression | > 8MB | `~/Downloads/PDFs/Compressed/` | `~/Documents/PDFs/Compressed/` |
| 400 | Invoice Organizer | name contains "invoice" | `~/Downloads/PDFs/Invoices/` | `~/Documents/PDFs/Invoices/` |
| 300 | Bank Statement | name contains "bank" | `~/Downloads/PDFs/Finance/` | `~/Documents/PDFs/Finance/` |
| 200 | Study Notes | name contains "notes" | `~/Downloads/PDFs/Study/` | `~/Documents/PDFs/Study/` |
| 100 | Default | any PDF | `~/Downloads/PDFs/Unsorted/` | `~/Documents/PDFs/Unsorted/` |

**Features:**
- Cross-platform Ghostscript support (macOS/Linux: `gs`, Windows: `gswin64c`)
- Quality levels: screen (low), ebook (medium), printer (high)
- Date pattern support: `{filename}_{YYYY}-{MM}-{DD}`

### Downloads Organizer (7 rules)

Sorts non-PDF files by type:

| Type | Extensions | Nested Mode Destination | System Mode Destination |
|------|------------|------------------------|------------------------|
| Images | jpg, jpeg, png, gif, webp, svg | `~/Downloads/Images/` | `~/Pictures/Downloads/` |
| Videos | mp4, mov, avi, mkv | `~/Downloads/Videos/` | `~/Movies/` |
| Music | mp3, wav, flac, aac | `~/Downloads/Music/` | `~/Music/` |
| Archives | zip, rar, 7z, tar, gz | `~/Downloads/Archives/` | `~/Documents/Archives/` |
| Documents | doc, docx, txt, rtf, xls, xlsx, ppt, pptx | `~/Downloads/Documents/` | `~/Documents/Documents/` |
| Installers | dmg, pkg, exe, msi | `~/Downloads/Installers/` | `~/Documents/Installers/` |
| Code | js, ts, jsx, tsx, py, rb, go, rs, java, cpp, c, h | `~/Downloads/Code/` | `~/Documents/Code/` |

### Screenshot Organizer

Organizes screenshots based on your chosen mode:

**Metadata Mode** (macOS only, requires Accessibility permissions):
- Organizes by: `AppName/Domain/{filename}_{date}_{time}.png`
- Example: `Google Chrome/aistudio.google.com/SCR-2026-02-01_16-41.png`
- Captures: foreground app, browser URL, window title

**By App Mode**:
- Organizes by: `AppName/{filename}.png`
- Example: `Google Chrome/SCR-20260201-ornd.png`

**By Date Mode** (works on all platforms):
- Organizes by: `Year/Month/{filename}.png`
- Example: `2026/February/SCR-20260201-ornd.png`

> **Note:** On non-macOS platforms, metadata mode falls back to by-date automatically.

## CLI Commands

```bash
flowsquire init                          # Interactive setup wizard
flowsquire start                         # Start file watcher
flowsquire start --dry-run               # Preview mode (no actual changes)
flowsquire rules                         # List all rules
flowsquire config                        # Show all configured paths and settings
flowsquire config --<key> <value>        # Set a config value
flowsquire config --<key>                # Get a config value
```

### Config Options

**Path Settings:**
- `--downloads <path>` — Watch folder for new files
- `--documents <path>` — Documents organization folder
- `--screenshots <path>` — Screenshots folder
- `--pictures <path>` — Pictures folder
- `--videos <path>` — Videos/Movies folder
- `--music <path>` — Music folder

**Mode Settings:**
- `--downloads-mode <nested|system>` — Downloads organizer mode
- `--screenshot-mode <metadata|by-app|by-date>` — Screenshot organizer mode

**Examples:**
```bash
flowsquire config --downloads ~/Downloads
flowsquire config --downloads-mode system
flowsquire config --screenshot-mode by-date
```

> **Note:** After changing modes, delete rules and re-run `flowsquire init` to regenerate rules.

## Rule Structure

Rules are stored in `.flowsquire/rules.json`:

```json
{
  "id": "...",
  "name": "My Rule",
  "enabled": true,
  "priority": 100,
  "tags": ["pdf", "invoice"],
  "trigger": {
    "type": "file_created",
    "config": { "folder": "/Users/me/Downloads" }
  },
  "conditions": [
    { "type": "extension", "operator": "equals", "value": "pdf" },
    { "type": "name_contains", "operator": "equals", "value": "invoice" }
  ],
  "actions": [
    {
      "type": "move",
      "config": {
        "destination": "/Users/me/Documents/Invoices",
        "pattern": "{filename}_{YYYY}-{MM}-{DD}",
        "createDirs": true
      }
    }
  ]
}
```

## Condition Types

- `extension` — File extension (e.g., "pdf", "jpg")
- `name_contains` — Filename contains text (case-insensitive)
- `name_starts_with` — Filename starts with text
- `name_ends_with` — Filename ends with text
- `size_greater_than_mb` — File size in MB

## Action Types

- `move` — Move file to destination
- `copy` — Copy file to destination
- `rename` — Rename file
- `compress` — Compress PDF (requires Ghostscript)

## Pattern Placeholders

**Date/Time:**
- `{filename}` — Original filename without extension
- `{YYYY}` — Year (2026)
- `{MM}` — Month number (01-12)
- `{Month}` — Month name (January, February, etc.)
- `{DD}` — Day (01-31)
- `{HH}` — Hour (00-23)
- `{mm}` — Minute (00-59)
- `{ss}` — Second (00-59)

**Screenshot Metadata** (macOS only):
- `{app}` — Foreground application name (e.g., "Google Chrome")
- `{domain}` — Website domain (e.g., "github.com")

## Development

```bash
# Clone repo
git clone <repo-url>
cd flowsquire

# Install dependencies
npm install

# Build
npm run build

# Run in dev mode
npm run dev

# Test
npm test
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   CLI       │────▶│  File Watcher│────▶│  Rule Engine│
│  (cli.ts)   │     │  (chokidar)  │     │             │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                        ┌──────────────┐        │
                        │   Actions    │◀───────┘
                        │ (move/copy/  │
                        │  compress)   │
                        └──────────────┘
```

## License

MIT

## Philosophy

Your computer should work for you. Not the other way around.
