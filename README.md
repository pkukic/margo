# Margo - AI-Powered PDF Reader and Annotator

<p align="center">
  <img src="frontend/assets/icon-256.png" alt="Margo Logo" width="128">
</p>

**Margo** is an AI-powered PDF reader for annotating and discussing academic papers. Screenshot sections and ask questions about them, with full LaTeX/Markdown rendering support.

The name has a dual meaning: *margo* is Latin for ["margin"](https://www.latin-is-simple.com/en/vocabulary/noun/11942/)—fitting for a PDF annotation tool. It's also a popular brand of margarine in Croatia, which inspired the buttery yellow logo.

## Current Limitations

- **AI Provider**: Only **Google Gemini** is supported. You'll need a Gemini API key.
- **Platform**: Only **Linux** is supported (tested on Ubuntu/Pop!_OS). The app is packaged as a `.deb` file and AppImage.

## Features

- 📄 **PDF Viewing**: Full-featured PDF reader with zoom, page navigation, and clickable links
- 🖼️ **Screenshot Selection**: Select any region of the PDF to ask questions about
- 🤖 **AI Chat**: Ask questions about selected content with follow-up support
- 📐 **LaTeX Support**: Full mathematical notation rendering in responses
- 💾 **Auto-save**: All conversations saved to `.chat` files alongside PDFs
- 🔄 **State Recovery**: Reopen any PDF and restore all annotations/chats
- 🔗 **PDF Links**: Clickable internal and external links in PDFs

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
cd frontend
npm start
```

The app will automatically start the Python backend.

## Building for Linux

### Build `.deb` and AppImage packages

```bash
cd frontend
npm run build:linux
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
2. **Screenshot Mode**: Press `Ctrl+S` or click the screenshot button, then drag to select an area
3. **Ask a Question**: Type your question in the chat panel and press Enter
4. **Follow-up Questions**: Continue the conversation in the same chat thread
5. **Edit/Delete**: Hover over messages to edit or delete them

## File Format

Conversations and screenshots are saved as `.chat` files (JSON format) alongside the PDF:

```
my-paper.pdf
my-paper.chat
```

## License

MIT
