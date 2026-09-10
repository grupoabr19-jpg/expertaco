# Intranet #ParceirAÇO | Grupo ABR

Aplicação web interna do Grupo ABR para apoio comercial, comunicação interna e automação operacional.

## O que o sistema faz

- Exibe um playbook de vendas com scripts, objeções, reativação, pós-venda, crise, Kommo e regras de ouro.
- Mostra um ranking comercial com base em fonte externa, JSON local ou gravação manual.
- Oferece uma área autenticada do colaborador com perfil, foto e feed interno.
- Permite administração de áreas, perfis, comunicados e templates de celebração.
- Envia e-mails automáticos de aniversário e aniversário de empresa.
- Publica conteúdos estáticos e assets de apoio como catálogo e marca.

## Arquitetura

- `frontend/public/` contém a SPA e as extensões de interface.
- `frontend/assets/` contém assets usados pela interface.
- `backend/server.js` centraliza o servidor HTTP, a API e o roteamento da SPA.
- `backend/admin-server.js` concentra permissões e endpoints administrativos.
- `backend/scripts/` contém o build e as automações de e-mail.
- `backend/data/ranking.json` serve como fallback local do ranking.
- `backend/test/` contém os testes automatizados.
- `backend/dist/` é a saída do build para deploy.
- `docs/reference-materials/` guarda documentos e capturas de referência que não fazem parte da aplicação.

## Como executar

Requer Node.js 20+.

```bash
node backend/server.js
```

Se preferir desenvolvimento com watch:

```bash
node --watch backend/server.js
```

A aplicação sobe em `http://localhost:3000` por padrão.

## Validação

```bash
node --test
node --check backend/server.js
node --check frontend/public/app.js
node --check frontend/public/auth-extension.js
node --check frontend/public/admin-extension.js
node --check backend/scripts/send-celebrations.js
```

## Ranking

O comportamento do ranking é controlado por `SALES_DATA_MODE`:

- `mock`: lê `backend/data/ranking.json`.
- `manual`: aceita `POST /api/ranking/manual` com `Authorization: Bearer <ADMIN_TOKEN>`.
- `api`: consulta `SALES_DATA_URL` e converte CSV ou JSON em contrato interno.

O contrato esperado inclui:

- `period`
- `updatedAt`
- `teams` ou `regions`
- `sellers`

## Autenticação e perfil

- A autenticação é proxied para Neon Auth via `/api/auth/*`.
- Apenas e-mails `@grupoabr.com.br` são aceitos no fluxo corporativo.
- O perfil autenticado usa PostgreSQL em `public.user_profiles`.
- O feed interno usa `public.feed_posts`.

## Celebrações por e-mail

- O envio usa Gmail SMTP com `IDEAACO_EMAIL_USER` e `IDEAACO_EMAIL_APP_PASSWORD`.
- Os templates ficam em `public.celebration_email_templates`.
- As imagens-base e a composição do cartão comemorativo são persistidas no banco.
- O envio automático grava um log em `public.celebration_email_log`.

## Deploy no Render

- O build copia os arquivos públicos para `backend/dist/`.
- O servidor responde na porta `PORT`.
- O healthcheck é `/api/health`.
- As variáveis sensíveis são configuradas no Render como secrets.

## Variáveis de ambiente

- `PORT`: porta do servidor local.
- `SALES_DATA_MODE`: `mock`, `manual` ou `api`.
- `SALES_DATA_URL`: fonte externa do ranking quando `SALES_DATA_MODE=api`.
- `ADMIN_TOKEN`: token para o modo manual do ranking.
- `KOMMO_API_URL` e `KOMMO_AUTH_TOKEN`: integração com Kommo.
- `DATABASE_URL`: banco PostgreSQL usado por perfil, feed, áreas e templates.
- `NEON_AUTH_BASE_URL`: base do Neon Auth.
- `APP_ORIGIN`: origem pública usada nas chamadas autenticadas.
- `IDEAACO_EMAIL_USER` e `IDEAACO_EMAIL_APP_PASSWORD`: envio de e-mails automáticos.
- `IDEAACO_SMTP_HOST`, `IDEAACO_SMTP_PORT` e `IDEAACO_SMTP_SECURE`: parâmetros SMTP opcionais.
- `CORS_ORIGIN`: não é usado pelo servidor atual.
## Limpeza e manutenção

- O modo manual do ranking grava em arquivo e não deve ser tratado como persistência definitiva em produção.
- O projeto depende de PostgreSQL para perfil, feed, áreas e templates.
- Os documentos de marca e vendas originais serviram de base para o conteúdo da intranet.

## Próximos cuidados

- Confirmar com a liderança comercial qualquer atualização de produto ou discurso.
- Validar o contrato real da planilha de ranking.
- Revisar o comportamento de autenticação antes de expandir permissões.
- Monitorar o envio SMTP em produção após a correção de timeout.
