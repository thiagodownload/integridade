const main = document.querySelector('#conteudo');
const topnav = document.querySelector('.topnav');
const menuButton = document.querySelector('#menuButton');
const toastRegion = document.querySelector('#toastRegion');

const state = {
  reportStep: 1,
  reportData: {},
  lastProtocol: null,
  adminTab: 'geral'
};

const demoCases = [
  { id: 'CI-2026-1042', category: 'Assédio moral', status: 'Novo', priority: 'Alta', age: '18 min', sla: '1h42', owner: 'Não atribuído' },
  { id: 'CI-2026-1037', category: 'Conflito de interesses', status: 'Triagem', priority: 'Média', age: '3h', sla: '5h12', owner: 'Equipe Ética' },
  { id: 'CI-2026-1029', category: 'Fraude / desvio', status: 'Em apuração', priority: 'Crítica', age: '2d', sla: 'Vencido 4h', owner: 'Investigação A' },
  { id: 'CI-2026-1014', category: 'Discriminação', status: 'Aguardando denunciante', priority: 'Alta', age: '5d', sla: 'Pausado', owner: 'Equipe Pessoas' },
  { id: 'CI-2026-0998', category: 'Violação de política', status: 'Concluído', priority: 'Baixa', age: '12d', sla: 'Cumprido', owner: 'Compliance' },
];

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  toastRegion.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function setTitle(title) {
  document.title = `${title} • Canal de Integridade`;
  requestAnimationFrame(() => main.focus());
}

function homeView() {
  setTitle('Início');
  main.innerHTML = `
    <section class="page hero">
      <div>
        <span class="eyebrow">Proteção • Confidencialidade • Não retaliação</span>
        <h1>Um canal para falar com <span>segurança</span>.</h1>
        <p class="lead">Registre uma preocupação, irregularidade ou situação de assédio sem criar conta. O acompanhamento acontece por um protocolo privado e o diálogo pode continuar sem revelar sua identidade aos responsáveis pelo caso.</p>
        <div class="hero-actions">
          <a class="btn primary" href="#/reportar">Registrar um relato</a>
          <a class="btn secondary" href="#/acompanhar">Acompanhar protocolo</a>
        </div>
        <div class="trust-strip" aria-label="Características do canal">
          <span>Sem cadastro obrigatório</span>
          <span>Disponível 24h</span>
          <span>Responsivo no celular</span>
          <span>Diálogo anônimo</span>
        </div>
      </div>
      <aside class="hero-card" aria-label="Como o canal funciona">
        <h2>Como funciona</h2>
        <div class="flow-step"><b>1</b><div><strong>Você registra o relato</strong><p>Um fluxo simples coleta somente o necessário para apuração.</p></div></div>
        <div class="flow-step"><b>2</b><div><strong>Recebe um protocolo privado</strong><p>Ele funciona como sua chave de acompanhamento. Guarde-o em local seguro.</p></div></div>
        <div class="flow-step"><b>3</b><div><strong>A equipe responsável analisa</strong><p>O acesso é restrito por função, conflito de interesse e necessidade.</p></div></div>
        <div class="flow-step"><b>4</b><div><strong>Você acompanha e responde</strong><p>Novas perguntas e atualizações ficam disponíveis no mesmo canal.</p></div></div>
      </aside>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Projetado para gerar confiança</h2><p>O canal não deve obrigar o denunciante a escolher entre segurança, simplicidade e transparência. Dá para ter os três, apesar do histórico humano de complicar formulários.</p></div></div>
      <div class="grid-3">
        <article class="card"><div class="icon-tile">01</div><h3>Anonimato por padrão</h3><p>Dados de contato são opcionais e, quando usados para avisos, ficam separados do conteúdo do caso.</p></article>
        <article class="card"><div class="icon-tile">02</div><h3>Protocolo seguro</h3><p>O identificador precisa ser aleatório e difícil de adivinhar, não uma sequência previsível.</p></article>
        <article class="card"><div class="icon-tile">03</div><h3>Acesso com necessidade</h3><p>Investigadores visualizam somente casos autorizados. Administração técnica não recebe acesso automático ao conteúdo.</p></article>
      </div>
    </section>
  `;
}

