import React from "react";

// Rocky: a faceted rock on five legs, after the Eridian engineer of the same
// name. Original, flat artwork; the app icon (icon.svg) is this component
// rendered at 128 px, and tests/ui/logo.test.tsx keeps them in sync.

const LEGS = [
  "44,54 24,42 18,92",
  "52,60 38,74 34,98",
  "66,62 72,80 66,100",
  "78,60 94,74 96,98",
  "86,52 106,40 110,90",
];
// Three flat facets, lit from the upper left.
const FACETS = [
  { points: "38,50 50,30 78,26 66,44", fill: "#f7b86c" },
  { points: "78,26 92,46 80,62 66,44", fill: "#e58e3e" },
  { points: "80,62 48,62 38,50 66,44", fill: "#cf7a34" },
];

export interface RockyLogoProps {
  size?: number;
  // Without a title the logo is decorative and hidden from assistive technology.
  title?: string;
}

export function RockyLogo({ size = 32, title }: RockyLogoProps) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width={size} height={size} {...a11y}>
      {title ? <title>{title}</title> : null}
      <rect width="128" height="128" rx="28" fill="#1f2547" />
      {LEGS.map((points) => (
        <polyline key={points} points={points} fill="none" stroke="#b4652a" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {FACETS.map((facet) => (
        <polygon key={facet.points} points={facet.points} fill={facet.fill} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
