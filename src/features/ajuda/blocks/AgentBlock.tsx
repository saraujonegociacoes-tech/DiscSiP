import { Section } from "../components/Section";
import { StepCard } from "../components/StepCard";
import { Timeline } from "../components/Timeline";
import { HelperStatus } from "../components/HelperStatus";
import { PREDIAL_CHECKLIST, CALL_FLOW, TROUBLESHOOT } from "../content/steps";

export function AgentBlock() {
  return (
    <>
      <Section
        id="antes-de-discar"
        eyebrow="Agente · 1"
        title="Antes de discar — checklist"
        description="Cinco coisas precisam estar verdes. Se uma falhar, o sistema avisa."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }} className="aj-stagger">
          {PREDIAL_CHECKLIST.map((c, i) => (
            <StepCard key={c.title} n={i + 1} title={c.title} desc={c.desc} index={i} />
          ))}
        </div>
      </Section>

      <Section
        id="helper"
        eyebrow="Helper local"
        title="A ponte entre o navegador e o softphone utilizado"
        description="Sem o helper rodando, o Blue Line não consegue acionar o softphone utilizado. O banner no topo do Dialer mostra o estado."
      >
        <HelperStatus />
      </Section>

      <Section
        id="fluxo"
        eyebrow="Agente · 2"
        title="O fluxo da ligação, passo a passo"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }} className="aj-stagger">
          {CALL_FLOW.map((c, i) => (
            <StepCard key={c.n} n={c.n} title={c.title} desc={c.desc} index={i} />
          ))}
        </div>
      </Section>

      <Section
        id="controles"
        eyebrow="Durante a ligação"
        title="O que aparece na sua tela"
        description="Os campos do contato (conforme o supervisor liberou) e os controles essenciais."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {[
            { k: "Mutar microfone", v: "Pausa o áudio que você envia." },
            { k: "Mutar alto-falante", v: "Silencia o áudio do lead." },
            { k: "Encerrar", v: "Desliga e abre a tabulação." },
            { k: "Tabular", v: "Escolha a disposição → próximo contato entra automaticamente." },
          ].map((c) => (
            <div key={c.k} className="aj-card">
              <h3 style={{ margin: "0 0 6px" }}>{c.k}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{c.v}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="paralela"
        eyebrow="Como funciona por baixo"
        title="Discagem paralela / preditiva"
        description="O sistema pode discar para vários números ao mesmo tempo (alvo N=3). Você só vê o que atender — os outros são descartados."
      >
        <div className="aj-card">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                style={{
                  flex: "1 1 200px",
                  padding: 16,
                  borderRadius: 14,
                  border: "1px dashed rgba(91,168,255,0.35)",
                  textAlign: "center",
                  background: "rgba(91,168,255,0.05)",
                }}
              >
                <div style={{ fontSize: "0.72rem", color: "var(--aj-muted)", letterSpacing: "0.08em" }}>
                  CANAL {n}
                </div>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, marginTop: 4 }}>(•••) ••••-••{n}{n}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--aj-accent)", marginTop: 6 }}>
                  {n === 1 ? "Atendeu → você assume" : "Em espera"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="ciclo"
        eyebrow="Reciclagem"
        title="Ciclo de vida do contato"
        description="Por que um contato volta a aparecer? Porque ele entrou em reciclagem."
      >
        <Timeline />
      </Section>

      <Section
        id="troubleshoot"
        eyebrow="O que fazer quando…"
        title="Troubleshooting do agente"
      >
        <div style={{ display: "grid", gap: 12 }}>
          {TROUBLESHOOT.map((t, i) => (
            <div key={t.tag} className="aj-card" style={{ display: "flex", gap: 16, alignItems: "flex-start", ["--aj-i" as never]: i } as React.CSSProperties}>
              <span className="aj-chip" style={{ flexShrink: 0 }}>{t.tag}</span>
              <p style={{ margin: 0 }}>{t.fix}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