function reportView() {
  setTitle('Registrar relato');
  const step = state.reportStep;
  main.innerHTML = `
    <section class="page">
      <div class="page-title"><span class="eyebrow">Novo relato</span><h1>Conte o que aconteceu</h1><p>Você não precisa se identificar. Evite incluir informações sobre sua identidade se isso não for necessário para entender o fato.</p></div>
      <div class="form-layout">
        <form id="reportForm" class="form-card" novalidate>
          <div class="progress" aria-label="Etapa ${step} de 4">${[1,2,3,4].map(n => `<span class="progress-step ${n <= step ? 'active' : ''}"></span>`).join('')}</div>
          ${reportStepMarkup(step)}
          <div class="form-actions">
            ${step > 1 ? '<button class="btn secondary" type="button" id="prevStep">Voltar</button>' : '<a class="btn ghost" href="#/">Cancelar</a>'}
            <button class="btn primary" type="submit">${step === 4 ? 'Enviar relato' : 'Continuar'}</button>
          </div>
        </form>
        <aside class="side-note">
          <div class="note"><strong>Você controla sua identificação</strong><p>Nome, matrícula e login não são exigidos no fluxo público.</p></div>
          <div class="note warning"><strong>Anexos podem revelar identidade</strong><p>Fotos e documentos podem conter nome, autoria, localização ou metadados. Em produção, anexos devem passar por sanitização.</p></div>
          <div class="note"><strong>E-mail é opcional</strong><p>Se informado apenas para avisos, ele deve ficar criptografado e invisível aos atendentes do caso.</p></div>
        </aside>
      </div>
    </section>
  `;
  document.querySelector('#prevStep')?.addEventListener('click', () => {
    collectStep();
    state.reportStep = Math.max(1, state.reportStep - 1);
    reportView();
  });
  document.querySelector('#reportForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!collectStep(true)) return;
    if (state.reportStep < 4) {
      state.reportStep += 1;
      reportView();
    } else {
      state.lastProtocol = generateProtocol();
      state.reportStep = 1;
      successView();
    }
  });
}

function reportStepMarkup(step) {
  if (step === 1) return `
    <fieldset><div class="step-label">Etapa 1 de 4</div><legend>Sobre que tipo de situação você quer relatar?</legend>
      <div class="form-grid">
        <div class="field full"><label for="category">Categoria *</label><select id="category" name="category" required><option value="">Selecione</option><option>Assédio moral</option><option>Assédio sexual</option><option>Discriminação</option><option>Fraude / desvio</option><option>Corrupção / suborno</option><option>Conflito de interesses</option><option>Segurança e saúde no trabalho</option><option>Violação de política interna</option><option>Outro</option></select></div>
        <div class="field"><label for="relationship">Sua relação com a organização</label><select id="relationship" name="relationship"><option>Prefiro não informar</option><option>Colaborador(a)</option><option>Ex-colaborador(a)</option><option>Fornecedor / terceiro</option><option>Cliente</option><option>Outro</option></select></div>
        <div class="field"><label for="location">Unidade / local</label><input id="location" name="location" autocomplete="off" placeholder="Opcional" /></div>
      </div>
    </fieldset>`;
  if (step === 2) return `
    <fieldset><div class="step-label">Etapa 2 de 4</div><legend>O que aconteceu?</legend>
      <div class="form-grid">
        <div class="field full"><label for="description">Descrição do fato *</label><textarea id="description" name="description" required placeholder="Descreva fatos, contexto, datas aproximadas e o que você observou. Evite suposições quando puder separar fatos de opiniões."></textarea><span class="hint">Não inclua seu nome apenas para “preencher melhor”. O formulário sobreviverá sem isso.</span></div>
        <div class="field"><label for="date">Quando aconteceu?</label><input id="date" name="date" type="date" /></div>
        <div class="field"><label for="recurrence">Isso ainda está acontecendo?</label><select id="recurrence" name="recurrence"><option>Não sei informar</option><option>Sim</option><option>Não</option></select></div>
      </div>
    </fieldset>`;
  if (step === 3) return `
    <fieldset><div class="step-label">Etapa 3 de 4</div><legend>Há pessoas ou evidências relacionadas?</legend>
      <div class="form-grid">
        <div class="field full"><label for="people">Pessoas, áreas ou empresas envolvidas</label><textarea id="people" name="people" placeholder="Informe somente o que for útil para apuração." style="min-height:110px"></textarea></div>
        <div class="field full"><label for="evidence">Anexos</label><input id="evidence" name="evidence" type="file" multiple aria-describedby="fileHint" /><span id="fileHint" class="hint">Protótipo: nenhum arquivo é enviado. Produção: arquivos devem ficar em quarentena, ter tipo/tamanho validados e metadados sanitizados quando possível.</span></div>
      </div>
    </fieldset>`;
  return `
    <fieldset><div class="step-label">Etapa 4 de 4</div><legend>Como você quer acompanhar?</legend>
      <div class="form-grid">
        <div class="field full"><div class="check-row"><input id="emailOpt" name="emailOpt" type="checkbox" /><div><label for="emailOpt">Quero receber avisos por e-mail</label><div class="hint">O e-mail não deve ser exibido aos atendentes. Ele serve apenas para avisar que existe uma atualização no protocolo.</div></div></div></div>
        <div class="field full"><label for="email">E-mail para avisos</label><input id="email" name="email" type="email" autocomplete="email" placeholder="Opcional" /><span class="hint">Ao informar um e-mail, você deixa um dado de contato com a infraestrutura de notificação, embora ele possa permanecer oculto da equipe que analisa o caso.</span></div>
        <div class="field full"><div class="check-row"><input id="goodFaith" name="goodFaith" type="checkbox" required /><div><label for="goodFaith">Confirmo que estou enviando o relato de boa-fé *</label><div class="hint">Isso não exige certeza absoluta. Significa relatar honestamente o que você acredita ter ocorrido.</div></div></div></div>
      </div>
    </fieldset>`;
}

