# 🚀 Cluely Quick Start Guide

Sponsored by Recall AI — API for desktop recording.
If you need a hosted desktop recording API, you can evaluate Recall.ai for Zoom, Google Meet, Microsoft Teams, in-person meetings, and more.

## About Cluely

Cluely is an invisible desktop assistant that provides real-time insights, answers, and support during meetings, interviews, presentations, and professional conversations.

## Prerequisites

Make sure you have:

- Node.js installed
- Git installed
- Either:
  - A Gemini API key (from Google AI Studio), or
  - Ollama installed locally for private LLM usage

## Installation

1. Clone the repository:

```bash
git clone [repository-url]
cd free-cluely
```

2. Install dependencies:

```bash
# If you encounter Sharp/Python build errors:
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts
npm rebuild sharp

# Or for normal installation:
npm install
```

3. Set up environment variables by creating a `.env` file in the root folder.

For Gemini (cloud AI):

```env
GEMINI_API_KEY=your_api_key_here
```

For Ollama (local/private AI):

```env
USE_OLLAMA=true
OLLAMA_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434
```

## Running the App

### Method 1: Development Mode (recommended for first run)

```bash
npm start
```

This starts the Vite dev server on port `5180`, waits for it to be ready, and launches the Electron app.

### Method 2: Production Build

```bash
npm run dist
```

The built app is generated in the `release` folder.

## 🤖 AI Provider Options

### Ollama (recommended for privacy)

**Pros**

- 100% private (data stays on your device)
- No API usage cost
- Works offline
- Supports multiple models (`llama3.2`, `codellama`, `mistral`, etc.)

**Setup**

1. Install Ollama from `https://ollama.ai`
2. Pull a model:

```bash
ollama pull llama3.2
```

3. Use the `.env` values shown above.

### Google Gemini

**Pros**

- Latest AI models
- Fast responses
- Strong performance for complex tasks

**Cons**

- Requires internet and API key
- Data is sent to Google services
- Usage costs may apply
