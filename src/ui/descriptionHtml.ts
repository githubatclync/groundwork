// Sanitizes KML <description> HTML for display. It is cleaned with DOMPurify, images are limited
// to data: URLs, https, or files shipped with the layer (served via kmz://), links are made inert,
// and the result is rendered inside a script-less sandboxed iframe with a restrictive CSP.
import DOMPurify from 'dompurify';
import { layerResourceUrl } from '../io/scheme';

/** Decides what an <img src> in a description may load; null means "drop the image". */
export function resolveImageSrc(src: string, layerId: string, windows?: boolean): string | null {
  const s = src.trim();
  if (!s) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(s)) return s;
  if (/^https:\/\//i.test(s)) return s;
  // Any other scheme (http:, file:, javascript:, C:\ drive paths) or protocol-relative URL is refused.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return null;
  const path = s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!path || path.split('/').includes('..')) return null;
  return layerResourceUrl(layerId, path, windows);
}

let currentLayerId = '';
let hooked = false;

function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (el.nodeName === 'IMG') {
      const resolved = resolveImageSrc(el.getAttribute('src') ?? '', currentLayerId);
      if (resolved) el.setAttribute('src', resolved);
      else el.remove();
      el.removeAttribute('srcset');
    } else if (el.nodeName === 'A') {
      // Links cannot navigate anywhere from a description.
      el.removeAttribute('href');
      el.removeAttribute('target');
    }
  });
}

export function sanitizeDescription(html: string, layerId: string): string {
  ensureHook();
  currentLayerId = layerId;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'style',
      'link',
      'meta',
      'base',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'audio',
      'video',
      'source',
    ],
    FORBID_ATTR: ['style', 'srcset', 'ping'],
    ALLOW_DATA_ATTR: false,
  });
}

const CSP =
  "default-src 'none'; img-src data: https: http://kmz.localhost kmz:; style-src 'unsafe-inline'";

/** Wraps sanitized HTML as a complete document for `<iframe sandbox="" srcdoc>`. */
export function descriptionDocument(sanitizedHtml: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    '<style>:root{color-scheme:light dark}body{font:13px system-ui,sans-serif;margin:8px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #8884;padding:2px 6px}</style>' +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}