function collectStep(validate = false) {
  const form = document.querySelector('#reportForm');
  if (!form) return true;
  if (validate && !form.reportValidity()) return false;
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (value instanceof File) continue;
    state.reportData[key] = value;
  }
  return true;
}

function generateProtocol() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  return `CI-26-${token.slice(0,4)}-${token.slice(4,8)}-${token.slice(8,12)}`;
}

function successView() {
  setTitle('Relato recebido');
  main.innerHTML = `
    <section class="page"><div class="track-box form-card" style="text-align:center">
      <span class="eyebrow">Relato recebido</span><h1>Guarde seu protocolo</h1>
      <p class="lead" style="margin-inline:auto">Ele é a chave para acompanhar o caso e responder a novas perguntas sem criar uma conta.</p>
      <div class="protocol-box"><div class="protocol" id="protocolValue">${state.lastProtocol}</div><p class="hint">Este código não é recuperável no protótipo se você fechar a página.</p></div>
      <div class="hero-actions" style="justify-content:center"><button class="btn primary" id="copyProtocol">Copiar protocolo</button><a class="btn secondary" href="#/acompanhar">Acompanhar agora</a></div>
      <div class="note" style="text-align:left;margin-top:22px"><strong>Em produção</strong><p>O protocolo será gerado com entropia criptográfica e o banco guardará apenas um digest derivado, para que o próprio protocolo não fique exposto em texto puro.</p></div>
    </div></section>`;
  document.querySelector('#copyProtocol').addEventListener('click', async () => {
    await navigator.clipboard?.writeText(state.lastProtocol);
    toast('Protocolo copiado. Guarde-o em local seguro.');
  });
}

function trackingView() {
  setTitle('Acompanhar protocolo');
  main.innerHTML = `
    <section class="page"><div class="page-title" style="text-align:center"><span class="eyebrow">Acompanhamento</span><h1>Consulte seu protocolo</h1><p style="margin-inline:auto">Não é necessário login. O protocolo funciona como uma credencial privada e deve ser difícil de adivinhar.</p></div>
      <div class="track-box form-card"><form id="trackForm" class="track-form"><label class="field"><span>Protocolo</span><input id="trackProtocol" required autocomplete="off" placeholder="CI-26-XXXX-XXXX-XXXX" value="${escapeHtml(state.lastProtocol || '')}" /></label><button class="btn primary" type="submit" style="align-self:end">Consultar</button></form><div id="trackResult"></div></div>
    </section>`;
  document.querySelector('#trackForm').addEventListener('submit', e => {
    e.preventDefault();
    const value = document.querySelector('#trackProtocol').value.trim();
    if (!value) return;
    renderTrackResult(value);
  });
}

