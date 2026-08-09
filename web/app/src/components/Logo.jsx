import React from "react";

// FaultLine mark — a fault trace across five agents, with the proximate-cause
// spike picked out in red. Inline SVG so it inherits the currentColor-free
// brand palette and scales crisply at any size.
export default function Logo({ size = 28 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="FaultLine logo"
      style={{ display: "block" }}
    >
      <rect width="32" height="32" rx="7" fill="#101010" />
      <rect x="1" y="1" width="30" height="30" rx="6.5" fill="none" stroke="#b97a14" strokeOpacity="0.5" />
      <path
        d="M4 22 L9.5 22 L12 13 L15 25 L18.5 16 L21.5 22 L28 22"
        fill="none"
        stroke="#e08a00"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="1.7" fill="#e5484d" />
      <circle cx="15" cy="25" r="1.7" fill="#4cc3d9" />
    </svg>
  );
}
