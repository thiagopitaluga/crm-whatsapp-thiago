# Assinaturas com AbacatePay em modo de teste

1. No painel da AbacatePay, ative o Modo Teste e cadastre um produto recorrente mensal ou anual em reais.
2. No Organizap, vincule à empresa piloto um plano com o mesmo valor e período do produto.
3. Crie na AbacatePay uma chave V2 de teste com `PRODUCT:READ`, `SUBSCRIPTION:CREATE` e `SUBSCRIPTION:READ`. Configure-a no servidor em `ABACATEPAY_TEST_API_KEY`.
4. Configure `ABACATEPAY_TEST_ACCOUNT_ID` com o UUID da empresa piloto e `ABACATEPAY_TEST_PRODUCT_ID` com o ID do produto.
5. No Modo Teste, cadastre o webhook `https://organizap.tpxdigital.com/api/billing/abacatepay/webhook` com um segredo aleatório de pelo menos 32 caracteres. Configure o mesmo valor no servidor em `ABACATEPAY_TEST_WEBHOOK_SECRET`. Selecione `subscription.completed`, `subscription.trial_started`, `subscription.renewed`, `subscription.payment_failed` e `subscription.cancelled`.
6. Após publicar o ambiente com as variáveis, abra `/assinatura` como proprietário da empresa piloto. Gere o checkout e use o botão de simulação da AbacatePay. Reabra a página para ver o resultado confirmado por webhook.

O piloto reserva uma tentativa por empresa e recupera o checkout pelo identificador externo se a resposta de criação se perder. Durante a homologação, use uma empresa de teste dedicada. As simulações são armazenadas fora da assinatura comercial, da receita e das permissões de acesso.

- [Checkout de assinatura](https://docs.abacatepay.com/pages/subscriptions/create)
- [Modo Teste](https://docs.abacatepay.com/pages/comecar/modo-teste)
- [Eventos de assinatura](https://docs.abacatepay.com/pages/webhooks/events/subscriptions)
