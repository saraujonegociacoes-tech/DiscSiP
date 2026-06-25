import { FAQ as ITEMS } from "../content/glossary";

export function FAQ() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      {ITEMS.map((f, i) => (
        <div key={f.q} className="aj-card" style={{ ["--aj-i" as never]: i } as React.CSSProperties}>
          <h3 style={{ margin: "0 0 8px", fontSize: "1.02rem" }}>{f.q}</h3>
          <p style={{ margin: 0, fontSize: "0.92rem" }}>{f.a}</p>
        </div>
      ))}
    </div>
  );
}
