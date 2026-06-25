import { Section } from "../components/Section";
import { StepCard } from "../components/StepCard";
import { ADMIN_TASKS } from "../content/steps";

export function AdminBlock() {
  return (
    <Section
      id="admin"
      eyebrow="Admin"
      title="Gestão de contas e estrutura"
      description="Tudo do manager + aprovar usuários e organizar departamentos."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }} className="aj-stagger">
        {ADMIN_TASKS.map((t, i) => (
          <StepCard key={t.title} n={i + 1} title={t.title} desc={t.desc} index={i} />
        ))}
      </div>
    </Section>
  );
}
