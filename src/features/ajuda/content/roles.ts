// Fonte única do tipo Role: o RBAC do Blue Desk. Não duplicar aqui.
import type { Role } from "@/lib/types/database";
export type { Role };

export const ROLES: { id: Role; label: string; tagline: string; color: string }[] = [
  { id: "pending",    label: "Pending",    tagline: "Aguardando aprovação",            color: "#FBBF24" },
  { id: "agent",      label: "Agente",     tagline: "Faz as ligações",                 color: "#5BA8FF" },
  { id: "supervisor", label: "Supervisor", tagline: "Gerencia 1 departamento",         color: "#34D399" },
  { id: "manager",    label: "Manager",    tagline: "Enxerga o negócio inteiro",       color: "#A78BFA" },
  { id: "admin",      label: "Admin",      tagline: "Gere usuários e departamentos",   color: "#F472B6" },
];

export const ROLE_ACCESS: { area: string; pending: string; agent: string; supervisor: string; manager: string; admin: string }[] = [
  { area: "Dialer",      pending: "—", agent: "✓",             supervisor: "✓",                    manager: "✓",                          admin: "✓" },
  { area: "Dashboard",   pending: "—", agent: "—",             supervisor: "✓ (1 depto)",          manager: "✓ (todos os deptos)",        admin: "✓ (todos)" },
  { area: "Campanhas",   pending: "—", agent: "Ver e iniciar", supervisor: "Criar / editar (1 depto)", manager: "Criar / editar (todos)", admin: "Criar / editar (todos)" },
  { area: "Mailings",    pending: "—", agent: "—",             supervisor: "Subir e mapear",       manager: "Subir e mapear",             admin: "Subir e mapear" },
  { area: "Admin",       pending: "—", agent: "—",             supervisor: "—",                    manager: "—",                          admin: "Aprovar usuários, departamentos" },
];

export function roleIncludes(current: Role, target: Role): boolean {
  const order: Role[] = ["pending", "agent", "supervisor", "manager", "admin"];
  return order.indexOf(current) >= order.indexOf(target);
}
