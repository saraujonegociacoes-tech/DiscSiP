import type { CSSProperties, ReactNode } from "react";
import { useParallax } from "../hooks/useParallax";

export function ParallaxLayer({
  speed = 0.2,
  className,
  style,
  children,
}: {
  speed?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useParallax<HTMLDivElement>(speed);
  return (
    <div ref={ref} className={`aj-parallax ${className ?? ""}`} style={style}>
      {children}
    </div>
  );
}

export function ParallaxBackdrop() {
  return (
    <>
      <ParallaxLayer speed={0.08}>
        <div className="aj-grid-bg" />
      </ParallaxLayer>
      <ParallaxLayer speed={0.18} style={{ inset: "auto" }}>
        <div
          className="aj-blob"
          style={{ top: "8%", left: "-6%", width: 380, height: 380, background: "#1E6FE0" }}
        />
      </ParallaxLayer>
      <ParallaxLayer speed={0.28} style={{ inset: "auto" }}>
        <div
          className="aj-blob"
          style={{ top: "40%", right: "-8%", width: 460, height: 460, background: "#5BA8FF" }}
        />
      </ParallaxLayer>
      <ParallaxLayer speed={0.14} style={{ inset: "auto" }}>
        <div
          className="aj-blob"
          style={{ top: "78%", left: "20%", width: 320, height: 320, background: "#0F2A44", opacity: 0.9 }}
        />
      </ParallaxLayer>
    </>
  );
}