function renderTrackResult(protocol) {
  document.querySelector('#trackResult').innerHTML = `
    <div style="margin-top:24px;border-top:1px solid var(--line);padding-top:20px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><strong>${escapeHtml(protocol)}</strong><div class="hint">Última atualização há 2 horas</div></div><span class="badge warn">Em apuração</span></div>
      <div class="timeline">
        <div class="timeline-item"><span class="dot"></span><div><strong>Relato recebido</strong><div>O registro foi criado e encaminhado para triagem.</div><small>24/08/2026 • 14:18</small></div></div>
        <div class="timeline-item"><span class="dot"></span><div><strong>Triagem concluída</strong><div>A equipe responsável iniciou a apuração.</div><small>24/08/2026 • 15:03</small></div></div>
        <div class="timeline-item"><span class="dot"></span><div><strong>Nova pergunta da equipe</strong><div>“Você consegue informar uma data aproximada do segundo episódio mencionado?”</div><small>24/08/2026 • 18:21</small></div></div>
      </div>
      <label class="field" style="margin-top:14px"><span>Responder sem se identificar</span><textarea placeholder="Sua resposta será vinculada apenas ao protocolo."></textarea></label><button class="btn primary small" id="demoReply">Enviar resposta</button>
    </div>`;
  document.querySelector('#demoReply').addEventListener('click', () => toast('Resposta demonstrativa registrada.'));
}

function operationsView() {
  setTitle('Painel de Operações');
  main.innerHTML = `
    <section class="page internal-shell">
      ${internalSidebar('operacoes')}
      <div class="internal-main">
        <header class="internal-header"><div><span class="eyebrow">Operações</span><h1>Fila de atendimento</h1><p>Casos, prazos e prioridades em um só lugar.</p></div><button class="btn secondary" id="notifyButton">Ativar avisos no navegador</button></header>
        <div class="metrics">
          <div class="metric"><small>Novos hoje</small><strong>7</strong><span class="trend">+2 vs. média</span></div>
          <div class="metric"><small>SLA de primeira ação</small><strong>94%</strong><span class="trend">Dentro da meta</span></div>
          <div class="metric"><small>Casos vencidos</small><strong>3</strong><span class="trend bad">Requer atenção</span></div>
          <div class="metric"><small>Tempo médio de triagem</small><strong>2h18</strong><span class="trend">-31 min</span></div>
        </div>
        <div class="dashboard-grid">
          <section class="table-card"><div class="table-head"><div><strong>Casos recentes</strong><div class="hint">Visão limitada conforme permissões e conflito de interesse.</div></div><button class="btn small secondary">Filtros</button></div><div class="table-wrap"><table><thead><tr><th>Protocolo interno</th><th>Categoria</th><th>Status</th><th>Prioridade</th><th>SLA</th><th>Responsável</th></tr></thead><tbody>${demoCases.map(caseRow).join('')}</tbody></table></div></section>
          <aside class="table-card"><div class="table-head"><strong>SLA por etapa</strong></div><div class="sla-list">
            <div class="sla-row"><div style="display:flex;justify-content:space-between"><span>Primeira análise</span><strong>94%</strong></div><div class="bar"><i style="width:94%"></i></div></div>
            <div class="sla-row"><div style="display:flex;justify-content:space-between"><span>Triagem</span><strong>88%</strong></div><div class="bar"><i style="width:88%"></i></div></div>
            <div class="sla-row"><div style="display:flex;justify-content:space-between"><span>Investigação</span><strong>79%</strong></div><div class="bar"><i style="width:79%"></i></div></div>
            <div class="sla-row"><div style="display:flex;justify-content:space-between"><span>Retorno ao denunciante</span><strong>97%</strong></div><div class="bar"><i style="width:97%"></i></div></div>
          </div></aside>
        </div>
      </div>
    </section>`;
  document.querySelector('#notifyButton').addEventListener('click', enableNotifications);
}

function caseRow(c) {
  const statusClass = c.status === 'Novo' ? 'new' : c.status === 'Concluído' ? 'ok' : c.status === 'Em apuração' ? 'warn' : '';
  const slaClass = c.sla.includes('Vencido') ? 'bad' : c.sla === 'Cumprido' ? 'ok' : c.sla === 'Pausado' ? '' : 'warn';
  return `<tr><td><strong>${c.id}</strong><div class="hint">${c.age}</div></td><td>${c.category}</td><td><span class="badge ${statusClass}">${c.status}</span></td><td>${c.priority}</td><td><span class="badge ${slaClass}">${c.sla}</span></td><td>${c.owner}</td></tr>`;
}

