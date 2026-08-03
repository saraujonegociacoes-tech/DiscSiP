// Fonte única do tipo Role: o RBAC do Blue Desk. Não duplicar aqui.
import type { Role } from "@/lib/types/database";
export type { Role };

export const ROLES: { id: Role; label: string; tagline: string; color: string }[] = [
  { id: "pending",    label: "Pending",    tagline: "Aguardando aprovação",            color: "#FBBF24" },
  { id: "agent",      label: "Agente",     tagline: "Faz as ligações",                 color: "#5BA8FF" },
  { id: "supervisor", label: "Supervisor", tagline: "Gerencia 1 departamento",         color: "#34D399" },
  { id: "manager",    label: "Manager",    tagline: "Enxerga o negócio inteiro",       color: "#A78BFA" },
  { id: "admin",      label: "Admin",      tagline: "Gere usuários e departamentos",   color: "#F472B6" },
  // Precisa existir aqui: RoleBadge faz ROLES.find(...)! e estouraria (TypeError em
  // meta.color) para um papel ausente — e /ajuda é liberado a todos, inclusive pending.
  { id: "ceo",        label: "CEO",        tagline: "Só o painel executivo",           color: "#F97316" },
  { id: "tester",     label: "Tester",    tagline: "Vê tudo + seletor de visão",       color: "#22D3EE" },
];

export const ROLE_ACCESS: { area: string; pending: string; agent: string; supervisor: string; manager: string; admin: string; ceo: string }[] = [
  { area: "Dialer",       pending: "—", agent: "✓",             supervisor: "✓",                    manager: "✓",                          admin: "✓",                                ceo: "—" },
  { area: "Dashboard",    pending: "—", agent: "—",             supervisor: "✓ (1 depto)",          manager: "✓ (todos os deptos)",        admin: "✓ (todos)",                        ceo: "—" },
  { area: "Campanhas",    pending: "—", agent: "Ver e iniciar", supervisor: "Criar / editar (1 depto)", manager: "Criar / editar (todos)", admin: "Criar / editar (todos)",           ceo: "—" },
  { area: "Mailings",     pending: "—", agent: "—",             supervisor: "Subir e mapear",       manager: "Subir e mapear",             admin: "Subir e mapear",                   ceo: "—" },
  { area: "Admin",        pending: "—", agent: "—",             supervisor: "—",                    manager: "—",                          admin: "Aprovar usuários, departamentos",  ceo: "—" },
  { area: "Painel do CEO", pending: "—", agent: "—",            supervisor: "—",                    manager: "—",                          admin: "✓ (suporte)",                      ceo: "✓" },
];

// Escada de papéis da OPERAÇÃO. `ceo` fica FORA dela de propósito: é uma trava lateral,
// não um nível — não herda de agent/supervisor/manager/admin e ninguém herda dele. Um
// papel fora da escada devolve false. O indexOf −1 já produziria isso por acidente, mas
// deixar implícito é frágil: reordenar o array mudaria o significado sem aviso.
export function roleIncludes(current: Role, target: Role): boolean {
  // 'tester' vê tudo → equivale a admin na escada da ajuda. 'ceo' segue fora (trava lateral).
  const c: Role = current === "tester" ? "admin" : current;
  const order: Role[] = ["pending", "agent", "supervisor", "manager", "admin"];
  const currentIndex = order.indexOf(c);
  const targetIndex = order.indexOf(target);
  if (currentIndex < 0 || targetIndex < 0) return false;
  return currentIndex >= targetIndex;
}
