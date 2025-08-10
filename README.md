# 🚀 Depends & Tree-sitter Visualizer

This project provides a CLI tool to analyze source code dependencies using **Depends** and parse source code ASTs with **Tree-sitter**.  
It generates visualizations (DOT, SVG, PNG) for both Depends and Tree-sitter outputs and can serve an interactive web visualizer. 🌐

---

## ✨ Features

- 📦 Run [Depends](https://github.com/lucas-la/depends) on source code to generate dependency graphs (DOT, JSON, SVG, PNG).  
- 🔍 Parse source files with Tree-sitter to generate AST graphs (DOT, JSON, TXT, SVG, PNG).  
- 🛠️ Convert DOT files with numeric IDs to human-readable labels based on filenames.  
- 🌐 Serve a local web visualizer to explore DOT graphs interactively.  
- 🐍 Supports Python projects out-of-the-box using `tree-sitter-python.wasm`.  

---

## ⚙️ Prerequisites & Setup

### 1️⃣ Install system dependencies

You need to install the following software:

- ☕ **Java (OpenJDK)** — to run `depends.jar`  
- 🟢 **Node.js** (v18+) and **npm** — for JavaScript dependencies  
- 🔥 **bun** — fast JavaScript runtime and package manager  
- 🖼️ **Graphviz** — for rendering DOT graphs (optional but recommended)  
- 🐍 **Python** (3.8+) — required by some utilities  

---

### 2️⃣ Installation commands by OS

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y openjdk-11-jdk nodejs npm graphviz python3 python3-pip
curl -fsSL https://bun.sh/install | bash
````

**macOS (with Homebrew):**

```bash
brew update
brew install openjdk node graphviz python
curl -fsSL https://bun.sh/install | bash
```

**Windows:**

* Download and install from official sites:

  * [OpenJDK](https://adoptium.net/)
  * [Node.js](https://nodejs.org/)
  * [Graphviz](https://graphviz.org/download/)
  * [Python](https://www.python.org/downloads/)
* Then install bun via PowerShell or WSL:

```powershell
iwr https://bun.sh/install -useb | iex
```

---

### 3️⃣ Verify required files exist

* `depends.jar` — place in project root
* `tree-sitter-python.wasm` — place in project root

---

### 4️⃣ Install project dependencies

Use bun to install dependencies:

```bash
bun install
```

---

### 5️⃣ Build the web visualization assets

Generate the `dist` folder with:

```bash
bun run build
```

---

## ▶️ Usage

Run the visualizer script:

```bash
bunx tsx depends-tree-sitter-visualizer.ts <language> <source-path> <output-dir> [--web] [--port <port>] [--only-tree-sitter] [--only-depends]
```

| Argument             | Description                          |
| -------------------- | ------------------------------------ |
| `<language>`         | Programming language (e.g., python)  |
| `<source-path>`      | Path to source code folder           |
| `<output-dir>`       | Output directory for generated files |
| `--web`              | Launch the web visualizer server     |
| `--port`             | Web server port (default: 3000)      |
| `--only-tree-sitter` | Run only Tree-sitter parsing         |
| `--only-depends`     | Run only Depends analysis            |

---

## 💡 Notes

* Tree-sitter parsing currently supports **small Python projects** only.
* Outputs include `.dot`, `.svg`, `.png`, `.json`, `.txt` for both Depends and Tree-sitter.
* The web visualizer serves from the React `dist` folder and loads DOT graphs dynamically.
* Make sure Java, Graphviz, Node.js, and bun are installed and available in your PATH.

---

## 📝 Example

```bash
bunx tsx depends-tree-sitter-visualizer.ts python ./example-project ./output --web --port 4000
```

This will:

* 📦 Run Depends on Python source in `./example-project`
* 🔍 Parse `.py` files with Tree-sitter
* 🎨 Generate graphs & visualizations in `./output`
* 🌐 Launch web server at [http://localhost:4000](http://localhost:4000) to view graphs

---

## 📁 Project Structure

```
.
├── depends.jar
├── tree-sitter-python.wasm
├── depends-tree-sitter-visualizer.ts
├── package.json
├── dist/                   # React visualization app build output
├── output/                 # Generated graphs and visualizations
└── README.md
```

---

## ❓ Questions?

Feel free to ask if you need help or want to contribute! 🙌

