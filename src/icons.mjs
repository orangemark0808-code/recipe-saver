// アプリ共通のフラットなアイコン（線のアイコン）。色は呼び出し側のCSS（currentColor）で決める。
const SVG_NS = 'http://www.w3.org/2000/svg';
const PATHS = Object.freeze({
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4h6v3'],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2'],
  scan: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 8h10', 'M7 12h10', 'M7 16h6'],
  imageAdd: ['M16 5h6', 'M19 2v6', 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5', 'M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21', 'M9 7a2 2 0 1 0 0.01 0z'],
  gear: ['M10.34 4.79 L10.50 2.52 L13.50 2.52 L13.66 4.79 A7.4 7.4 0 0 1 15.92 5.72 L17.64 4.23 L19.77 6.36 L18.28 8.08 A7.4 7.4 0 0 1 19.21 10.34 L21.48 10.50 L21.48 13.50 L19.21 13.66 A7.4 7.4 0 0 1 18.28 15.92 L19.77 17.64 L17.64 19.77 L15.92 18.28 A7.4 7.4 0 0 1 13.66 19.21 L13.50 21.48 L10.50 21.48 L10.34 19.21 A7.4 7.4 0 0 1 8.08 18.28 L6.36 19.77 L4.23 17.64 L5.72 15.92 A7.4 7.4 0 0 1 4.79 13.66 L2.52 13.50 L2.52 10.50 L4.79 10.34 A7.4 7.4 0 0 1 5.72 8.08 L4.23 6.36 L6.36 4.23 L8.08 5.72 A7.4 7.4 0 0 1 10.34 4.79 Z', 'M12 9a3 3 0 1 0 0.01 0z']
});

export function makeIcon(document, name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
