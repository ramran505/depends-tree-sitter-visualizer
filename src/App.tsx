// CytoscapeEdgehandlesDemo.tsx
import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import edgehandles from "cytoscape-edgehandles";
import dagre from 'cytoscape-dagre';

cytoscape.use(edgehandles);
cytoscape.use(dagre);

/**
 * Improved DOT parser:
 * - collects node id -> label from lines like `n0 [label="foo"];`
 * - collects edges `n0 -> n1;`
 * - returns nodes as [{id,label}] and edges as [[sourceId, targetId], ...]
 */
function parseDotToElements(dot: string) {
  const idToLabel = new Map<string, string>();
  const nodeRegex = /([A-Za-z0-9_]+)\s*\[label\s*=\s*"(.*?)"\]\s*;?/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRegex.exec(dot)) !== null) {
    idToLabel.set(m[1], m[2]);
  }

  const edges: [string, string][] = [];
  const edgeRegex = /([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9_]+)\s*;?/g;
  while ((m = edgeRegex.exec(dot)) !== null) {
    const src = m[1], dst = m[2];
    edges.push([src, dst]);
    if (!idToLabel.has(src)) idToLabel.set(src, src);
    if (!idToLabel.has(dst)) idToLabel.set(dst, dst);
  }

  const nodes = Array.from(idToLabel.entries()).map(([id, label]) => ({ id, label }));
  return { nodes, edges };
}

/** Helper: make Cytoscape elements from parsed nodes/edges and add positions (non-overlapping) */
function buildCytoscapeElements(parsed: { nodes: { id: string; label: string }[]; edges: [string, string][] }) {
  const { nodes, edges } = parsed;
  const n = nodes.length || 1;
  const centerX = 400;
  const centerY = 250;
  const radius = Math.max(120, Math.min(300, 40 * n)); // scale radius with node count
  const angleStep = (2 * Math.PI) / n;

  const nodeElements = nodes.map((node, i) => ({
    data: { id: node.id, name: node.label },
    position: {
      x: centerX + radius * Math.cos(i * angleStep),
      y: centerY + radius * Math.sin(i * angleStep),
    },
  }));

  const edgeElements = edges.map(([s, t], i) => ({ data: { id: `e${i}`, source: s, target: t } }));

  return [...nodeElements, ...edgeElements];
}

