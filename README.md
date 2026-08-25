# Canal de Integridade — v0.1

Protótipo responsivo e arquitetura inicial para um canal empresarial de denúncias/relatos com foco em anonimato operacional, acompanhamento por protocolo, gestão de casos, SLA, auditoria e notificações.

## O que já está neste pacote

- Protótipo navegável, sem dependências, para desktop e celular.
- Fluxo público: início, registro guiado e acompanhamento por protocolo.
- Painel de Operações: fila, métricas de SLA, casos e atualizações.
- Painel de Administração: regras, categorias, SLA, roteamento, e-mail, papéis, privacidade e marca.
- Esquema inicial do PostgreSQL/Supabase com RLS e separação de funções.
- Edge Functions de referência para criar relato, consultar protocolo e disparar notificações.
- Documentação de arquitetura, privacidade, segurança e roadmap.

## Executar o protótipo

No diretório `prototype`:

```bash
python3 -m http.server 8080
```

Depois abra `http://localhost:8080`.

Rotas do protótipo:

- `#/` — portal público
- `#/reportar` — novo relato
- `#/acompanhar` — acompanhamento por protocolo
- `#/operacoes` — painel de atendimento
- `#/admin` — administração de regras/configurações

> O protótipo é visual e usa dados fictícios. Ele não grava relatos reais. Isso é intencional: um canal de denúncias não deve nascer com armazenamento improvisado.

## Direção de produção

- Frontend: React + TypeScript, com build estático ou Next.js se houver necessidade de SSR.
- Banco/Auth/Storage/Realtime: Supabase.
- Operações sensíveis públicas: Edge Functions ou API dedicada; não expor tabelas de relatos diretamente ao navegador.
- Entrada anônima: privacy gateway antes do Supabase para minimizar logs de IP e cabeçalhos identificadores.
- E-mail: provedor por API HTTPS. Credenciais ficam em secret manager, nunca em tabela nem no GitHub.
- Notificações no painel: Supabase Realtime em canais privados + Web Push com conteúdo genérico.
- MFA obrigatório para usuários administrativos.

## Princípio central de anonimato

“Anônimo para os atendentes e para a empresa” é viável. “Nenhum provedor de infraestrutura jamais recebe um IP de rede” não é uma promessa tecnicamente honesta na web comum. A arquitetura de produção deve minimizar coleta e retenção, separar dados de contato e impedir que a equipe de tratamento veja identificadores desnecessários.

Veja `docs/SECURITY_PRIVACY.md`.
