# Editor visual do Instagram

O painel Instagram > Automações utiliza o canvas e os componentes do editor do Jaspion, adaptados ao tema e ao isolamento de empresas do Organizap.

## Configuração

- Gatilhos múltiplos: Direct, primeira mensagem, comentário, Story, menção, anúncio, Live, compartilhamento, referência, início de conversa e resposta padrão. O gatilho de novo seguidor pode ser preparado como rascunho, mas sua ativação é recusada porque não há evento correspondente nesta integração.
- Mensagens: textos, imagens, PDFs, pausas e até três botões. Cada botão abre um endereço HTTPS ou continua por outro bloco. Os arquivos são enviados diretamente ao armazenamento por autorização temporária; até 10 MB.
- Condições: segue o perfil, tag presente/ausente, última interação, visto por último, número de seguidores e perfil verificado. Atributos ausentes da Meta não são inventados.
- Tags: adicionadas/removidas no contato do Instagram. Aparecem na aba Contatos e podem ser usadas nas condições.
- Ações: continuar, abrir/encerrar conversa, atendimento humano e remover tags. Atendimento humano pausa novas execuções para essa conversa.
- Duplicação, arquivo lógico de fluxos, remoção de conexões, duplicação/remoção de blocos, busca, minimapa e zoom.

## Execução

Salvar cria ou atualiza um rascunho pausado. A ativação exige perfil da mesma empresa, configuração válida e INSTAGRAM_AUTOMATION_ENABLED=true. Salvar/pausar cancela continuações pendentes daquela automação.

O webhook verifica a assinatura antes de registrar eventos. Os gatilhos de anúncio, referência e Story usam os metadados do evento, não suposições pelo texto. Uma restrição única impede agendar duas respostas para o mesmo evento. O plano é congelado por execução; cada envio confirmado registra seu progresso. Pausas são retomadas pela fila a partir de run_at, conforme a frequência do agendador existente. Entregas incertas exigem revisão e não são reenviadas automaticamente.

Comentários permitem uma única resposta privada. Textos e links anteriores à primeira espera são combinados; os botões podem continuar o fluxo após interação no Direct. A resposta pública usa uma das variações configuradas.

As credenciais e a validação real do app Meta são uma etapa separada da publicação deste editor. Esta implementação não modifica os endereços ou credenciais do app Jaspion.

## Banco e verificações

Migration: 20261121030000_instagram_visual_editor.sql. Adiciona o grafo, progresso das execuções, tags e atributos dos contatos do Instagram, armazenamento dos arquivos e função de tags restrita ao serviço.

Verificações: testes em src/lib/instagram e src/app/api/instagram; TypeScript; ESLint nos arquivos do editor e executor; build de produção.