function adminView() {
  setTitle('Administração');
  main.innerHTML = `
    <section class="page internal-shell">
      ${internalSidebar('admin')}
      <div class="internal-main">
        <header class="internal-header"><div><span class="eyebrow">Administração</span><h1>Regras e configurações</h1><p>Configuração do canal sem conceder acesso automático ao conteúdo das denúncias.</p></div><button class="btn primary">Salvar alterações</button></header>
        <div class="admin-tabs" role="tablist" aria-label="Seções administrativas">
          ${[['geral','Geral'],['categorias','Categorias'],['sla','SLA'],['notificacoes','Notificações'],['email','E-mail'],['acesso','Acessos'],['privacidade','Privacidade']].map(([id,label]) => `<button class="admin-tab ${state.adminTab === id ? 'active' : ''}" data-tab="${id}" role="tab">${label}</button>`).join('')}
        </div>
        <div id="settingsContent">${settingsMarkup(state.adminTab)}</div>
      </div>
    </section>`;
  document.querySelectorAll('.admin-tab').forEach(btn => btn.addEventListener('click', () => {
    state.adminTab = btn.dataset.tab;
    adminView();
  }));
}

function settingsMarkup(tab) {
  const common = {
    geral: `
      <div class="settings-grid"><section class="setting-card"><h3>Identidade do canal</h3><p>Marca, textos públicos e comportamento da página inicial.</p><div class="field"><label>Nome do canal</label><input value="Canal de Integridade" /></div><div class="field" style="margin-top:12px"><label>Mensagem principal</label><textarea style="min-height:95px">Um ambiente seguro para relatar preocupações e irregularidades.</textarea></div></section>
      <section class="setting-card"><h3>Disponibilidade</h3><p>Recursos públicos habilitados.</p>${toggleLine('Relato anônimo', true)}${toggleLine('Acompanhamento por protocolo', true)}${toggleLine('E-mail opcional para avisos', true)}${toggleLine('Upload de anexos', true)}</section></div>`,
    categorias: `<div class="settings-grid"><section class="setting-card"><h3>Categorias</h3><p>Formulários podem mudar por categoria, sem transformar a pessoa em especialista jurídico.</p>${['Assédio moral','Assédio sexual','Discriminação','Fraude / desvio','Corrupção / suborno','Conflito de interesses','Segurança e saúde','Outro'].map(x => `<div class="setting-line"><span>${x}</span><span class="badge ok">Ativa</span></div>`).join('')}</section><section class="setting-card"><h3>Roteamento</h3><p>Casos podem ser encaminhados por categoria, unidade e conflito de interesse.</p>${toggleLine('Fluxo especial para alta direção', true)}${toggleLine('Bloquear envolvidos no caso', true)}${toggleLine('Exigir dupla validação em casos críticos', true)}</section></div>`,
    sla: `<div class="settings-grid"><section class="setting-card"><h3>Política padrão</h3><p>Prazos devem considerar calendário de trabalho, pausas justificadas e prioridade.</p><div class="form-grid"><div class="field"><label>Primeira ação</label><input value="4 horas úteis" /></div><div class="field"><label>Triagem</label><input value="1 dia útil" /></div><div class="field"><label>Plano de apuração</label><input value="3 dias úteis" /></div><div class="field"><label>Atualização ao denunciante</label><input value="5 dias úteis" /></div></div></section><section class="setting-card"><h3>Alertas de SLA</h3><p>Evita que uma denúncia descubra a aposentadoria esperando resposta.</p>${toggleLine('Avisar em 70% do prazo', true)}${toggleLine('Escalar em 90% do prazo', true)}${toggleLine('Avisar gestor quando vencer', true)}</section></div>`,
    notificacoes: `<div class="settings-grid"><section class="setting-card"><h3>Eventos</h3><p>Conteúdo de avisos deve ser genérico para não vazar informação em caixa de entrada ou tela bloqueada.</p>${toggleLine('Nova denúncia', true)}${toggleLine('Nova mensagem do denunciante', true)}${toggleLine('SLA próximo do vencimento', true)}${toggleLine('Mudança de responsável', false)}</section><section class="setting-card"><h3>Canais internos</h3><p>Notificações em tempo real usam canais privados e regras de autorização.</p>${toggleLine('Painel em tempo real', true)}${toggleLine('Web Push', true)}${toggleLine('E-mail', true)}</section></div>`,
    email: `<div class="settings-grid"><section class="setting-card"><h3>Remetente</h3><p>Segredos do provedor não ficam nesta tela nem no banco da aplicação.</p><div class="field"><label>Nome do remetente</label><input value="Canal de Integridade" /></div><div class="field" style="margin-top:12px"><label>Endereço de envio</label><input value="notificacoes@empresa.com.br" /></div><div class="field" style="margin-top:12px"><label>Provedor</label><select><option>API HTTPS configurada no ambiente</option><option>Worker externo para SMTP</option></select></div></section><section class="setting-card"><h3>Privacidade do aviso</h3><p>E-mail não deve copiar texto da denúncia, nomes ou categoria sensível.</p>${toggleLine('Assunto genérico', true)}${toggleLine('Não incluir detalhes do caso', true)}${toggleLine('Registrar falhas de entrega', true)}</section></div>`,
    acesso: `<div class="settings-grid"><section class="setting-card"><h3>Separação de funções</h3><p>Configurar o site não equivale a poder ler denúncias. Milagres ainda existem.</p><div class="setting-line"><span>Administrador da plataforma</span><span class="badge">Configuração</span></div><div class="setting-line"><span>Gestor de compliance</span><span class="badge warn">Casos autorizados</span></div><div class="setting-line"><span>Investigador</span><span class="badge warn">Casos atribuídos</span></div><div class="setting-line"><span>Auditor</span><span class="badge">Somente leitura</span></div></section><section class="setting-card"><h3>Autenticação</h3><p>MFA obrigatório na área interna e sessões curtas para funções sensíveis.</p>${toggleLine('MFA obrigatório', true)}${toggleLine('Bloqueio após tentativas', true)}${toggleLine('Revogar sessão ao mudar papel', true)}</section></div>`,
    privacidade: `<div class="settings-grid"><section class="setting-card"><h3>Minimização</h3><p>O sistema coleta apenas o que precisa para receber, apurar e acompanhar relatos.</p>${toggleLine('Sem analytics de marketing no portal público', true)}${toggleLine('Contato separado do caso', true)}${toggleLine('Sanitização de metadados de anexos', true)}${toggleLine('Supressão de grupos pequenos em métricas', true)}</section><section class="setting-card"><h3>Retenção e incidentes</h3><p>Prazo de retenção deve ser aprovado por jurídico/DPO conforme finalidade e risco, não escolhido no palpite.</p><div class="field"><label>Política de retenção</label><select><option>Configurada por categoria e base legal</option></select></div>${toggleLine('Registro de incidentes de segurança', true)}${toggleLine('Auditoria imutável de ações críticas', true)}</section></div>`
  };
  return common[tab] || common.geral;
}

