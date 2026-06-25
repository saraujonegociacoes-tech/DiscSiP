import { useReveal } from "../hooks/useReveal";

const STATES = [
  { id: "pending",   label: "Pendente",       color: "#5BA8FF" },
  { id: "dialing",   label: "Discando",       color: "#A78BFA" },
  { id: "answered",  label: "Atendeu",        color: "#34D399" },
  { id: "no_answer", label: "Não atendeu",    color: "#FBBF24" },
  { id: "busy",      label: "Ocupado",        color: "#FB923C" },
  { id: "failed",    label: "Falhou",         color: "#F87171" },
  { id: "recycle",   label: "Reciclagem",     color: "#5BA8FF" },
  { id: "exhausted", label: "Esgotado",       color: "#64748B" },
];

export function Timeline() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="aj-card" style={{ padding: 28 }}>
      <svg viewBox="0 0 800 220" width="100%" height="auto" style={{ display: "block" }}>
        <defs>
          <linearGradient id="aj-line" x1="0" x2="1">
            <stop offset="0%" stopColor="#1E6FE0" />
            <stop offset="100%" stopColor="#5BA8FF" />
          </linearGradient>
        </defs>
        <path
          className="aj-timeline-line"
          d="M40 110 C 180 40, 320 180, 460 110 S 740 40, 780 110"
          stroke="url(#aj-line)"
          strokeWidth="2.5"
          fill="none"
        />
        {STATES.map((s, i) => {
          const x = 40 + (i * (740 / (STATES.length - 1)));
          const y = 110 + (i % 2 === 0 ? -42 : 42);
          return (
            <g key={s.id}>
              <circle cx={x} cy={y} r="7" fill={s.color} opacity="0.95" />
              <circle cx={x} cy={y} r="14" fill={s.color} opacity="0.15" />
              <text
                x={x}
                y={y + (i % 2 === 0 ? -22 : 30)}
                textAnchor="middle"
                style={{ fill: "var(--aj-fg)" }}
                fontSize="11"
                fontWeight="600"
              >
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p style={{ marginTop: 16, fontSize: "0.9rem" }}>
        Um contato percorre estados. Quando não atende, ocupa ou falha, entra em
        <strong style={{ color: "var(--aj-accent)" }}> reciclagem </strong>
        até atingir o limite de tentativas — aí vira <em>esgotado</em>.
      </p>
    </div>
  );
}
