// The Limulus mark. The asset (app/public/limulus-mark.png) is a monochrome
// silhouette on transparency; we paint it with `currentColor` via a CSS mask so
// it renders crisply in any theme colour (near-white on the dark sidebar) and
// stays faithful to the real shape in both shells. Colour follows the parent's
// text colour — wrap in a `text-*` utility to tint it.
export function LimulusMark({ size = 28, className }: { size?: number; className?: string }) {
  const mask = {
    WebkitMaskImage: "url(/limulus-mark.png)",
    maskImage: "url(/limulus-mark.png)",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  } as const;
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ display: "inline-block", width: size, height: size, flexShrink: 0, backgroundColor: "currentColor", ...mask }}
    />
  );
}
