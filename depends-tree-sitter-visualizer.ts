import { createServer } from 'http';
import handler from 'serve-handler';
import open from 'open';
import { fileURLToPath } from 'url';
import process from 'process';
import { constants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { Parser, Language } from 'web-tree-sitter';
import { Module, render } from 'viz.js/full.render.js'; // to generate PNG/SVG
import Viz from 'viz.js'; // the default export is the Emscripten factory
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3000;

/**
 * Tweak these to adjust initial / maximum heap sizes.
 * 1 page = 64 KB.
 */
const INITIAL_MB = 256;
const MAX_MB = 1024;

function mbToPages(mb: number) {
  return Math.max(1, Math.floor((mb * 1024 * 1024) / 65536));
}

function createMemory(initialPages = 256, maxPages = 512) {
  return new WebAssembly.Memory({ initial: initialPages, maximum: maxPages });
}

/**
 * Try to instantiate a Tree-sitter wasm with a larger, growable memory.
 * NOTE: some tree-sitter wasm files are Emscripten-built and expect
 * extra imported functions (realloc/malloc/free/etc). If that's the case,
 * this function will catch the LinkError and fall back to Language.load(path).
 *
 * In practice, the most robust fix for production is to recompile the
 * grammar .wasm with `-s ALLOW_MEMORY_GROWTH=1` (see message printed below).
 */
export async function loadTreeSitterLanguage(wasmFilePath: string): Promise<Language> {
  const wasmBytes = await fs.readFile(wasmFilePath);

  const memory = createMemory();
  const table = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });

  const memcpy = (dest: number, src: number, num: number) => {
    const mem = new Uint8Array(memory.buffer);
    mem.copyWithin(dest, src, src + num);
    return dest;
  };

  const memmove = (dest: number, src: number, num: number) => {
    const mem = new Uint8Array(memory.buffer);
    if (dest < src) {
      mem.copyWithin(dest, src, src + num);
    } else {
      // copy backwards to handle overlap
      for (let i = num - 1; i >= 0; i--) {
        mem[dest + i] = mem[src + i];
      }
    }
    return dest;
  };

  const realloc = (ptr: number, size: number) => {
    // In real Emscripten builds, this would resize heap allocations.
    // Here we just return 0 to signal "not implemented".
    return 0;
  };

  const imports: WebAssembly.Imports = {
    env: {
      memory,
      table,
      __memory_base: 0,
      memoryBase: 0,
      memcpy,
      memmove,
      realloc,
      abort: () => { throw new Error('abort'); }
    }
  };

  try {
    const wasmBytes = await fs.readFile(wasmFilePath);
    return await Language.load(wasmBytes);
  } catch (err) {
    console.warn('⚠️ Custom WebAssembly.instantiate for Tree-sitter failed:', err);
    console.warn('Falling back to Language.load(path) with default instantiation.');
    return await Language.load(wasmFilePath);
  }
}
/**
 * Create a Viz instance (viz.js) with a custom wasm memory.
 * Works by providing the raw wasm bytes and a wasmMemory override to the Viz factory.
 *
 * Requirements:
 *  - viz.js package provides a factory function as default export (VizFactory).
 *  - You must have the viz wasm file available; we try to resolve location automatically.
 */
export async function createVizWithMemory(): Promise<Viz> {
  let vizWasmPath: string | undefined;

  try {
    const candidate1 = path.resolve(__dirname, 'node_modules', 'viz.js', 'viz.wasm');
    await fs.access(candidate1);
    vizWasmPath = candidate1;
  } catch { /* ignore */ }

  let wasmBinary: Uint8Array | undefined;
  if (vizWasmPath) {
    wasmBinary = new Uint8Array(await fs.readFile(vizWasmPath));
  }

  const memory = createMemory();

  const viz = new Viz({
    Module,
    render,
    wasmMemory: memory,
    wasmBinary,
    locateFile: (file: string) => {
      if (file.endsWith('.wasm')) {
        return vizWasmPath ?? file;
      }
      return file;
    }
  });

  return viz;
}

async function renderDependsGraphs(dotPath: string) {
  console.log(`🎨 Rendering SVG and PNG for ${dotPath}...`);
  const viz = await createVizWithMemory();

  // Render SVG from DOT
  const svgText = await viz.renderString(await fs.readFile(dotPath, 'utf-8'), { format: 'svg' });
  const svgPath = dotPath.replace(/\.dot$/, '.svg');
  await fs.writeFile(svgPath, svgText, 'utf-8');

  // Convert SVG to PNG
  const pngBuffer = await sharp(Buffer.from(svgText)).png().toBuffer();
  const pngPath = dotPath.replace(/\.dot$/, '.png');
  await fs.writeFile(pngPath, pngBuffer);

  console.log(`✅ Saved SVG: ${svgPath}`);
  console.log(`✅ Saved PNG: ${pngPath}`);
}

