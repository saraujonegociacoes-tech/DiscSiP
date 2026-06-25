import { Section } from "../components/Section";
import { RoleMatrix } from "../components/RoleMatrix";
import { Glossary } from "../components/Glossary";

export function CommonBlocks() {
  return (
    <>
      <Section
        id="o-que-e"
        eyebrow="O que é"
        title="Blue Line em uma frase"
        description="Power dialer semi-automático que pega o próximo contato da fila e disca pelo softphone utilizado — você só atende e fala."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {[
            { k: "Fila", v: "Próximo contato carrega sozinho." },
            { k: "Softphone utilizado", v: "O Blue Line aciona o que você já usa." },
            { k: "Intelbras", v: "Discagem real via PABX WidevoiceX." },
            { k: "Helper local", v: "Ponte segura HTTPS → SIP no seu PC." },
          ].map((c) => (
            <div key={c.k} className="aj-card">
              <h3 style={{ margin: "0 0 6px" }}>{c.k}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{c.v}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="papeis"
        eyebrow="RBAC"
        title="Seu papel e o que você vê"
        description="Cada papel soma blocos. Manager herda do supervisor; admin herda do manager e ainda gerencia contas."
      >
        <RoleMatrix />
      </Section>

      <Section
        id="navegacao"
        eyebrow="Navegação"
        title="A sidebar muda conforme o papel"
        description="A barra lateral só mostra o que o seu papel pode acessar — nada de menus mortos."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {[
            { k: "Agente", v: "Dialer" },
            { k: "Supervisor", v: "Dialer · Dashboard · Campanhas" },
            { k: "Manager",    v: "Dialer · Dashboard · Campanhas (todos)" },
            { k: "Admin",      v: "Tudo + Admin (usuários, departamentos)" },
          ].map((c) => (
            <div key={c.k} className="aj-card">
              <span className="aj-chip" style={{ marginBottom: 10 }}>{c.k}</span>
              <p style={{ margin: 0 }}>{c.v}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="glossario"
        eyebrow="Glossário"
        title="Os termos que você vai ouvir"
      >
        <Glossary />
      </Section>
    </>
  );
}
