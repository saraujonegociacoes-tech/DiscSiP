import { Section } from "../components/Section";
import { StepCard } from "../components/StepCard";
import { SUPERVISOR_TASKS } from "../content/steps";

export function SupervisorBlock() {
  return (
    <Section
      id="supervisor"
      eyebrow="Supervisor"
      title="O que você controla no seu departamento"
      description="Escopo limitado ao seu departamento pelo RLS. Tudo do agente continua valendo + estes blocos."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }} className="aj-stagger">
        {SUPERVISOR_TASKS.map((t, i) => (
          <StepCard key={t.title} n={i + 1} title={t.title} desc={t.desc} index={i} />
        ))}
      </div>
    </Section>
  );
}
