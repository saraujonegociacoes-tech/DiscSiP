"use client";

import Link from "next/link";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import "./styles.css";
import { ROLES, roleIncludes, type Role } from "./content/roles";
import { useTheme } from "@/components/bluedesk/theme";
import { ParallaxBackdrop } from "./components/ParallaxLayer";
import { RoleBadge } from "./components/RoleBadge";
import { Section } from "./components/Section";
import { FAQ } from "./components/FAQ";
import { CommonBlocks } from "./blocks/CommonBlocks";
import { PendingBlock } from "./blocks/PendingBlock";
import { AgentBlock } from "./blocks/AgentBlock";
import { SupervisorBlock } from "./blocks/SupervisorBlock";
import { ManagerNote } from "./blocks/ManagerNote";
import { AdminBlock } from "./blocks/AdminBlock";

export interface AjudaPageProps {
  /** Papel do usuário logado. Vem do RBAC do Blue Desk. */
  role: Role;
  /** Opcional — habilita um seletor flutuante para preview/dev. */
  onRoleChange?: (r: Role) => void;
}

export function AjudaPage({ role, onRoleChange }: AjudaPageProps) {
  // Pendente volta para a tela de espera; os demais voltam para o discador.
  const backHref = role === "pending" ? "/aguardando" : "/softphone";
  const { theme, toggle } = useTheme();

  return (
    <div className="ajuda-root">
      <ParallaxBackdrop />

      <header
        style={{
          position: "relative",
          zIndex: 3,
          maxWidth: 1080,
          margin: "0 auto",
          padding: "24px 24px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Link href={backHref} className="aj-btn" data-variant="ghost" style={{ textDecoration: "none" }}>
          <ArrowLeft size={16} aria-hidden /> Voltar
        </Link>

        {onRoleChange && (
          <nav className="aj-rolenav" aria-label="Trocar papel (preview)">
            {ROLES.map((r) => (
              <button
                key={r.id}
                data-active={role === r.id}
                onClick={() => onRoleChange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </nav>
        )}

        <button
          type="button"
          onClick={toggle}
          className="aj-btn"
          data-variant="ghost"
          aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
        >
          {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
        </button>
      </header>

      <section
        style={{
          position: "relative",
          zIndex: 2,
          maxWidth: 1080,
          margin: "0 auto",
          padding: "56px 24px 24px",
          textAlign: "center",
        }}
      >
        <span className="aj-chip" style={{ marginBottom: 18 }}>Como usar?</span>
        <h1 style={{ margin: "0 auto", maxWidth: 820 }}>
          O guia do <span style={{ background: "linear-gradient(90deg, #5BA8FF, #1E6FE0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Blue Desk</span>, do seu jeito.
        </h1>
        <p style={{ margin: "20px auto 28px", maxWidth: 620, fontSize: "1.08rem" }}>
          Esta página se adapta ao seu papel. Você vê apenas o que precisa para trabalhar — nem mais, nem menos.
        </p>
        <RoleBadge role={role} />
      </section>

      <main key={role} className="aj-role-content" style={{ position: "relative", zIndex: 1 }}>
        {role === "pending" && <PendingBlock />}

        {roleIncludes(role, "agent") && role !== "pending" && (
          <>
            <CommonBlocks />
            <AgentBlock />
          </>
        )}

        {roleIncludes(role, "supervisor") && <SupervisorBlock />}
        {roleIncludes(role, "manager")    && <ManagerNote />}
        {roleIncludes(role, "admin")      && <AdminBlock />}

        {role !== "pending" && (
          <Section id="faq" eyebrow="FAQ" title="Perguntas rápidas">
            <FAQ />
          </Section>
        )}

        <Section id="suporte" align="center" eyebrow="Suporte" title="Travou? Chame o time.">
          <div className="aj-card" style={{ maxWidth: 560, margin: "0 auto" }}>
            <p style={{ margin: 0 }}>
              Fale com o seu <strong style={{ color: "var(--aj-fg)" }}>supervisor</strong> ou
              com o <strong style={{ color: "var(--aj-fg)" }}>admin</strong>. Para problemas técnicos
              recorrentes, registre no canal de TI da Araujo Negociações.
            </p>
          </div>
        </Section>

        <footer style={{ textAlign: "center", padding: "40px 24px 72px", color: "var(--aj-muted)", fontSize: "0.85rem" }}>
          Blue Desk · Power Dialer
        </footer>
      </main>
    </div>
  );
}

export default AjudaPage;
