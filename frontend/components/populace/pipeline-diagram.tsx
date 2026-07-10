"use client";

// A single-SVG flow diagram of the populace-US pipeline. Hand-laid layout —
// the node set mirrors lib/populace/pipeline.ts (derived from the populace
// repo), kept deliberately compact so the whole flow reads in one glance.

interface Node {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  kind: "source" | "input" | "step" | "gate" | "artifact" | "publish";
}

interface Edge {
  from: string;
  to: string;
}

const W = 1280;
const H = 560;

const NODES: Node[] = [
  // Column 0 — source surveys (upstream enrichment, baked into the base H5)
  { id: "cps", x: 20, y: 24, w: 150, h: 40, title: "CPS ASEC", sub: "base survey", kind: "source" },
  { id: "puf", x: 20, y: 72, w: 150, h: 34, title: "IRS PUF", sub: "tax detail · mortgage", kind: "source" },
  { id: "scf", x: 20, y: 114, w: 150, h: 34, title: "Fed SCF", sub: "wealth", kind: "source" },
  { id: "sipp", x: 20, y: 156, w: 150, h: 34, title: "Census SIPP", sub: "tips · vehicles", kind: "source" },
  { id: "org", x: 20, y: 198, w: 150, h: 34, title: "CPS ORG", sub: "wages · overtime", kind: "source" },
  { id: "misc", x: 20, y: 240, w: 150, h: 34, title: "MEPS · ACS · CMS", sub: "ESI · rent · ACA", kind: "source" },

  // Column 1 — build inputs
  { id: "base", x: 235, y: 118, w: 170, h: 52, title: "Prior release H5", sub: "populace_us_2024.h5", kind: "input" },
  { id: "ledger", x: 235, y: 330, w: 170, h: 46, title: "Ledger facts", sub: "IRS · Census · CMS · JCT…", kind: "input" },
  { id: "refs", x: 235, y: 388, w: 170, h: 46, title: "Target references", sub: "fiscal_target_references.json", kind: "input" },
  { id: "valcfg", x: 235, y: 446, w: 170, h: 46, title: "Validation configs", sub: "OBBBA · tax-exp · SOI levels", kind: "input" },

  // Column 2 — prep
  { id: "frame", x: 470, y: 90, w: 175, h: 46, title: "Load frame + repairs", sub: "population mass · SS comp.", kind: "step" },
  { id: "gates1", x: 470, y: 148, w: 175, h: 36, title: "Base gates", sub: "pop. scale · health inputs", kind: "gate" },
  { id: "registry", x: 470, y: 340, w: 175, h: 46, title: "Compile targets", sub: "~6.9k specs · 11 families", kind: "step" },
  { id: "gates2", x: 470, y: 398, w: 175, h: 36, title: "Coverage gate", sub: "target profile", kind: "gate" },

  // Column 3 — core compute
  { id: "materialize", x: 710, y: 200, w: 180, h: 54, title: "Materialize targets", sub: "PE-US microsims → matrix", kind: "step" },
  { id: "calibrate", x: 710, y: 286, w: 180, h: 54, title: "Calibrate weights", sub: "torch · capped MAPE · ratio ≤5", kind: "step" },
  { id: "gates3", x: 710, y: 352, w: 180, h: 36, title: "Release gates", sub: "fit · weights", kind: "gate" },

  // Column 4 — artifacts
  { id: "dataset", x: 955, y: 120, w: 180, h: 46, title: "Dataset H5", sub: "calibrated weights", kind: "artifact" },
  { id: "diag", x: 955, y: 178, w: 180, h: 46, title: "Calibration diagnostics", sub: "per-target fit · loss curve", kind: "artifact" },
  { id: "reform", x: 955, y: 236, w: 180, h: 46, title: "Reform validation", sub: "JCT stacked · SOI actuals", kind: "artifact" },
  { id: "othera", x: 955, y: 294, w: 180, h: 46, title: "Demographics · coverage", sub: "+ build/release manifests", kind: "artifact" },

  // Column 5 — staging + publish
  { id: "staging", x: 955, y: 402, w: 180, h: 52, title: "Staging (live)", sub: "telemetry → candidate review", kind: "step" },
  { id: "publish", x: 1180 - 160, y: 480, w: 240, h: 56, title: "populace-publish-release", sub: "guards → HF tag → latest.json → Slack", kind: "publish" },
];

const EDGES: Edge[] = [
  { from: "cps", to: "base" },
  { from: "puf", to: "base" },
  { from: "scf", to: "base" },
  { from: "sipp", to: "base" },
  { from: "org", to: "base" },
  { from: "misc", to: "base" },
  { from: "base", to: "frame" },
  { from: "frame", to: "gates1" },
  { from: "ledger", to: "registry" },
  { from: "refs", to: "registry" },
  { from: "registry", to: "gates2" },
  { from: "gates1", to: "materialize" },
  { from: "gates2", to: "materialize" },
  { from: "materialize", to: "calibrate" },
  { from: "calibrate", to: "gates3" },
  { from: "gates3", to: "dataset" },
  { from: "gates3", to: "diag" },
  { from: "gates3", to: "reform" },
  { from: "gates3", to: "othera" },
  { from: "valcfg", to: "reform" },
  { from: "gates3", to: "staging" },
  { from: "dataset", to: "publish" },
  { from: "othera", to: "publish" },
  { from: "staging", to: "publish" },
];

