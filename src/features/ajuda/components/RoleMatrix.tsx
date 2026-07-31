import { ROLE_ACCESS } from "../content/roles";

export function RoleMatrix() {
  return (
    <div className="aj-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
          <thead>
            <tr style={{ background: "rgba(91,168,255,0.06)" }}>
              {["Área", "Pending", "Agente", "Supervisor", "Manager", "Admin", "CEO"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "14px 18px",
                    color: "var(--aj-accent)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    fontSize: "0.72rem",
                    letterSpacing: "0.08em",
                    borderBottom: "1px solid var(--aj-border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_ACCESS.map((row) => (
              <tr key={row.area} style={{ borderBottom: "1px solid rgba(91,168,255,0.08)" }}>
                <td style={{ padding: "14px 18px", fontWeight: 600 }}>{row.area}</td>
                <td style={{ padding: "14px 18px", color: "var(--aj-muted)" }}>{row.pending}</td>
                <td style={{ padding: "14px 18px" }}>{row.agent}</td>
                <td style={{ padding: "14px 18px" }}>{row.supervisor}</td>
                <td style={{ padding: "14px 18px" }}>{row.manager}</td>
                <td style={{ padding: "14px 18px" }}>{row.admin}</td>
                <td style={{ padding: "14px 18px" }}>{row.ceo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
