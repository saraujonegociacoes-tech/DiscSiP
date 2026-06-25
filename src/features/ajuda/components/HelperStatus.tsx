import { useEffect, useState } from "react";

export function HelperStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOnline((v) => !v), 3200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="aj-card" style={{ display: "flex", gap: 20, alignItems: "center" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          display: "grid",
          placeItems: "center",
          background: online
            ? "linear-gradient(180deg, rgba(52,211,153,0.25), rgba(52,211,153,0.05))"
            : "linear-gradient(180deg, rgba(248,113,113,0.25), rgba(248,113,113,0.05))",
          border: `1px solid ${online ? "rgba(52,211,153,0.5)" : "rgba(248,113,113,0.5)"}`,
          transition: "all 400ms ease",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            background: online ? "#34D399" : "#F87171",
            boxShadow: `0 0 22px ${online ? "#34D399" : "#F87171"}`,
            transition: "all 400ms ease",
          }}
        />
      </div>
      <div>
        <h3 style={{ margin: "0 0 4px" }}>Helper local — {online ? "online" : "offline"}</h3>
        <p style={{ margin: 0, fontSize: "0.92rem" }}>
          Programa Node.js (porta 3001) que recebe o número do navegador e aciona o softphone utilizado.
          Quando cai, abra <code style={{ color: "var(--aj-accent)" }}>start.bat</code> na sua máquina.
        </p>
      </div>
    </div>
  );
}