const CytoscapeEdgehandlesDemo: React.FC = () => {
  const cyRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // popup state
  const [popupDot, setPopupDot] = useState<string | null>(null);
  const [popupTitle, setPopupTitle] = useState<string | null>(null);
  const [popupError, setPopupError] = useState<string | null>(null);

  useEffect(() => {
    let cyInstance: any = null;

    async function init() {
      if (!cyRef.current) return;

      try {
        const params = new URLSearchParams(window.location.search);
        const dotUrlParam = params.get("dot") || "depends-output-file.converted.dot";
        const fetchPath = dotUrlParam.startsWith("/") ? dotUrlParam : `/${dotUrlParam}`;

        const res = await fetch(fetchPath);
        if (!res.ok) throw new Error(`Failed to load DOT file: ${res.status} ${res.statusText}`);
        const dotText = await res.text();

        // Parse top-level dot into simple nodes/edges (assuming converted DOT uses labeled nodes)
        // NOTE: This parse expects node label lines or "quoted" edges. If your file uses different style,
        // adjust convertDot to embed labels as we expect.
        // Here we try both approaches: quoted edges or labeled nodes.
        // First try to extract quoted "A" -> "B" pattern:
        const quotedMatch = /"([^"]+)"\s*->\s*"([^"]+)"/.test(dotText);

        let elementsData: any[] = [];
        if (quotedMatch) {
          // simple quoted format (your earlier converted DOT)
          const nodesSet = new Set<string>();
          const edges: [string, string][] = [];
          for (const line of dotText.split("\n")) {
            const m = line.match(/"([^"]+)"\s*->\s*"([^"]+)"/);
            if (m) {
              edges.push([m[1], m[2]]);
              nodesSet.add(m[1]);
              nodesSet.add(m[2]);
            }
          }
          const nodesArr = Array.from(nodesSet);
          const centerX = 400, centerY = 250, radius = 200;
          const angleStep = (2 * Math.PI) / Math.max(1, nodesArr.length);
          elementsData = [
            ...nodesArr.map((id, idx) => ({
              data: { id, name: id },
              position: { x: centerX + radius * Math.cos(idx * angleStep), y: centerY + radius * Math.sin(idx * angleStep) },
            })),
            ...edges.map(([s, t], i) => ({ data: { id: `e${i}`, source: s, target: t } })),
          ];
        } else {
          // try labeled-node DOT form (n0 [label="..."]; n0 -> n1;)
          const parsed = parseDotToElements(dotText);
          elementsData = buildCytoscapeElements(parsed);
        }

        cyInstance = cytoscape({
          container: cyRef.current!,
          layout: { name: "preset" },
          style: [
            { selector: "node[name]", style: { content: "data(name)", "text-wrap": "wrap" } },
            { selector: "edge", style: { "curve-style": "bezier", "target-arrow-shape": "triangle" } },
            // minimal edgehandle styles for parity
            { selector: ".eh-handle", style: { "background-color": "red", width: 12, height: 12 } },
          ],
          elements: elementsData,
        });

        // Node click → fetch node's AST DOT and show popup
        cyInstance.on("tap", "node", async (evt: any) => {
          const nodeId: string = evt.target.data("id");
          setPopupError(null);
          setPopupTitle(nodeId);

          try {
            const result = await fetchDotForNode(nodeId);
            setPopupDot(result.text);
          } catch (err: any) {
            setPopupError(err.message || String(err));
            setPopupDot(null);
          }
        });
      } catch (err: any) {
        setError(err.message || String(err));
      }
    }

    init();

    return () => {
      if (cyInstance) cyInstance.destroy();
    };
  }, []);

  return (
<div className="w-screen h-screen bg-gray-100 relative">
  {error ? (
    <div className="p-4 text-red-600 font-mono">{error}</div>
  ) : (
    <div ref={cyRef} style={{ width: "100%", height: "100%" }} />
  )}

  {/* Full-Screen Popup */}
  {(popupDot || popupError) && (
    <div
      className="fixed inset-0 bg-black bg-opacity-80 z-50 flex flex-col"
      onClick={() => {
        setPopupDot(null);
        setPopupError(null);
        setPopupTitle(null);
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between bg-gray-900 text-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{popupTitle ?? "AST"}</h2>
        <button
          className="text-white hover:text-red-400 text-xl"
          onClick={() => {
            setPopupDot(null);
            setPopupError(null);
            setPopupTitle(null);
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div
        className="flex-1 bg-white overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {popupError ? (
          <div className="text-red-600 mb-2">
            <strong>Error fetching DOT:</strong> {popupError}
            <div className="mt-2 text-sm text-gray-600">
              Open DevTools → Network tab to see attempted URLs & responses.
            </div>
          </div>
        ) : null}

        {popupDot ? (
          <>
            <div style={{ width: "100%", height: "100%" }}>
              <DotViewer dot={popupDot} />
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer">Show raw DOT</summary>
              <pre className="whitespace-pre-wrap text-sm p-2 bg-slate-50 rounded mt-2 overflow-auto">
                {popupDot}
              </pre>
            </details>
          </>
        ) : !popupError ? (
          <div>Loading…</div>
        ) : null}
      </div>
    </div>
  )}
</div>

  );
};

/** Try multiple candidate URLs to find a dot file for the given node id */
async function fetchDotForNode(nodeId: string): Promise<{ url: string; text: string }> {
  // common locations to try:
  const candidates = [
    `/dot/${encodeURIComponent(nodeId)}.tree.dot`,
    `/dot/${encodeURIComponent(nodeId)}.dot`,
    `/dot/${encodeURIComponent(nodeId)}.tree.dot.txt`,
    `/${encodeURIComponent(nodeId)}.tree.dot`,
    `/${encodeURIComponent(nodeId)}.dot`,
    // sometimes filenames in converted DOT use plain basename: "main.py.tree.dot"
    `/dot/${encodeURIComponent(nodeId)}.tree.dot`,
    `/dot/${encodeURIComponent(nodeId)}.tree.dot`.replace(/%2F/g, "__"), // try replacing slashes with __
  ];

  const tried: string[] = [];
  for (const url of candidates) {
    if (tried.includes(url)) continue;
    tried.push(url);
    console.log("[fetchDotForNode] trying", url);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        console.log("[fetchDotForNode] found", url);
        return { url, text };
      } else {
        console.debug(`[fetchDotForNode] ${url} → ${res.status}`);
      }
    } catch (e) {
      console.debug(`[fetchDotForNode] fetch failed for ${url}`, e);
    }
  }

  // If none found, surface a useful error message
  throw new Error(`No DOT file found for "${nodeId}". Tried: ${tried.join(", ")}. Put the file in public/dot/ or ensure your server exposes /dot/ path.`);
}

/** DotViewer: uses the more robust parser for node ids and edges, then renders a Cytoscape instance */
const DotViewer: React.FC<{ dot: string }> = ({ dot }) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const parsed = parseDotToElements(dot);

    // No manual positions — dagre will handle layout
    const elements = [
      ...parsed.nodes.map(n => ({ data: { id: n.id, name: n.label } })),
      ...parsed.edges.map(([s, t], i) => ({ data: { id: `e${i}`, source: s, target: t } })),
    ];

  const cy = cytoscape({
  container: ref.current,
  style: [
    {
      selector: "node[name]",
      style: {
        content: "data(name)",
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        shape: "roundrectangle",
        width: "label",           // size to label width
        height: "label",          // size to label height
        padding: "10px",          // space around text
        "background-color": "#f0f0f0",
        "border-width": 1,
        "border-color": "#999",
        "font-size": 12           // adjust for readability
      }
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "target-arrow-shape": "triangle"
      }
    },
  ],
  elements,
  layout: {
    name: "dagre",
    rankDir: "TB",  // top-to-bottom
    nodeSep: 30,
    rankSep: 60,
    edgeSep: 20
  } as any
});

    // Auto-fit so whole AST is visible
    cy.ready(() => {
      cy.fit();
    });

    return () => cy.destroy();
  }, [dot]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
};



export default CytoscapeEdgehandlesDemo;