async function parseFileWithTreeSitter(filePath: string, outputDir: string) {

  await fs.mkdir(outputDir, { recursive: true }); // ✅ Ensure output dir exists

  await Parser.init();
  const parser = new Parser();

  // Load Python grammar
  const lang = await loadTreeSitterLanguage(path.resolve(__dirname, 'tree-sitter-python.wasm'));
  parser.setLanguage(lang);

  // Read file
  const code = await fs.readFile(filePath, 'utf-8');
  const tree = parser.parse(code);

  if (tree == null) {
    throw new Error('Failed to parse file with Tree-sitter. Is it a valid Python file?')
  }

  // Output as .txt
  const txtPath = path.join(outputDir, `${path.basename(filePath)}.tree.txt`);
  await fs.writeFile(txtPath, tree.rootNode.toString(), 'utf-8');

  // Output as .json
  function nodeToJSON(node) {
    return {
      type: node.type,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      children: node.children.map(nodeToJSON),
    };
  }

  const jsonPath = path.join(outputDir, `${path.basename(filePath)}.tree.json`);
  await fs.writeFile(jsonPath, JSON.stringify(nodeToJSON(tree.rootNode), null, 2), 'utf-8');

  // 4. Build DOT graph from AST
  function nodeToDot(node: any, parentId: number, nextId: { value: number }, lines: string[]) {
    const myId = nextId.value++;
    lines.push(`  ${myId} [label="${node.type}"];`);
    if (parentId !== -1) {
      lines.push(`  ${parentId} -> ${myId};`);
    }
    for (let i = 0; i < node.childCount; i++) {
      nodeToDot(node.child(i), myId, nextId, lines);
    }
  }

  const dotLines: string[] = ['digraph AST {'];
  nodeToDot(tree.rootNode, -1, { value: 0 }, dotLines);
  dotLines.push('}');

  const dotGraph = dotLines.join('\n');
  const dotPath = path.join(outputDir, `${path.basename(filePath)}.tree.dot`);
  await fs.writeFile(dotPath, dotGraph, 'utf-8');

  // Render as graph (DOT → PNG/SVG)
  const dotFileGraph = treeToDot(tree);
  const viz = await createVizWithMemory();
  // SVG
  const svgPath = path.join(outputDir, `${path.basename(filePath)}.tree.svg`);
  const svgText = await viz.renderString(dotFileGraph, { format: 'svg' });

  // Write SVG directly
  await fs.writeFile(svgPath, svgText, 'utf-8');

  // Optional: Convert SVG → PNG using sharp (Node-friendly)
  const pngBuffer = await sharp(Buffer.from(svgText)).png().toBuffer();
  const pngPath = path.join(outputDir, `${path.basename(filePath)}.tree.png`);
  await fs.writeFile(pngPath, pngBuffer);

  console.log(`✅ Tree-sitter output for ${filePath} written to ${outputDir}`);
}

function treeToDot(tree) {
  let idCounter = 0;
  const lines = ['digraph G {'];

  function addNode(node) {
    const nodeId = `n${idCounter++}`;
    lines.push(`${nodeId} [label="${node.type}"];`);
    for (const child of node.children) {
      const childId = addNode(child);
      lines.push(`${nodeId} -> ${childId};`);
    }
    return nodeId;
  }

  addNode(tree.rootNode);
  lines.push('}');
  return lines.join('\n');
}

async function runDependsJar(language: string, srcPath: string, outputDir: string): Promise<void> {
  const jarPath = path.resolve(__dirname, 'depends.jar');
  const outputFileName = 'depends-output-file'; // keep in sync with findDotFile later

  await fs.mkdir(outputDir, { recursive: true }); // ✅ Ensure output dir exists

  console.log('📦 Running depends.jar...');

  await new Promise<void>((resolve, reject) => {
    const javaProcess = spawn('java', [
      '-jar',
      jarPath,
      '-d', outputDir,
      '-f', 'dot',
      '-f', 'json',
      '-f', 'svg', // ✅ ensure SVG generated
      '-f', 'png', // ✅ ensure PNG generated
      language,
      srcPath,
      outputFileName
    ], { stdio: 'inherit' });

    javaProcess.on('close', code => {
      if (code === 0) {
        console.log('✅ depends.jar finished');
        resolve();
      } else {
        reject(new Error(`❌ depends.jar exited with code ${code}`));
      }
    });
  });
}

