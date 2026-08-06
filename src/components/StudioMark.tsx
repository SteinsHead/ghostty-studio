import type { SVGProps } from "react";

interface StudioMarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

export function StudioMark({ size = 24, ...props }: StudioMarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M36 30V33H30V38H24V33H18C13.6 33 10 29.4 10 25V21C10 13.3 16.3 7 24 7S38 13.3 38 21V22"
        stroke="currentColor"
        strokeWidth="4.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="17.75" y="17.75" width="5.5" height="5.5" rx="1.6" fill="currentColor" />
    </svg>
  );
}
