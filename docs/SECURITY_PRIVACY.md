# Segurança, privacidade e anonimato

## Anonimato: promessa correta

O produto deve prometer anonimato **para a organização e para os atendentes**, desde que a pessoa não se identifique no texto ou em anexos. Evite afirmar “nenhum IP é coletado em hipótese alguma” sem validar tecnicamente todos os provedores.

Serviços web normalmente recebem IP no nível de rede. No Supabase, logs de edge/API podem conter `x-real-ip`. Portanto, o portal público não deve chamar diretamente as tabelas/Storage/Edge Functions se a proposta comercial for anonimato forte.

Arquitetura recomendada:
- privacy gateway dedicado na frente da API pública;
- acesso ao IP somente para proteção antiabuso durante janela curta;
- nenhum IP persistido na base de casos;
- remover `X-Forwarded-For`, `X-Real-IP` e identificadores desnecessários antes do origin;
- sem cookies de marketing, pixels ou ferramentas de session replay;
- política formal de retenção de logs da infraestrutura;
- DPA e inventário de subprocessadores.

## Protocolo

Não usar `2026-000123` como única chave de acesso. Sequências assim são enumeráveis.

Use um token aleatório de alta entropia, legível em blocos. Exemplo de formato visual:

`CI-26-ABCD-EFGH-JKLM-NPQR`

O banco grava somente `HMAC-SHA256(protocol, pepper)`; o pepper fica em secret manager.

## E-mail opcional

Se o denunciante fornecer e-mail:
- criptografar em camada de aplicação;
- armazenar em tabela separada;
- não expor aos investigadores;
- usar apenas para avisos;
- não incluir conteúdo sensível no e-mail;
- permitir desativar avisos sem abrir o conteúdo do caso para o provedor de e-mail.

A pessoa deve ser informada de que, ao usar e-mail, o provedor de e-mail e a infraestrutura de entrega necessariamente processam esse endereço.

## Anexos

Riscos comuns:
- EXIF de imagens;
- autor e empresa em metadados Office/PDF;
- nomes de arquivo;
- GPS;
- macros e arquivos maliciosos.

Controles:
- bucket privado;
- nome aleatório no storage;
- allowlist de tipos;
- validar MIME por conteúdo, não só extensão;
- limite de tamanho;
- quarentena até varredura;
- CDR/sanitização para tipos suportados;
- remover EXIF de imagens;
- URLs assinadas com expiração curta;
- download somente por usuário autorizado;
- registrar acesso ao anexo.

## Autenticação interna

- MFA obrigatório.
- Sessão curta para funções sensíveis.
- Reautenticação para exportação, mudança de papéis e configurações críticas.
- RLS no banco, não apenas proteção no frontend.
- Usuários técnicos e humanos separados.
- Secret/service key jamais no navegador.

## Logs

Não registrar:
- descrição do relato;
- protocolo em texto puro;
- e-mail do denunciante;
- anexos;
- mensagens completas;
- tokens de sessão.

Logs úteis:
- ID interno do evento;
- ator interno;
- tipo de ação;
- status de resposta;
- duração;
- erro sanitizado;
- identificador de correlação.

## Analytics

Métricas administrativas podem reidentificar pessoas em unidades pequenas. Aplicar:
- agregação;
- supressão de células com menos de 5 casos quando fizer sentido;
- filtros por período mínimo;
- sem drill-down para quem não possui permissão de caso;
- exportações auditadas.
