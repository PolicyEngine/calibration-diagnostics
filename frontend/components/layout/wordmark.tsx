// The Microcosm wordmark, from constellation-design/identities/microcosm/
// wordmark.svg (third cut, 2026-08-02): lowercase Urbanist on the face's own
// slot advances, the focus fade (.96/.90/.83/.75 by distance from the
// operator), and the drawn verdigris world-point concentric with the first o.
// Letter ink rides currentColor so the mark inherits its context's text
// color; the point reads var(--accent).
const LETTERS: [number, string, number][] = [
  [444.25, "m", 0.75],
  [1023.5, "i", 0.83],
  [1413.25, "c", 0.9],
  [1886.75, "r", 0.96],
  [2385.5, "o", 1],
  [2960.25, "c", 0.96],
  [3535, "o", 0.9],
  [4069.75, "s", 0.83],
  [4768.75, "m", 0.75],
];

export function Wordmark() {
  return (
    <svg
      className="wm"
      viewBox="-16 -690 5245 726"
      role="img"
      aria-label="microcosm"
    >
      <g
        textAnchor="middle"
        style={{ fontFamily: "var(--font-wordmark)" }}
        fontSize="1000"
        fontWeight="400"
        fill="currentColor"
      >
        {LETTERS.map(([x, ch, o], i) => (
          <text key={i} x={x} y="0" fillOpacity={o < 1 ? o : undefined}>
            {ch}
          </text>
        ))}
      </g>
      <circle cx="2385.5" cy="-251" r="77" fill="var(--accent)" />
    </svg>
  );
}