export async function convertDotIds(dotPath: string) {
  console.log('📄 DOT file path:', dotPath);

  try {
    // 1. Read and normalize DOT content
    const dot = (await fs.readFile(dotPath, 'utf-8')).replaceAll('\r\n', '\n');
    console.log('📄 Raw DOT content:\n', dot);

    // 2. Extract ID to label mapping from comment lines
    const idToLabel = new Map<string, string>();
    const commentRegex = /\/\/\s*(\d+):(.*)/g;
    let match;
    while ((match = commentRegex.exec(dot)) !== null) {
      const [, id, fullPath] = match;
      const label = path.basename(fullPath);
      idToLabel.set(id, label);
    }

    console.log('🔍 ID to label map:', idToLabel);

    // 3. Replace edges like `2 -> 1` with `"main.py" -> "logger.py"`
    let newDot = dot.replace(/^(\s*)(\d+)\s+->\s+(\d+);/gm, (_, space, from, to) => {
      const fromLabel = idToLabel.get(from) || from;
      const toLabel = idToLabel.get(to) || to;
      return `${space}"${fromLabel}" -> "${toLabel}";`;
    });

    // 4. Remove comment lines and empty lines
    newDot = newDot.replace(/^\/\/.*$/gm, '').replace(/^\s*[\r\n]/gm, '');

    // 5. Write to new DOT file
    const dotDir = path.dirname(dotPath);
    const dotBase = path.basename(dotPath, '.dot');
    const newDotPath = path.join(dotDir, `${dotBase}.converted.dot`);
    await fs.writeFile(newDotPath, newDot, 'utf-8');
    console.log(`✅ DOT IDs converted → ${newDotPath}`);

    // 6. Try to load the corresponding JSON file
    const jsonPath = path.join(dotDir, `${dotBase}.json`);
    try {
      const rawJson = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(rawJson);

      // Build cleaned JSON with base filenames
      const newVariables = parsed.variables.map((v: string) => path.basename(v));

      const newCells = parsed.cells.map((cell: any) => ({
        src: newVariables[cell.src],
        dest: newVariables[cell.dest],
        values: cell.values
      }));

      const newJson = {
        ...parsed,
        variables: newVariables,
        cells: newCells
      };

      const newJsonPath = path.join(dotDir, `${dotBase}.converted.json`);
      await fs.writeFile(newJsonPath, JSON.stringify(newJson, null, 2), 'utf-8');
      console.log(`✅ JSON converted → ${newJsonPath}`);
    } catch (err) {
      console.warn('⚠️ JSON file not found or failed to convert:', err.message);
    }

  } catch (err) {
    console.error('❌ Failed to convert DOT file:', err);
  }
}

async function serveVisualizer(port: number, dotPath: string) {
  const visualizerDir = path.join(__dirname, 'dist');
  const dotFilename = path.basename(dotPath);

  const server = createServer((req, res) => {
    if (req.url?.startsWith(`/dot/`)) {
      // Rewrite the URL so that serve-handler serves the correct file
      req.url = req.url.replace('/dot', '');
      return handler(req, res, {
        public: path.dirname(dotPath),
      });
    }

    return handler(req, res, {
      public: visualizerDir,
    });
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/?dot=${dotFilename}`;
    console.log(`🌐 Visualizer available at ${url}`);
    open(url);
  });
}

async function findDotFile(outputDir: string, filename: string): Promise<string> {  
  const dotFile = path.join(outputDir, filename);
  
  try {
    await fs.access(dotFile, constants.F_OK);
  } catch {
    throw new Error('No .dot file found in output');
  }

  if (!dotFile) {
    throw new Error(`No .dot file found in ${outputDir}`);
  }

  return dotFile;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: bunx tsx depends-tree-sitter-visualizer.ts <language> <src> <output-dir> [--web] [--port <port>] [--only-tree-sitter] [--only-depends]');
    process.exit(1);
  }

  const [language, src, outputDir] = args;
  const runWeb = args.includes('--web');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : DEFAULT_PORT;

  const onlyTreeSitter = args.includes('--only-tree-sitter');
  const onlyDepends = args.includes('--only-depends');

  try {
    let convertedDotFilePath: string | undefined;

    // --- DEPENDS.JAR SECTION ---
    if (!onlyTreeSitter) {
      await runDependsJar(language, src, outputDir);

      const dotFilePath = await findDotFile(outputDir, 'depends-output-file.dot');

      console.log("🔧 Converting DOT file IDs...");
      await convertDotIds(dotFilePath);
      console.log("✅ Done converting DOT file IDs.");

      convertedDotFilePath = await findDotFile(outputDir, 'depends-output-file.converted.dot');

      await renderDependsGraphs(convertedDotFilePath);

    }

    // --- TREE-SITTER SECTION ---
    if (!onlyDepends) {
      console.log("🔍 Running Tree-sitter on each file...");
      const filesToParse = await fs.readdir(src);
      for (const file of filesToParse) {
        if (file.endsWith('.py')) { // change this for other languages
          const fullPath = path.join(src, file);
          await parseFileWithTreeSitter(fullPath, outputDir);
        }
      }
    }

    // --- SERVE VISUALIZER ---
    if (runWeb) {
      if (!convertedDotFilePath) {
        throw new Error('No DOT file found to visualize.');
      }
      await serveVisualizer(port, convertedDotFilePath);
    }
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}


main();