// Node styling drawn entirely from ui-kit tokens so the diagram tracks the
// shared palette. Applied via inline style (not SVG fill/stroke attributes) so
// var() resolves reliably across browsers.
const KIND_STYLE: Record<Node["kind"], { fill: string; stroke: string; text: string }> = {
  source: {
    fill: "var(--color-blue-50)",
    stroke: "var(--color-blue-300)",
    text: "var(--color-blue-800)",
  },
  input: {
    fill: "var(--background-secondary)",
    stroke: "var(--color-gray-400)",
    text: "var(--color-gray-900)",
  },
  step: {
    fill: "var(--card)",
    stroke: "var(--chart-1)",
    text: "var(--color-gray-900)",
  },
  gate: {
    fill: "color-mix(in srgb, var(--color-warning) 12%, var(--card))",
    stroke: "var(--color-warning)",
    text: "var(--warn)",
  },
  artifact: {
    fill: "color-mix(in srgb, var(--color-success) 12%, var(--card))",
    stroke: "var(--color-success)",
    text: "var(--text-success)",
  },
  publish: {
    fill: "var(--chart-1)",
    stroke: "var(--primary)",
    text: "var(--primary-foreground)",
  },
};

function anchor(node: Node, side: "left" | "right" | "top" | "bottom") {
  switch (side) {
    case "left":
      return { x: node.x, y: node.y + node.h / 2 };
    case "right":
      return { x: node.x + node.w, y: node.y + node.h / 2 };
    case "top":
      return { x: node.x + node.w / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.w / 2, y: node.y + node.h };
  }
}

function edgePath(a: Node, b: Node): string {
  // Mostly left-to-right flow; fall back to vertical connectors when stacked.
  const horizontal = b.x >= a.x + a.w - 4;
  if (horizontal) {
    const p1 = anchor(a, "right");
    const p2 = anchor(b, "left");
    const mid = (p1.x + p2.x) / 2;
    return `M ${p1.x} ${p1.y} C ${mid} ${p1.y}, ${mid} ${p2.y}, ${p2.x} ${p2.y}`;
  }
  const down = b.y > a.y;
  const p1 = anchor(a, down ? "bottom" : "top");
  const p2 = anchor(b, down ? "top" : "bottom");
  const mid = (p1.y + p2.y) / 2;
  return `M ${p1.x} ${p1.y} C ${p1.x} ${mid}, ${p2.x} ${mid}, ${p2.x} ${p2.y}`;
}

export function PipelineDiagram() {
  const byId = new Map(NODES.map((n) => [n.id, n]));
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="min-w-[900px]"
        role="img"
        aria-label="populace dataset pipeline flow diagram"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" style={{ fill: "var(--color-gray-400)" }} />
          </marker>
        </defs>

        {/* lane labels */}
        {[
          { x: 20, label: "SOURCE SURVEYS" },
          { x: 235, label: "BUILD INPUTS" },
          { x: 470, label: "PREPARE" },
          { x: 710, label: "COMPUTE" },
          { x: 955, label: "ARTIFACTS & SHIP" },
        ].map((l) => (
          <text key={l.x} x={l.x} y={14} fontSize="10" fontWeight="700" style={{ fill: "var(--color-gray-400)" }} letterSpacing="0.08em">
            {l.label}
          </text>
        ))}

        {EDGES.map((e, i) => {
          const a = byId.get(e.from)!;
          const b = byId.get(e.to)!;
          return (
            <path
              key={i}
              d={edgePath(a, b)}
              fill="none"
              style={{ stroke: "var(--color-gray-300)" }}
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          );
        })}

        {NODES.map((n) => {
          const s = KIND_STYLE[n.kind];
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx="8"
                style={{ fill: s.fill, stroke: s.stroke }}
                strokeWidth="1.4"
              />
              {/* HTML labels clip/wrap inside the box regardless of the
                  viewer's font metrics — raw SVG <text> does neither. */}
              <foreignObject x={n.x} y={n.y} width={n.w} height={n.h}>
                <div
                  className="flex h-full flex-col justify-center overflow-hidden px-2.5"
                  style={{ color: s.text }}
                >
                  <div className="truncate text-[11px] font-semibold leading-tight">
                    {n.title}
                  </div>
                  {n.sub && (
                    <div
                      className="truncate text-[9px] leading-tight"
                      style={{
                        color:
                          n.kind === "publish"
                            ? "var(--color-teal-50)"
                            : "var(--paper-faint)",
                      }}
                    >
                      {n.sub}
                    </div>
                  )}
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* legend */}
        <g transform={`translate(20, ${H - 44})`} fontSize="10" style={{ fill: "var(--paper-faint)" }}>
          {(
            [
              ["source", "survey source"],
              ["input", "build input"],
              ["step", "pipeline step"],
              ["gate", "gate"],
              ["artifact", "artifact"],
              ["publish", "publish"],
            ] as const
          ).map(([kind, label], i) => (
            <g key={kind} transform={`translate(${i * 130}, 0)`}>
              <rect width="14" height="14" rx="4" style={{ fill: KIND_STYLE[kind].fill, stroke: KIND_STYLE[kind].stroke }} strokeWidth="1.4" />
              <text x="20" y="11">{label}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