function toggleLine(label, checked) {
  return `<div class="setting-line"><span>${label}</span><label class="toggle"><input type="checkbox" ${checked ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`;
}

function internalSidebar(active) {
  return `<aside class="sidebar"><div class="sidebar-title"><strong>Canal de Integridade</strong><small>Ambiente interno</small></div><nav class="side-nav"><a class="${active==='operacoes'?'active':''}" href="#/operacoes">Operações</a><a href="#/operacoes">Meus casos</a><a href="#/operacoes">SLA e filas</a><a class="${active==='admin'?'active':''}" href="#/admin">Administração</a><a href="#/">Portal público</a></nav></aside>`;
}

async function enableNotifications() {
  if (!('Notification' in window)) return toast('Este navegador não oferece notificações web.');
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    toast('Avisos do navegador ativados. Em produção, o conteúdo será sempre genérico.');
    new Notification('Canal de Integridade', { body: 'Há uma nova atualização no painel. Acesse o ambiente interno.' });
  } else toast('Permissão de notificações não concedida.');
}

function textPage(title, body) {
  setTitle(title);
  main.innerHTML = `<section class="page"><div class="track-box form-card"><span class="eyebrow">Informações</span><h1>${title}</h1>${body}</div></section>`;
}

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  topnav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  if (path === '/') homeView();
  else if (path === '/reportar') reportView();
  else if (path === '/acompanhar') trackingView();
  else if (path === '/operacoes') operationsView();
  else if (path === '/admin') adminView();
  else if (path === '/como-funciona') textPage('Como funciona', '<p>O relato é recebido, triado, encaminhado conforme categoria e conflito de interesse, apurado e concluído. O denunciante acompanha por protocolo e pode trocar mensagens sem criar uma conta.</p>');
  else if (path === '/privacidade') textPage('Privacidade', '<p>O desenho de produção deve minimizar dados, separar contato de conteúdo, impedir acesso desnecessário, proteger anexos, registrar ações administrativas e aplicar retenção compatível com a finalidade e a legislação.</p>');
  else if (path === '/acessibilidade') textPage('Acessibilidade', '<p>O projeto adota navegação por teclado, foco visível, alvos de toque amplos, rótulos explícitos, contraste e respeito a redução de movimento. A meta de produção é WCAG 2.2 nível AA.</p>');
  else homeView();
}

menuButton.addEventListener('click', () => {
  const open = topnav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
