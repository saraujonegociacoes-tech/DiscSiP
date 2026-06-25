import type { ReactNode } from "react";
import { useReveal } from "../hooks/useReveal";

export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  align = "left",
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  children?: ReactNode;
  align?: "left" | "center";
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section
      id={id}
      ref={ref}
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "96px 24px",
        textAlign: align,
        position: "relative",
        zIndex: 1,
      }}
    >
      {eyebrow && <span className="aj-chip" style={{ marginBottom: 16 }}>{eyebrow}</span>}
      {title && <h2 style={{ marginTop: 12, marginBottom: 12 }}>{title}</h2>}
      {description && (
        <p style={{ maxWidth: 720, margin: align === "center" ? "0 auto 32px" : "0 0 32px", fontSize: "1.05rem" }}>
          {description}
        </p>
      )}
      {children}
    </section>
  );
}
