# Translate Extension

![Vibe Coding](https://img.shields.io/badge/vibe-coding-blueviolet)

A modern, bidirectional Chinese-English translation browser extension built with the [WXT Framework](https://wxt.dev/).

## 🌟 Features

- **Context Menu Integration**: Select any text on a webpage and right-click to translate.
- **Bidirectional Translation**: Automatically detects whether the source text is English or Chinese and translates to the other language.
- **Multiple Translation Engines**:
  - **Google Translate** (Default)
  - **Microsoft Edge Translate**
  - **Tencent Transmart**
  - **OpenRouter (LLM)**: Support for AI-powered translations (requires API key).
- **Modern UI**: Clean and responsive translation dialog built with **DaisyUI** and **Tailwind CSS**.
- **Style Isolation**: Uses **Shadow DOM** to ensure the extension UI doesn't conflict with host website styles.
- **Fast & Lightweight**: Built on top of Vite and WXT for optimal performance.

## 🛠 Tech Stack

- **Framework**: [WXT](https://wxt.dev/)
- **UI Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) & [DaisyUI](https://daisyui.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Linter/Formatter**: [Oxlint](https://oxc-project.github.io/oxlint/) & [Oxfmt](https://oxc-project.github.io/oxfmt/)

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd DuoFlux-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development

Run the extension in development mode (supports HMR):

```bash
# Chrome / Edge
npm run dev

# Firefox
npm run dev:firefox
```

### Building

Build the production-ready extension:

```bash
# Chrome / Edge
npm run build

# Firefox
npm run build:firefox
```

The output will be in the `.output/` directory.

## ⚙️ Configuration

To use the **OpenRouter** or **Google** translation services, you need to provide API keys. Create a `.env` file in the root directory (do not commit this file):

```env
WXT_OPENROUTER_API_KEY=your_openrouter_key
WXT_OPENROUTER_MODEL=google/gemma-3-27b-it:free
WXT_GOOGLE_HTML_API_KEY=your_google_key
```

## 📂 Project Structure

- `entrypoints/`: Extension entry points.
  - `background.ts`: Handles context menus, message passing, and translation logic.
  - `content.ts`: Injects the translation UI into webpages.
  - `popup/`: Extension popup UI (settings/about).
- `components/`: Reusable React components.
- `utils/`: Utility functions, including translation service wrappers and loggers.
- `assets/`: Static assets like icons.

## 🤝 Contributing

Please follow the coding standards defined in `AGENTS.md`:

- Use strict TypeScript.
- Follow the established message passing patterns.
- Ensure UI components use Tailwind/DaisyUI.
- Handle errors gracefully in both background and UI layers.

## 📄 License

[MIT License](LICENSE)
