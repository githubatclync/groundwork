// Draws the PNG export overlays onto a 2D canvas: title, legend, scale bar, north arrow, and
// attribution. All measurements are in CSS pixels and multiplied by `k` (output pixels per CSS
// pixel), so the overlays look the same at 1x, 2x, and 4x.
import type { LegendEntry, ScaleBar, Swatch } from './imageExportLayout';

export interface OverlayOptions {
  title: string;
  /** Bar to draw with its length in CSS pixels, or null to omit it. */
  scaleBar: (ScaleBar & { lengthCssPx: number }) | null;
  /** Camera heading in radians (0 = north up), or null to omit the north arrow. */
  headingRad: number | null;
  legend: LegendEntry[];
  /** Always drawn: the basemap's required attribution. */
  attribution: string;
}

const FONT = 'system-ui, "Segoe UI", sans-serif';
const BACKING = 'rgba(255,255,255,0.88)';
const INK = '#1a1a1a';

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = BACKING;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(1, r / 6);
  ctx.stroke();
}

/** Splits text into lines no wider than `maxWidth` (in the context's current font). */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawSwatch(ctx: CanvasRenderingContext2D, s: Swatch, x: number, y: number, size: number) {
  ctx.lineWidth = Math.max(1, size / 8);
  ctx.strokeStyle = s.stroke;
  if (s.kind === 'line') {
    ctx.lineWidth = Math.max(2, size / 4);
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.75);
    ctx.lineTo(x + size * 1.3, y + size * 0.25);
    ctx.stroke();
  } else if (s.kind === 'point') {
    ctx.beginPath();
    ctx.arc(x + size * 0.65, y + size / 2, size * 0.4, 0, Math.PI * 2);
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill();
    }
    ctx.stroke();
  } else {
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fillRect(x, y, size * 1.3, size);
    }
    ctx.strokeRect(x, y, size * 1.3, size);
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, w: number, k: number, title: string) {
  let size = 22 * k;
  ctx.font = `600 ${size}px ${FONT}`;
  const maxW = w * 0.8;
  while (ctx.measureText(title).width > maxW && size > 10 * k) {
    size -= k;
    ctx.font = `600 ${size}px ${FONT}`;
  }
  const pad = 10 * k;
  const tw = Math.min(ctx.measureText(title).width, maxW);
  const bw = tw + pad * 2;
  const x = (w - bw) / 2;
  const y = 12 * k;
  box(ctx, x, y, bw, size + pad * 1.4, 6 * k);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(title, w / 2, y + (size + pad * 1.4) / 2, maxW);
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  h: number,
  k: number,
  entries: LegendEntry[],
  top: number,
) {
  const pad = 9 * k;
  const row = 20 * k;
  const sw = 14 * k;
  ctx.font = `${13 * k}px ${FONT}`;
  const maxRows = Math.max(1, Math.floor((h - top - 110 * k - pad * 2 - row) / row));
  const shown = entries.slice(0, maxRows);
  const hidden = entries.length - shown.length;
  const swatchW = (e: LegendEntry) => e.swatches.length * (sw * 1.3 + 4 * k);
  const labelX = Math.max(0, ...shown.map(swatchW)) + pad * 2;
  const textW = Math.max(
    ctx.measureText('Legend').width,
    ...shown.map((e) => ctx.measureText(e.label).width),
  );
  const boxW = labelX + textW + pad;
  const rows = shown.length + 1 + (hidden > 0 ? 1 : 0);
  const boxH = rows * row + pad;
  const x = 12 * k;
  box(ctx, x, top, boxW, boxH, 6 * k);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${13 * k}px ${FONT}`;
  ctx.fillText('Legend', x + pad, top + pad / 2 + row / 2);
  ctx.font = `${13 * k}px ${FONT}`;
  shown.forEach((e, i) => {
    const y = top + pad / 2 + row * (i + 1);
    e.swatches.forEach((s, j) =>
      drawSwatch(ctx, s, x + pad + j * (sw * 1.3 + 4 * k), y + (row - sw) / 2, sw),
    );
    ctx.fillStyle = INK;
    ctx.fillText(e.label, x + labelX, y + row / 2);
  });
  if (hidden > 0) {
    ctx.fillStyle = '#555';
    ctx.fillText(
      `+${hidden} more layers`,
      x + pad,
      top + pad / 2 + row * (shown.length + 1) + row / 2,
    );
  }
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  h: number,
  k: number,
  bar: NonNullable<OverlayOptions['scaleBar']>,
) {
  const pad = 9 * k;
  const len = bar.lengthCssPx * k;
  ctx.font = `${12 * k}px ${FONT}`;
  const labelW = ctx.measureText(bar.label).width;
  const bw = Math.max(len, labelW) + pad * 2;
  const bh = 44 * k;
  const x = 12 * k;
  const y = h - bh - 30 * k;
  box(ctx, x, y, bw, bh, 6 * k);
  const bx = x + pad;
  const by = y + bh - pad - 7 * k;
  const half = len / 2;
  ctx.fillStyle = INK;
  ctx.fillRect(bx, by, half, 7 * k);
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx + half, by, half, 7 * k);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, k);
  ctx.strokeRect(bx, by, len, 7 * k);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('0', bx, by - 5 * k);
  ctx.textAlign = 'right';
  ctx.fillText(bar.label, bx + len, by - 5 * k);
}

function drawNorthArrow(
  ctx: CanvasRenderingContext2D,
  w: number,
  k: number,
  headingRad: number,
  top: number,
) {
  const size = 58 * k;
  const x = w - size - 12 * k;
  box(ctx, x, top, size, size, 8 * k);
  ctx.save();
  ctx.translate(x + size / 2, top + size / 2 + 4 * k);
  ctx.rotate(-headingRad); // the arrow keeps pointing at north as the view rotates
  const r = size * 0.32;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.55, r * 0.7);
  ctx.lineTo(0, r * 0.3);
  ctx.lineTo(-r * 0.55, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = INK;
  ctx.font = `700 ${13 * k}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', x + size / 2, top + 4 * k);
}

function drawAttribution(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  k: number,
  text: string,
) {
  ctx.font = `${11 * k}px ${FONT}`;
  const pad = 6 * k;
  const lines = wrapLines(ctx, text, w * 0.55);
  const lh = 14 * k;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const bh = lines.length * lh + pad * 1.4;
  const x = w - bw - 8 * k;
  const y = h - bh - 8 * k;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad * 0.7 + i * lh));
}

export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  k: number,
  o: OverlayOptions,
) {
  ctx.save();
  let leftTop = 12 * k;
  if (o.title.trim()) {
    drawTitle(ctx, w, k, o.title.trim());
    leftTop = 12 * k + 22 * k + 14 * k + 12 * k;
  }
  if (o.legend.length > 0) drawLegend(ctx, h, k, o.legend, leftTop);
  if (o.headingRad !== null) drawNorthArrow(ctx, w, k, o.headingRad, 12 * k);
  if (o.scaleBar) drawScaleBar(ctx, h, k, o.scaleBar);
  drawAttribution(ctx, w, h, k, o.attribution);
  ctx.restore();
}
