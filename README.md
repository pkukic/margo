# Margo - Answer questions in your PDFs

<p align="center">
  <img src="frontend/assets/icons/512x512.png" alt="Margo Logo" width="128">
</p>

**Margo** is a PDF reader for annotating and discussing papers, presentations, and other stuff you might use as a student. Screenshot sections, ask questions about them, and get answers from [Gemini](https://gemini.google.com/app), with full LaTeX/Markdown rendering support.

The name has a dual meaning: *margo* is Latin for ["margin"](https://www.latin-is-simple.com/en/vocabulary/noun/11942/)—fitting for a PDF annotation tool. It's also a [popular brand of margarine in Croatia](https://www.zvijezda.hr/proizvodi/margo/), which inspired the buttery yellow logo.

## Current Limitations

- **AI Provider**: Only **Google Gemini** is supported. You'll need a Gemini API key.
- **Platform**: Only **Linux** is supported (tested on Ubuntu/Pop!_OS). The app is packaged as a `.deb` file and AppImage.

## Features

- 📄 **PDF Viewing**: Full-featured PDF reader with zoom, page navigation, and clickable links
- 🖼️ **Q&A Mode**: Select any region of the PDF to ask questions about (Ctrl+Q)
- 📝 **Notes**: Highlight text and attach notes with text or drawings (Ctrl+N)
- 📐 **LaTeX Support**: Full mathematical notation rendering in responses
- 💾 **Auto-save**: All conversations and notes saved to `.chat` files alongside PDFs
- 🔄 **State Recovery**: Reopen any PDF and restore all annotations, notes, and chats
- 🔗 **PDF Links**: Clickable internal and external links in PDFs
- 🎯 **Smart Focus**: Annotations and notes auto-open when scrolled into view

## Tech Stack

- **Frontend**: Electron + PDF.js + KaTeX
- **Backend**: Python + FastAPI + Google Generative AI
- **Package Management**: uv (Python), npm (JavaScript)

## Prerequisites

- **uv** - Python package manager (required)
- **Node.js 18+** (for development only)

## Quick Start (Development)

### 1. Install uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Clone and set up

```bash
git clone https://github.com/pkukic/margo.git
cd margo
```

### 3. Configure Gemini API Key

Create `backend/.env`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Install dependencies

```bash
# Backend (uv will create venv automatically)
cd backend
uv sync

# Frontend
cd ../frontend
npm install
```

### 5. Run the app

```bash
# Option 1: Run everything together
./run.sh

# Option 2: Run backend and frontend separately (for development)
./run-backend.sh   # In one terminal
./run-frontend.sh  # In another terminal
```

## Building for Linux

### Build `.deb` and AppImage packages

```bash
./build-linux.sh
```

The packages will be in `frontend/dist/`:
- `margo_0.1.0_amd64.deb`
- `Margo-0.1.0.AppImage`

### Install the `.deb` package

```bash
sudo dpkg -i frontend/dist/margo_0.1.0_amd64.deb
```

After installation:
- Launch from your application menu
- Right-click any PDF → "Open With" → "Margo"

**Note**: The installed app requires `uv` to be available in your PATH. It will create a virtual environment in `~/.config/margo/backend-venv/` on first run.

## Usage

1. **Open a PDF**: Click "Open PDF" or use Ctrl+O, or right-click a PDF file
2. **Q&A Mode**: Press `Ctrl+Q` or click the Q&A button, then drag to select an area
3. **Ask a Question**: Type your question in the chat panel and press Enter
4. **Follow-up Questions**: Continue the conversation in the same chat thread
5. **Notes**: Press `Ctrl+N` or click the Note button, then select text to highlight
6. **Add Note Content**: Write text or draw a sketch in the note panel
7. **Edit/Delete**: Hover over messages to edit or delete them, or use Ctrl+Delete to delete annotations/notes

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open PDF |
| `Ctrl+Q` | Toggle Q&A mode (screenshot selection) |
| `Ctrl+N` | Toggle Note mode (text selection) |
| `Ctrl+Delete` | Delete current annotation or note |
| `Escape` | Close current panel / exit mode |
| `←` / `→` | Previous / Next page |
| `+` / `-` | Zoom in / out |

## File Format

Annotations, notes, and conversations are saved as `.chat` files (JSON format) alongside the PDF:

```
my-paper.pdf
my-paper.chat
```

## License

MIT
