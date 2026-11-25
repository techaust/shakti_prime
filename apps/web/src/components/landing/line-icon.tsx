import type { SVGProps } from 'react';

/**
 * The landing page's icons, drawn on the server as plain SVG so the public page sends no script:
 * `lucide-react` marks its icons as browser components, which would load its runtime on `/`.
 * The outlines are Lucide's (lucide.dev, ISC licence: Copyright (c) Lucide Icons and Contributors),
 * the same icons the app's menu uses, taken from lucide-react 1.76.0.
 */
type Node = readonly ['path' | 'circle' | 'rect' | 'polyline' | 'line', SVGProps<SVGElement>];

const ICONS = {
  phoneCall: [
    ['path', { d: 'M13 2a9 9 0 0 1 9 9' }],
    ['path', { d: 'M13 6a5 5 0 0 1 5 5' }],
    [
      'path',
      {
        d: 'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384',
      },
    ],
  ],
  fileText: [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
      },
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M10 9H8' }],
    ['path', { d: 'M16 13H8' }],
    ['path', { d: 'M16 17H8' }],
  ],
  inbox: [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    [
      'path',
      {
        d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      },
    ],
  ],
  contact: [
    ['path', { d: 'M16 2v2' }],
    ['path', { d: 'M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2' }],
    ['path', { d: 'M8 2v2' }],
    ['circle', { cx: '12', cy: '10', r: '3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ],
  boxes: [
    [
      'path',
      {
        d: 'M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z',
      },
    ],
    ['path', { d: 'm7 16.5-4.74-2.85' }],
    ['path', { d: 'm7 16.5 5-3' }],
    ['path', { d: 'M7 16.5v5.17' }],
    [
      'path',
      {
        d: 'M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z',
      },
    ],
    ['path', { d: 'm17 16.5-5-3' }],
    ['path', { d: 'm17 16.5 4.74-2.85' }],
    ['path', { d: 'M17 16.5v5.17' }],
    [
      'path',
      {
        d: 'M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z',
      },
    ],
    ['path', { d: 'M12 8 7.26 5.15' }],
    ['path', { d: 'm12 8 4.74-2.85' }],
    ['path', { d: 'M12 13.5V8' }],
  ],
  hardHat: [
    ['path', { d: 'M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5' }],
    ['path', { d: 'M14 6a6 6 0 0 1 6 6v3' }],
    ['path', { d: 'M4 15v-3a6 6 0 0 1 6-6' }],
    ['rect', { x: '2', y: '15', width: '20', height: '4', rx: '1' }],
  ],
  smartphone: [
    ['rect', { width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2' }],
    ['path', { d: 'M12 18h.01' }],
  ],
  indianRupee: [
    ['path', { d: 'm14 20-8-8h4c5.333 0 5.333-8 0-8' }],
    ['path', { d: 'M6 4h12' }],
    ['path', { d: 'M6 8h12' }],
  ],
  calendarCheck: [
    ['path', { d: 'M8 2v3' }],
    ['path', { d: 'M16 2v3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'm9 15 2 2 4-4' }],
  ],
  building: [
    ['path', { d: 'M10 12h4' }],
    ['path', { d: 'M10 8h4' }],
    ['path', { d: 'M14 21v-3a2 2 0 0 0-4 0v3' }],
    ['path', { d: 'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2' }],
    ['path', { d: 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  audioLines: [
    ['path', { d: 'M2 10v3' }],
    ['path', { d: 'M6 6v11' }],
    ['path', { d: 'M10 3v18' }],
    ['path', { d: 'M14 8v7' }],
    ['path', { d: 'M18 5v13' }],
    ['path', { d: 'M22 10v3' }],
  ],
} as const satisfies Record<string, readonly Node[]>;

export type LineIconName = keyof typeof ICONS;

/** One icon, 24 x 24 at a 2-unit stroke in the current text colour, hidden from screen readers. */
export function LineIcon({ name, className }: { name: LineIconName; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {ICONS[name].map(([Tag, attributes], i) => (
        <Tag key={i} {...attributes} />
      ))}
    </svg>
  );
}
