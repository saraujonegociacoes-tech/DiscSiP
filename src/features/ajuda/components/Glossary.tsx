import { useState } from "react";
import { GLOSSARY } from "../content/glossary";

export function Glossary() {
  const [open, setOpen] = useState<string | null>(GLOSSARY[0]?.term ?? null);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {GLOSSARY.map((g) => {
        const isOpen = open === g.term;
        return (
          <button
            key={g.term}
            onClick={() => setOpen(isOpen ? null : g.term)}
            className="aj-card"
            style={{
              textAlign: "left",
              cursor: "pointer",
              padding: 18,
              border: isOpen ? "1px solid rgba(91,168,255,0.55)" : "1px solid var(--aj-border)",
              background: isOpen
                ? "linear-gradient(180deg, rgba(30,111,224,0.18), rgba(30,111,224,0.03))"
                : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ color: "var(--aj-fg)" }}>{g.term}</strong>
              <span style={{ color: "var(--aj-accent)", transform: isOpen ? "rotate(45deg)" : "none", transition: "transform 200ms ease" }}>+</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateRows: isOpen ? "1fr" : "0fr",
                transition: "grid-template-rows 320ms ease",
              }}
            >
              <div style={{ overflow: "hidden" }}>
                <p style={{ margin: "10px 0 0", fontSize: "0.94rem" }}>{g.def}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
