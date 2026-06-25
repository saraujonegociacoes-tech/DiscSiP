import { Section } from "../components/Section";

export function ManagerNote() {
  return (
    <Section
      id="manager"
      eyebrow="Manager"
      title="Mesmos poderes do supervisor — escopo do negócio inteiro"
      description="Você enxerga todos os departamentos no Dashboard e nas Campanhas. Não gerencia contas (isso é admin)."
    >
      <div className="aj-card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 14, display: "grid", placeItems: "center",
            background: "linear-gradient(180deg, rgba(167,139,250,0.25), rgba(167,139,250,0.05))",
            border: "1px solid rgba(167,139,250,0.5)", fontSize: "1.4rem",
          }}
        >🌐</div>
        <p style={{ margin: 0 }}>
          Filtros de departamento ficam disponíveis em todas as telas — você decide se olha o todo ou
          afunila para uma equipe específica.
        </p>
      </div>
    </Section>
  );
}
