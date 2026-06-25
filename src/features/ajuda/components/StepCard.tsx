import { useCountUp } from "../hooks/useCountUp";

export function StepCard({
  n,
  title,
  desc,
  index = 0,
}: {
  n: number;
  title: string;
  desc: string;
  index?: number;
}) {
  const { ref, value } = useCountUp(n, 700);
  return (
    <article className="aj-card" style={{ ["--aj-i" as never]: index } as React.CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <span
          ref={ref}
          className="aj-counter"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--aj-primary)",
            border: "1px solid var(--aj-accent)",
            color: "#fff",
            fontWeight: 800,
            fontSize: "1.1rem",
          }}
        >
          {String(value).padStart(2, "0")}
        </span>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      <p style={{ margin: 0 }}>{desc}</p>
    </article>
  );
}
