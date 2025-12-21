# Margo - AI-Powered PDF Reader and Annotator

A fullscreen PDF reader with AI-assisted annotation capabilities. Screenshot or highlight sections of academic papers and ask questions about them, with full LaTeX/Markdown rendering support.

## Features

- 📄 **PDF Viewing**: Full-featured PDF reader with zoom, page navigation
- 🖼️ **Screenshot Selection**: Select any region of the PDF to ask questions about
- ✨ **Text Highlighting**: Highlight text and get AI explanations
- 🤖 **AI Chat**: Ask questions about selected content with follow-up support
- 📐 **LaTeX Support**: Full mathematical notation rendering in responses
- 💾 **Auto-save**: All conversations saved to `.chat` files alongside PDFs
- 🔄 **State Recovery**: Reopen any PDF and restore all annotations/chats

## Tech Stack

- **Frontend**: Electron + HTML/CSS/JavaScript
- **Backend**: Python with FastAPI
- **PDF Rendering**: PDF.js
- **Math Rendering**: KaTeX
- **Package Management**: uv (Python), npm (JavaScript)

## Prerequisites

- Python 3.10+
- Node.js 18+
- uv (Python package manager)

## Installation

### 1. Install uv (if not already installed)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Set up Python backend

```bash
cd backend
uv sync
```

### 3. Set up Electron frontend

```bash
cd frontend
npm install
```

### 4. Configure AI Provider

Create a `.env` file in the `backend` directory:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and add your API key:
- For OpenAI: `OPENAI_API_KEY=your_key_here`
- For Anthropic: `ANTHROPIC_API_KEY=your_key_here`

## Running the App

### Option 1: Run everything with one command

```bash
./run.sh
```

### Option 2: Run components separately

Terminal 1 - Backend:
```bash
cd backend
uv run python -m uvicorn main:app --host 127.0.0.1 --port 8765
```

Terminal 2 - Frontend:
```bash
cd frontend
npm start
```

## Usage

1. **Open a PDF**: Click "Open PDF" or use Ctrl+O
2. **Screenshot Mode**: Press `S` or click the screenshot button, then drag to select an area
3. **Ask a Question**: Type your question in the chat sidebar and press Enter
4. **Follow-up Questions**: Continue the conversation in the same chat thread
5. **Edit/Delete**: Hover over messages to edit or delete them
6. **Navigate**: Use scroll, arrow keys, or page controls to navigate the PDF

## File Format

Conversations are saved as `.chat` files (JSON format) alongside the PDF:

```
my-paper.pdf
my-paper.chat
```

The `.chat` file contains:
- PDF metadata
- All annotations with their locations (bounding boxes or text selections)
- Complete chat histories for each annotation

## Keyboard Shortcuts

- `Ctrl+O`: Open PDF
- `S`: Toggle screenshot mode
- `Ctrl+S`: Save (auto-save is enabled by default)
- `F11`: Toggle fullscreen
- `Escape`: Exit screenshot mode
- `+`/`-`: Zoom in/out
- `←`/`→`: Previous/Next page

## License

MIT
