import { ROLES, type Role } from "../content/roles";

export function RoleBadge({ role }: { role: Role }) {
  const meta = ROLES.find((r) => r.id === role)!;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 18px",
        borderRadius: 999,
        background: "var(--aj-surface)",
        border: "1px solid var(--aj-border)",
        backdropFilter: "blur(8px)",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: meta.color,
          boxShadow: `0 0 18px ${meta.color}`,
        }}
      />
      <span style={{ fontSize: "0.85rem", color: "var(--aj-muted)" }}>Você está logado como</span>
      <strong style={{ color: "var(--aj-fg)", fontWeight: 700 }}>{meta.label}</strong>
      <span style={{ color: "var(--aj-muted)", fontSize: "0.85rem" }}>· {meta.tagline}</span>
    </div>
  );
}
