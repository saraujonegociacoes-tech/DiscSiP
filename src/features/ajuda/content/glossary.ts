export const GLOSSARY = [
  { term: "Campanha",   def: "Conjunto de regras (horário, agentes, campos visíveis) que discam para uma lista." },
  { term: "Lista / Mailing", def: "Planilha (.csv/.xlsx) com os contatos a discar." },
  { term: "Contato",    def: "Uma linha do mailing — nome, telefone e campos extras." },
  { term: "Tabulação / Disposição", def: "O resultado da ligação que o agente registra ao encerrar." },
  { term: "Ramal",      def: "Identificador SIP do agente no PABX Intelbras (5125–5150)." },
  { term: "Helper",     def: "Programa local (porta 3001) que recebe o número do navegador e aciona o softphone utilizado." },
  { term: "Reciclagem", def: "Regra que reagenda contatos com certos status (ex.: não atendeu) para uma nova tentativa." },
];

export const FAQ = [
  { q: "Por que o softphone utilizado disca sozinho?", a: "O Blue Line envia o número para o helper local, que aciona o softphone utilizado. Você só atende." },
  { q: "O que é discagem paralela?",         a: "O sistema disca para vários números ao mesmo tempo (alvo N=3) para acelerar a fila." },
  { q: "Sumiu o banner verde do helper.",    a: "O helper local parou. Abra o start.bat e o banner volta a online." },
  { q: "Não consigo iniciar — fora do horário.", a: "A campanha tem janela definida pelo supervisor. Aguarde ou peça ajuste." },
];
