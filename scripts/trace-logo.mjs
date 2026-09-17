// Trace a 1-bit PNG into SVG paths.
//
// No potrace, no ImageMagick, no PIL on this machine — but zlib is built into
// Node, and the logo is a handful of solid shapes with no holes, which is the
// easy case. Decode, threshold, follow each boundary, simplify, emit.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const file = process.argv[2];
const OUT = process.argv[3] ?? "logo.svg";

// ------------------------------------------------------------- decode PNG
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, depth = 0, colour = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`unsupported colour type ${colour}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec 9.2).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

// ------------------------------------------------------------- threshold
const { width, height, channels, pixels } = decodePng(readFileSync(file));

// Work out whether the shape is dark-on-light or light-on-dark by sampling
// the corners, which are always background.
const lum = (x, y) => {
  const i = (y * width + x) * channels;
  const a = channels === 4 ? pixels[i + 3] : 255;
  if (a < 128) return 255; // transparent counts as background
  return 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
};
const corners = [lum(1, 1), lum(width - 2, 1), lum(1, height - 2), lum(width - 2, height - 2)];
const bgLight = corners.reduce((a, b) => a + b, 0) / 4 > 128;
const isInk = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const l = lum(x, y);
  return bgLight ? l < 128 : l > 128;
};

// ------------------------------------------------ connected components
const seen = new Uint8Array(width * height);
const comps = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (!isInk(x, y) || seen[y * width + x]) continue;
    const stack = [[x, y]];
    const cells = [];
    seen[y * width + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      cells.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (isInk(nx, ny) && !seen[ny * width + nx]) {
          seen[ny * width + nx] = 1;
          stack.push([nx, ny]);
        }
      }
    }
    if (cells.length > 40) comps.push(cells); // drop specks
  }
}
comps.sort((a, b) => b.length - a.length);

// ------------------------------------------------------- boundary trace
// Moore-neighbour tracing on the pixel grid, walking the outside edge.
function traceOutline(cells) {
  const set = new Set(cells.map(([x, y]) => y * width + x));
  const has = (x, y) => set.has(y * width + x);
  // start at the topmost-leftmost cell
  let start = cells[0];
  for (const c of cells) if (c[1] < start[1] || (c[1] === start[1] && c[0] < start[0])) start = c;

  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const path = [];
  let [cx, cy] = start;
  let dir = 6; // came from above
  const first = `${cx},${cy}`;
  let guard = 0;
  do {
    path.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // start looking to the left of travel
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (has(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
    }
    if (!found) break;
  } while ((`${cx},${cy}` !== first || path.length < 3) && ++guard < 400000);
  return path;
}

// ------------------------------------------------------------- simplify
function rdp(points, eps) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, idx + 1), eps).slice(0, -1), ...rdp(points.slice(idx), eps)];
}

// --------------------------------------------------------------- output
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const outlines = comps.map((cells) => {
  const simplified = rdp(traceOutline(cells), 0.9);
  for (const [x, y] of simplified) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return simplified;
});

// Normalise into a tidy 0..100 box, preserving aspect.
const w = maxX - minX, h = maxY - minY;
const scale = 100 / Math.max(w, h);
const offX = (100 - w * scale) / 2, offY = (100 - h * scale) / 2;
const fmt = (n) => Number(n.toFixed(2)).toString();

const paths = outlines.map((pts) => {
  const d = pts.map(([x, y], i) =>
    `${i ? "L" : "M"}${fmt((x - minX) * scale + offX)} ${fmt((y - minY) * scale + offY)}`).join("");
  return `<path d="${d}Z"/>`;
});

const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="currentColor">\n  ${paths.join("\n  ")}\n</svg>\n`;
writeFileSync(OUT, svg);

console.log(`  source      ${width}x${height}, ${bgLight ? "dark ink on light" : "light ink on dark"}`);
console.log(`  shapes      ${comps.length}`);
comps.forEach((c, i) => console.log(`    ${i + 1}: ${String(c.length).padStart(7)} px -> ${outlines[i].length} points`));
console.log(`  bounds      ${w}x${h} -> normalised to a 100x100 box`);
console.log(`  wrote       ${OUT}  (${svg.length} bytes)`);
