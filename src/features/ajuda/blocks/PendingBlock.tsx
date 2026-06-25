import { Section } from "../components/Section";

export function PendingBlock() {
  return (
    <Section align="center" eyebrow="Status" title="Sua conta está aguardando aprovação">
      <div className="aj-card" style={{ maxWidth: 520, margin: "0 auto", padding: 28 }}>
        <p style={{ margin: 0 }}>
          Um <strong style={{ color: "var(--aj-fg)" }}>admin</strong> precisa atribuir
          seu papel, departamento e (opcional) ramal. Enquanto isso, você não tem acesso
          ao Dialer nem às campanhas.
        </p>
      </div>
    </Section>
  );
}
