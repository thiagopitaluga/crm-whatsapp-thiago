# Configurações por etapa do Kanban

Implementação na branch `codex/kanban-stage-settings`, baseada em `origin/main` (069e5d6).

## Uso

Cada coluna tem um botão de configurações. Administradores podem salvar; agentes consultam. O painel inclui:

- Classificação por IA: agendamento, cancelamento/no-show, pagamento informado, interesse, objeção de preço, silêncio ou instrução personalizada. A classificação usa o provedor de IA ativo da conta. Não comprova pagamentos ou presença: interpreta evidências da conversa.
- Gatilhos independentes da IA: ao entrar ou após horas sem resposta; enviar texto por Cloud API ou QR e adicionar tag. Modelos de boas-vindas, retomada de 24h e marcação ao entrar, além de criação livre.
- E-mail com destinatários separados por vírgula, assunto, HTML e variáveis de contato, etapa e funil.
- Evento Meta pela API de Conversões. Pixel/token pertencem à conta; o token não retorna ao navegador e é armazenado com a criptografia existente.
- Histórico das 15 execuções mais recentes, incluindo erros e cancelamentos.

As regras começam desativadas nas etapas existentes. Salvar configurações não dispara ações retroativas. A criação de uma oportunidade conta como entrada na etapa.

## Execução

A migração adiciona configurações e uma fila durável. Um trigger de banco registra entradas, independentemente de terem sido feitas pelo Kanban, edição, integração ou IA. Outro enfileira mensagens recebidas via QR ou Cloud. O cron existente de automações processa essa fila. Portanto, a latência depende da frequência do cron.

Cada trabalho é reivindicado atomicamente. Trabalhos antigos são cancelados se o lead sair da etapa, inclusive se depois retornar. Retomadas também são canceladas quando há nova mensagem do cliente. Editar/desativar um gatilho invalida seus trabalhos antigos. Falhas não são reenviadas automaticamente, pois um timeout pode ter ocorrido após o provedor aceitar o envio. Um trabalho que permaneça `running` após interrupção requer revisão operacional.

A movimentação de IA preserva conversas assumidas por humano ou com IA pausada e usa comparação da etapa de origem antes de gravar. Mensagens antigas são descartadas; a primeira etapa elegível na ordem do funil prevalece. Silêncio é contado desde a entrada e só avança para etapas posteriores, evitando ciclos de inatividade.

Cloud API usa texto livre somente dentro da janela de 24 horas; uma retomada fora dessa janela fica como falha explicada no histórico. Para retomadas por QR, escolha QR Code no gatilho e publique também o conector atualizado. Modelos oficiais HSM e as outras ações do editor geral de automações não fazem parte deste painel inicial.

## Ativação no ambiente

1. Aplicar `supabase/migrations/20261113010000_stage_settings.sql` após as migrações existentes.
2. Publicar a aplicação e, se usar QR, o conector (novo endpoint autenticado `messages/send`).
3. O agendador da VPS já chama o CRM a cada minuto com `Authorization: Bearer $CRON_SECRET`. A rota de automações reutiliza esse segredo e esse cabeçalho; atualize o serviço versionado para chamar também `/api/automations/cron`. A mera existência do segredo não instala o agendador. O cron roda retomadas pendentes, fluxos, automações e ações das etapas.
4. Para e-mail: configurar `RESEND_API_KEY` e `STAGE_EMAIL_FROM` com remetente verificado no provedor.
5. Para Meta: cadastrar pixel/token em “Integrações da conta” dentro do painel. `ENCRYPTION_KEY` precisa estar configurada. `META_GRAPH_API_VERSION` é opcional; padrão v22.0. Telefone normalizado e e-mail em minúsculas são enviados com SHA-256. A origem é `system_generated`, pois representa avanço no CRM.
6. Para IA: configurar e ativar o provedor da conta.

Nenhum token, migração remota, envio, evento Meta ou implantação de produção foi executado durante a implementação. O teste integrado deve usar uma conta de teste e destinatários controlados antes da ativação das regras reais.

## Verificações

Os testes de configurações cobrem payloads inválidos, instruções, eventos, destinatários, IDs duplicados, atrasos e escape de HTML. Os testes do worker cobrem disputa de execução, saída/retorno à etapa, falha de consulta e indisponibilidade da fila. Testes com provedores reais e validação da migração num PostgreSQL de teste ainda são necessários para certificar a operação completa.
