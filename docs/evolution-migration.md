# Migração do conector QR para a Evolution API

Esta integração deixa o CRM falar diretamente com a Evolution API. O processo antigo em Baileys permanece disponível como rollback enquanto as contas são reconectadas e validadas.

## Estado conhecido da VPS InterServer

- O conector atual roda em `/opt/organizap/app/qr-connector` e publica `127.0.0.1:3001`.
- Há quatro diretórios de sessão, com cerca de 507 MB no total.
- O CRM recebe chamadas do conector e encaminha mensagens e mídias para o Supabase.
- A Evolution deve ser instalada em uma pasta e projeto Compose separados. Não reutilize nem remova o volume `qr-connector/data`.

## Instalação isolada

1. Confirme espaço em disco e memória antes de baixar as imagens: `df -h /` e `free -h`.
2. Crie `/opt/organizap/app/evolution` e copie para lá `deploy/evolution/docker-compose.yml` e `.env.example` deste repositório.
3. Copie `.env.example` para `.env`; use uma URL HTTPS dedicada que aponte para o IP da VPS. Gere valores aleatórios independentes em hexadecimal para a chave da API, a senha do PostgreSQL e o segredo do webhook. Use a senha do banco na `DATABASE_CONNECTION_URI` sem alterar os outros parâmetros.
4. Proteja `.env` com `chmod 600 .env` e nunca o envie ao Git ou ao chat.
5. Ajuste o bloco Caddy existente de `connect.tpxdigital.com` usando o [patch de Caddy](../deploy/evolution/Caddyfile.patch.txt): libere `/evolution/*` da autenticação básica (o endpoint valida a chave `apikey`) e encaminhe esse prefixo para `127.0.0.1:8080`, removendo o prefixo. A Evolution fica no endereço `https://connect.tpxdigital.com/evolution`; as demais rotas continuam indo ao conector atual.
6. Inicie com `docker compose pull && docker compose up -d` dentro da pasta da Evolution. Confira `docker compose ps` e `curl -fsS http://127.0.0.1:8080/`, que responde a mensagem de boas-vindas da versão 2.3.7.

O Compose fixa `evoapicloud/evolution-api:v2.3.7`, grava instâncias e banco em volumes próprios, e mantém Postgres e Redis sem portas publicadas. O Manager não é necessário para o CRM.

## Configuração do OrganiZAP

Configure no ambiente de produção do CRM e redeploy:

- `WHATSAPP_QR_PROVIDER=evolution`
- `EVOLUTION_API_URL=https://connect.tpxdigital.com/evolution`
- `EVOLUTION_API_KEY=<AUTHENTICATION_API_KEY da VPS>`
- `EVOLUTION_WEBHOOK_SECRET=<segredo aleatório, diferente da API key>`
- `EVOLUTION_GROUP_MONITOR_ENABLED=false` (habilite só se a captura de mensagens de grupos estiver desejada)

As credenciais são usadas somente no servidor. O webhook recebe um segredo aleatório em cabeçalho próprio e identifica a conta pelo nome determinístico da instância. Não habilite importação histórica: o CRM ignora os eventos de histórico e sincronização.

## Corte por etapas e rollback

1. Mantenha o conector QR atual em execução e faça backup de `/opt/organizap/app/qr-connector/data` antes de qualquer corte.
2. Após publicar o CRM com a Evolution disponível, gere e escaneie um novo QR para uma conta piloto. A Evolution salva as próprias credenciais no banco dela; as quatro sessões Baileys atuais não são consideradas portáveis.
3. Confira estado conectado, mensagem recebida, mídia, envio pela automação e grupos. Depois repita a reconexão para cada conta.
4. Só desative o conector antigo quando todas as contas migradas estiverem validadas. Preserve o backup até o período de rollback terminar.

Para rollback, configure `WHATSAPP_QR_PROVIDER=qr` no CRM e publique novamente. Reative o serviço antigo somente se ele tiver sido parado; não apague seu container, `.env` ou pasta `data` antes da validação final.

## Referências oficiais

- [Instalação Docker da Evolution API v2](https://github.com/evolution-foundation/docs-evolution/blob/main/v2/en/install/docker.mdx)
- [Repositório oficial e arquitetura da API](https://github.com/evolution-foundation/evolution-api)
- [Eventos de webhook suportados](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/02-Configuration/Webhooks.md)
- [Criação de instâncias com webhook](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/03-Instance%20contoller/00-create-instance.md)
