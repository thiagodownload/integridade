# Arquitetura proposta

## 1. Fronteiras do sistema

### Portal público
- Registrar relato sem conta.
- Acompanhar por protocolo privado de alta entropia.
- Conversa bidirecional anônima.
- E-mail opcional somente para aviso de atualização.
- Upload seguro de anexos, com quarentena e sanitização.

### Painel de Operações
- Fila de novos casos.
- Triagem, prioridade, responsável, status e SLA.
- Conversa com denunciante.
- Notas internas separadas das mensagens públicas.
- Evidências, histórico e trilha de auditoria.
- Regras de conflito de interesse e casos restritos.

### Painel de Administração
- Branding e textos públicos.
- Categorias e formulários condicionais.
- Políticas de SLA por categoria/prioridade.
- Roteamento e escalonamento.
- Regras de notificação.
- Configuração não-secreta de e-mail.
- Usuários, papéis e escopos.
- Privacidade, retenção e segurança.

**Separação de funções:** `platform_admin` administra a plataforma, mas não lê denúncias por padrão. Acesso ao conteúdo depende de papel operacional ou atribuição explícita.

## 2. Fluxo de alto nível

1. Navegador acessa o portal público sem analytics de marketing.
2. Requisições de relato passam por privacy gateway/antiabuso.
3. Gateway remove cabeçalhos identificadores antes de encaminhar para a API.
4. Edge Function valida entrada e cria o caso no PostgreSQL.
5. Protocolo aleatório é devolvido ao usuário; banco armazena apenas HMAC do protocolo.
6. E-mail opcional é criptografado e armazenado em tabela separada.
7. Evento `report_created` alimenta outbox de notificações.
8. Equipe interna recebe aviso genérico por Realtime/Web Push/e-mail.
9. RLS limita cada profissional aos casos permitidos.
10. Alterações críticas geram `audit_events` sem copiar o corpo da denúncia para logs.

## 3. SLA

Métricas recomendadas:
- tempo até primeira ação humana;
- tempo de triagem;
- tempo até plano de apuração;
- tempo desde última atualização ao denunciante;
- tempo total até resolução/encerramento;
- percentual dentro do SLA por etapa;
- volume em atraso;
- aging por faixa;
- reabertura;
- backlog por responsável;
- tendências por categoria e unidade, com supressão de grupos pequenos.

SLA deve considerar:
- calendário de dias úteis;
- feriados configuráveis;
- fuso horário;
- pausa com motivo e auditoria;
- prioridade;
- escalonamento em 70%, 90% e vencimento;
- políticas distintas por categoria.

## 4. Notificações

Eventos principais:
- novo relato;
- nova mensagem do denunciante;
- nova mensagem da equipe;
- atribuição/reatribuição;
- mudança de status;
- SLA em risco;
- SLA vencido;
- falha de entrega de e-mail;
- caso restrito criado.

Regra de ouro: e-mails e pushes nunca incluem descrição, nome de envolvido ou categoria sensível. Mostram apenas que “há uma atualização” e levam o usuário ao ambiente autenticado.

## 5. Escalabilidade futura

O schema já nasce com `organization_id`, permitindo evolução para SaaS multiempresa sem misturar dados. Antes de vender como SaaS, incluir:
- isolamento por tenant testado automaticamente;
- chaves criptográficas por tenant;
- domínios customizados;
- políticas e templates por cliente;
- faturamento/licenciamento;
- data residency e contratos de operador/controlador;
- pacote de evidências de conformidade.
