// Squarified treemap layout (Bruls, Huizing & van Wijk, 2000). Produces cells
// whose aspect ratios stay close to 1, which keeps labels readable and the map
// legible — the reason we don't lean on a slice-and-dice default.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sized<T> {
  value: number;
  data: T;
}

export interface Placed<T> extends Rect {
  value: number;
  data: T;
}

function worstRatio(areas: number[], length: number): number {
  if (areas.length === 0 || length <= 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const length2 = length * length;
  const sum2 = sum * sum;
  return Math.max((length2 * max) / sum2, sum2 / (length2 * min));
}

export function squarify<T>(items: Sized<T>[], rect: Rect): Placed<T>[] {
  const result: Placed<T>[] = [];
  const total = items.reduce((s, i) => s + Math.max(i.value, 0), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return result;

  const scale = (rect.w * rect.h) / total;
  const nodes = items
    .map((i) => ({ value: i.value, data: i.data, area: Math.max(i.value, 0) * scale }))
    .filter((n) => n.area > 0)
    .sort((a, b) => b.area - a.area);

  let { x, y, w, h } = rect;
  let i = 0;

  while (i < nodes.length) {
    const length = Math.min(w, h);
    const row: typeof nodes = [nodes[i]];
    let rowAreas = [nodes[i].area];
    i += 1;

    // Grow the row while doing so improves (lowers) the worst aspect ratio.
    while (i < nodes.length) {
      const withNext = [...rowAreas, nodes[i].area];
      if (worstRatio(withNext, length) <= worstRatio(rowAreas, length)) {
        row.push(nodes[i]);
        rowAreas = withNext;
        i += 1;
      } else {
        break;
      }
    }

    const rowSum = rowAreas.reduce((s, a) => s + a, 0);
    const thickness = rowSum / length;

    if (w >= h) {
      // Lay the row as a vertical strip on the left edge.
      let pos = y;
      for (const n of row) {
        const side = n.area / thickness;
        result.push({ x, y: pos, w: thickness, h: side, value: n.value, data: n.data });
        pos += side;
      }
      x += thickness;
      w -= thickness;
    } else {
      // Lay the row as a horizontal strip along the top edge.
      let pos = x;
      for (const n of row) {
        const side = n.area / thickness;
        result.push({ x: pos, y, w: side, h: thickness, value: n.value, data: n.data });
        pos += side;
      }
      y += thickness;
      h -= thickness;
    }
  }

  return result;
}
