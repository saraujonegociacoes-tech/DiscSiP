export const PREDIAL_CHECKLIST = [
  { title: "Ramal atribuído", desc: "Confirme no seu perfil. Sem ramal, o sistema avisa e não disca." },
  { title: "Softphone utilizado", desc: "Abra o softphone utilizado e verifique se o ramal está “Online”." },
  { title: "Helper local rodando", desc: "Banner verde no topo do Dialer = online. Cinza/vermelho = rode o start.bat." },
  { title: "Horário da campanha", desc: "Você só consegue iniciar dentro da janela definida pelo supervisor." },
  { title: "Participar da campanha", desc: "Sua conta precisa estar na lista de agentes daquela campanha." },
];

export const CALL_FLOW = [
  { n: 1, title: "Escolha a campanha", desc: "Login → Dialer → clique na campanha em que você participa." },
  { n: 2, title: "Iniciar discagem",   desc: "O sistema pega o próximo contato da fila automaticamente." },
  { n: 3, title: "Softphone utilizado toca", desc: "O softphone utilizado da sua máquina disca sozinho. Você só atende." },
  { n: 4, title: "Fale com o lead",    desc: "Os campos do contato (liberados pelo supervisor) aparecem na tela." },
  { n: 5, title: "Encerrar e tabular", desc: "Clique em Encerrar, escolha a disposição e o próximo contato carrega." },
];

export const TROUBLESHOOT = [
  { tag: "Helper offline",          fix: "Abra start.bat na sua máquina. Sem helper, o navegador não consegue acionar o softphone utilizado." },
  { tag: "Fora do horário",         fix: "A campanha tem janela. Volte no horário ou fale com seu supervisor." },
  { tag: "Caiu na caixa postal",    fix: "Tabular como 'caixa postal' — entra na fila de reciclagem." },
  { tag: "Sem contatos pendentes",  fix: "A lista esgotou ou ainda está aguardando reciclagem. Avise o supervisor." },
  { tag: "Sem ramal",               fix: "Procure um admin para atribuir o ramal ao seu usuário." },
];

export const SUPERVISOR_TASKS = [
  { title: "Criar campanha",       desc: "Nome + departamento + horário + agentes participantes + campos visíveis." },
  { title: "Subir mailing",        desc: "Upload .csv/.xlsx → preview → mapear colunas (nome, telefone, extras)." },
  { title: "Regras de reciclagem", desc: "Quais status voltam, tempo de espera, máximo de tentativas." },
  { title: "Disposições",          desc: "Cadastre os resultados possíveis e marque os que disparam aviso via Make." },
  { title: "Dashboard",            desc: "Métricas em tempo real: chamadas/hora, atividade dos agentes, conversão." },
];

export const ADMIN_TASKS = [
  { title: "Aprovar usuários",  desc: "Pendentes → atribua papel, departamento e ramal." },
  { title: "Departamentos",     desc: "Crie, renomeie ou exclua departamentos do negócio." },
];
