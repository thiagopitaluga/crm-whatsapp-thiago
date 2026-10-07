# Ativação de grupos no OrganiZAP

O painel, as APIs e as tabelas podem ser publicados independentemente do
conector. **Envios não são aceitos** até que
`GROUP_BROADCAST_SCHEDULER_ENABLED=true` esteja configurado no ambiente do
CRM. O plano Hobby da Vercel não permite um Cron Job a cada minuto; use o
agendador da VPS ou outro agendador confiável.

## Conector QR na VPS

O conector em `/opt/organizap/app/qr-connector` precisa receber a versão de
`qr-connector/src/index.js` deste repositório. Preserve rigorosamente `.env`
e `data/`: `data/` contém as sessões autenticadas do WhatsApp. Confirme o
volume persistente do `docker-compose.yml` e faça backup antes de reconstruir
o contêiner. A reconstrução pode interromper a conexão por alguns segundos,
mas não deve exigir novo QR se as sessões persistidas forem mantidas.

Configure `SUPABASE_STORAGE_ORIGIN=https://jsglzezkiwsypoonifxm.supabase.co`
no `.env` do conector para restringir as mídias ao Storage deste projeto.

## Agendador

1. Gere um segredo aleatório forte e configure o mesmo valor como
   `CRON_SECRET` nas variáveis **Production** da Vercel e no ambiente protegido
   do agendador da VPS. Não coloque o segredo no repositório ou no crontab.
2. Faça o agendador chamar `GET
   https://organizap.tpxdigital.com/api/whatsapp/group-broadcasts/cron`
   a cada minuto com `Authorization: Bearer <CRON_SECRET>`. A rota valida o
   segredo e responde com a quantidade de campanhas processadas.
3. Confirme que a rota retorna `200` e que o conector responde à lista de
   grupos antes de configurar `GROUP_BROADCAST_SCHEDULER_ENABLED=true` em
   **Production**. Essa chave é a trava de segurança para novos disparos.
4. Faça um teste controlado com um grupo administrado pela própria conta,
   verificando o resultado no painel e no WhatsApp. Não repita uma entrega
   marcada como **incerta** sem conferi-la no WhatsApp.

As campanhas têm limite diário e intervalo configuráveis. O worker registra
cada alvo separadamente, não reenvia entregas incertas automaticamente e
somente usa grupos presentes na sessão QR da conta.
