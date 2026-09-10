# Plano de Desenvolvimento do Backend — Cerne

**Versão 4.0 · 31 de agosto de 2026**
TCC Wagner Duarte — comparação entre GitHub Spec Kit e BMAD-METHOD

**Todas as decisões estão fechadas.** Este documento substitui as versões 1, 2 e 3 e é escrito para ser seguido por alguém sem experiência prévia em backend. Não contém código — a implementação será feita no Claude Code a partir daqui.

---

## Como usar este documento

Leia a Seção 1 e a Seção 2 antes de qualquer coisa. Elas explicam **por que** este backend é diferente de um backend comum e definem o vocabulário que aparece no resto do texto. Sem isso, as decisões da Seção 3 parecem arbitrárias.

Depois, as seções 3 a 7 são referência: consulte conforme a fase em que estiver. A Seção 8 é o roteiro de execução, dia a dia. A Seção 9 é a lista que precisa estar 100% marcada antes de liberar o backend.

Um aviso sobre o tom: em vários pontos este plano escolhe a opção **mais trabalhosa**. Isso não é descuido. A Seção 1 explica o critério.

---

## 1. O que é este backend

### 1.1 Ele não é um produto — é um instrumento de medição

Num projeto normal, o backend existe para servir o aplicativo. Aqui não. Aqui o backend existe para que **duas construções diferentes do mesmo aplicativo possam ser comparadas de forma justa**.

O experimento funciona assim: você vai construir o app Cerne duas vezes. A primeira usando GitHub Spec Kit, a segunda usando BMAD-METHOD. Depois vai medir 15 coisas em cada construção — tempo, custo, qualidade do código, aderência ao plano, e assim por diante — e comparar.

Para essa comparação valer alguma coisa, tudo o que **não** é a metodologia precisa ser idêntico nas duas construções. Mesmo protótipo visual, mesma linguagem, mesma arquitetura, mesmo ambiente. E, principalmente, **mesmo backend**.

Por isso o backend é construído **antes**, uma única vez, e depois congelado. Congelado significa: nenhuma linha muda enquanto os dois ciclos rodam.

### 1.2 A pergunta que guiou cada decisão

Toda escolha deste plano foi tomada respondendo a uma pergunta só:

> Se os dois ciclos derem resultados diferentes, essa diferença pode ter vindo do backend?

Sempre que a resposta foi "pode", a decisão mudou — mesmo quando isso significou mais trabalho.

Um exemplo concreto. O Supabase oferece um recurso chamado PostgREST que expõe o banco de dados diretamente como API, sem escrever quase nada. Seria muito mais rápido usá-lo. Mas o PostgREST tem um formato próprio de mensagem de erro, diferente do que o resto da aplicação usa. Isso significaria que alguns erros chegam num formato e outros em outro — e aí, se um ciclo tratasse erros melhor que o outro, você não saberia se foi a metodologia ou a inconsistência do backend. Então a decisão foi **escrever todos os endpoints à mão**, com um formato de erro único.

É mais trabalho. É pior como engenharia de produto. É melhor como engenharia de experimento. Esse trade-off vale para várias decisões adiante e merece um parágrafo na monografia.

### 1.3 O maior risco do projeto

O aplicativo usa inteligência artificial em vários pontos: o chat, a leitura de texto em fotos, os insights, o resumo da exportação, o balanço do dashboard.

Modelos de IA **não são determinísticos**. Faça a mesma pergunta duas vezes e você recebe respostas parecidas, mas não iguais.

Isso é um problema fatal para o experimento. Se no ciclo A a IA respondeu de um jeito e no ciclo B respondeu de outro, qualquer diferença medida naquelas telas está contaminada. E com apenas uma construção por metodologia, não existe tratamento estatístico que resolva.

A solução está na Seção 6 e se chama **cache de replay**. É a contribuição mais original deste trabalho.

---

## 2. Vocabulário mínimo

Se algum destes termos for novo, leia antes de seguir. Eles aparecem o tempo todo.

**Supabase** — plataforma que junta banco de dados, autenticação, armazenamento de arquivos e execução de código num serviço só. Evita montar e manter servidor.

**Postgres** — o banco de dados que roda por baixo do Supabase. Guarda os dados em tabelas, como planilhas relacionadas entre si.

**Edge Function** — um pedacinho de código que roda no servidor quando alguém chama um endereço específico. Cada endpoint deste backend é uma Edge Function. Escritas em TypeScript.

**Endpoint** — um endereço da API que o aplicativo chama para fazer alguma coisa. Por exemplo, `POST /entries` é o endereço que o app chama para criar uma nova entrada no diário.

**Contrato** — a definição exata do que um endpoint recebe e do que devolve. É o combinado. Se o contrato diz que o endpoint devolve um campo chamado `content`, ele sempre devolve esse campo com esse nome.

**RLS (Row Level Security)** — regra do Postgres que garante que cada usuário só enxerga as próprias linhas nas tabelas. Sem RLS, um usuário poderia ler o diário de outro. É segurança aplicada no banco, não no código — o que é mais confiável, porque não depende de ninguém lembrar de filtrar.

**Migração** — arquivo que descreve uma mudança no banco de dados (criar tabela, adicionar coluna). Ficam numerados e são aplicados em ordem, o que permite recriar o banco do zero de forma idêntica em qualquer lugar. É assim que garantimos que os três ambientes são iguais.

**Seed** — dados de teste carregados no banco depois das migrações. Contas fictícias com entradas de diário, para poder testar sem digitar tudo à mão.

**Embedding** — representação numérica de um texto, uma lista de 1024 números. Textos com significado parecido geram listas de números parecidas. É isso que permite buscar "ansiedade" e encontrar um texto que só fala em "nervosismo". Quem gera é a Voyage AI.

**RAG (Retrieval-Augmented Generation)** — técnica em que, antes de perguntar algo à IA, o sistema busca no banco os textos mais relacionados e os envia junto com a pergunta. É o que dá "memória" ao chat.

**SSE (Server-Sent Events)** — forma de o servidor enviar a resposta aos pedaços, em vez de tudo de uma vez. É o que faz o texto da IA aparecer palavra por palavra na tela.

**Idempotência** — propriedade de uma operação que, repetida, não causa efeito adicional. Salvar a mesma mensagem duas vezes precisa resultar em **uma** entrada, não duas.

**Cache de replay** — nosso mecanismo de guardar as respostas da IA para reutilizá-las depois, garantindo que os dois ciclos recebam exatamente as mesmas respostas. Detalhado na Seção 6.

**Injeção de falha** — mecanismo para forçar um endpoint a falhar de propósito, de forma controlada, para testar como o app reage a erros.

**pgTAP** — ferramenta que testa o banco de dados. Usamos para provar que as regras de RLS funcionam.

**Hurl / Bruno** — ferramentas que testam endpoints. Chamam o endereço, conferem se a resposta bate com o contrato.

**CI (Integração Contínua)** — automação que roda todos os testes sozinha a cada alteração no código. Usamos GitHub Actions.

**ADR (Architecture Decision Record)** — registro curto de uma decisão de arquitetura: o contexto, a decisão e a consequência. Serve para ninguém rediscutir a mesma coisa depois. Neste projeto são numeradas de D1 a D18.

---

## 3. As decisões travadas

São 18 decisões. Todas foram tomadas e **não devem ser reabertas** durante o desenvolvimento. Se alguma parecer errada no meio do caminho, isso é assunto para a monografia, não para uma mudança de rota.

Cada decisão abaixo tem o mesmo formato: o problema, a decisão e o que isso significa na prática.

---

### D1 — Autenticação usa o que o Supabase já oferece

**Problema.** O inventário original previa seis endpoints de autenticação escritos por nós. Cinco deles já existem prontos no Supabase. E o sexto, um endpoint de "desbloqueio por biometria", é impossível de implementar: a impressão digital nunca sai do dispositivo — o celular só devolve um sim ou não local, e não há nada que o servidor possa verificar.

**Decisão.** Usar o sistema de autenticação nativo do Supabase (chamado GoTrue). Escrever apenas um endpoint próprio, `GET /auth/session`, que devolve os dados da sessão mais um número de versão usado pela timeline. **O endpoint de biometria não existe.**

**Na prática.** Quando o usuário desbloqueia o app com a digital ou o PIN, o aplicativo pega o token guardado localmente no cofre do celular e chama `POST /auth/refresh`. O servidor nem fica sabendo que houve biometria. Todo o RF03 vira responsabilidade do aplicativo — o que é bom para o experimento, porque é justamente onde as duas metodologias podem divergir.

---

### D2 — Todos os endpoints são escritos à mão

**Problema.** Explicado na Seção 1.2: o atalho do PostgREST criaria dois formatos de erro diferentes na mesma API.

**Decisão.** Todos os 23 endpoints são Edge Functions escritas por nós, passando por um mesmo ponto de entrada que padroniza erros. O acesso direto ao banco pelo aplicativo fica desabilitado.

**Na prática.** Mais trabalho de implementação, em troca de três garantias: formato de erro idêntico em toda a API, um único lugar para instalar o cache de replay, e um único lugar para instalar a injeção de falha. Também elimina o risco de um ciclo descobrir um caminho alternativo de acesso que o outro não descobriu.

---

### D3 — Dados sensíveis são detectados, nunca apagados

**Problema.** O requisito RNF02 fala em "PII stripping" — remover informações pessoais identificáveis (nomes, endereços, telefones). Mas o produto é um diário pessoal. Apagar os nomes que a pessoa escreveu destrói exatamente aquilo que ela quis guardar.

**Decisão.** O sistema **detecta e anota**, nunca remove. O texto original fica intacto no banco. Ao lado dele, guardamos uma anotação dizendo "da posição 15 à 22 há um nome de pessoa". A detecção é feita pelo Claude Haiku usando saída estruturada — ou seja, o modelo é obrigado a responder num formato fixo, não em texto livre, o que garante que a resposta seja sempre processável.

**Na prática.** O código de erro `PII_CHECK_FAILED` significa que **a verificação falhou**, não que encontrou algo. Encontrar informação pessoal é normal e não bloqueia nada.

---

### D4 — Salvar duas vezes cria uma entrada só

**Problema.** O RF10 exige que salvar a mesma mensagem do chat duas vezes não crie duplicata. Nada no banco garantia isso.

**Decisão.** Criar um índice único parcial sobre a combinação de usuário e identificador da mensagem do chat, valendo apenas quando esse identificador não for nulo. Se o app tentar salvar de novo, o banco recusa a duplicata e o endpoint devolve **sucesso com a entrada que já existia**, marcando que foi uma repetição.

**Na prática.** Duas coisas importantes. Primeira: quem garante a idempotência é o **banco**, não o código — então os dois ciclos herdam o mesmo comportamento sem poder implementá-lo de formas diferentes. Segunda: a resposta é sucesso (200), não erro (409). O aplicativo não precisa tratar caso especial nenhum, o que torna o critério de aceite testável de forma idêntica nos dois ciclos.

---

### D5 — A montagem do prompt acontece no servidor

**Problema.** Este é o mais sutil e o mais importante de todos.

O cache de replay funciona guardando respostas da IA identificadas por uma "impressão digital" do que foi enviado. Se o mesmo texto for enviado de novo, devolvemos a resposta guardada em vez de chamar a IA.

Mas isso só funciona se os dois ciclos enviarem **exatamente o mesmo texto**. E se o aplicativo fosse responsável por montar o que se envia à IA — o histórico da conversa, o contexto recuperado do RAG, as instruções de sistema — o Spec Kit montaria de um jeito e o BMAD de outro. Janela de 10 mensagens contra 20, ordem diferente do contexto, formatação diferente. Impressões digitais diferentes. **Cache com acerto próximo de zero, exatamente nos endpoints que ele existe para proteger.**

**Decisão.** O aplicativo envia **apenas o texto que o usuário digitou**. Todo o resto — buscar o histórico no banco, executar o RAG, escolher a persona, montar as instruções — acontece no servidor.

**Na prática.** Isso reduz a superfície do aplicativo. Alguém poderia argumentar que estamos tirando dos ciclos uma área onde eles poderiam divergir. Mas essa divergência específica seria ruído, não sinal: não diz nada sobre a qualidade da metodologia e destrói a comparação de tudo o mais.

---

### D6 — Falhas de rede podem ser forçadas de propósito

**Problema.** O RNF09 exige testar 15 cenários de erro de rede. Testar isso desligando o Wi-Fi na hora certa não é reproduzível.

**Decisão.** Qualquer endpoint aceita um cabeçalho especial de teste que o força a falhar de um jeito escolhido: demorar até estourar o tempo limite, devolver uma resposta corrompida, cortar a conexão, falhar só a parte de IA, demorar um tempo determinado, ou simular limite de requisições. O cabeçalho só funciona se vier acompanhado de uma chave secreta; sem ela, é **ignorado em silêncio** — nunca rejeitado com erro, para que a existência do mecanismo não seja detectável em produção. Toda falha injetada fica registrada numa tabela.

**Na prática — atenção, este ponto costuma confundir.** A **métrica** dos 15 cenários vem dos testes automatizados do aplicativo, usando a biblioteca `mocktail` para simular as falhas. A injeção de falha no backend tem outra função: **provar que as simulações do teste correspondem ao comportamento real do servidor**. Os dois instrumentos coexistem, mas só o primeiro é a métrica. Na monografia isso vira uma frase forte: "os mocks foram validados contra o backend real".

**Os cinco endpoints de escrita** que compõem os 15 cenários (5 × 3) estão congelados: criar entrada, enviar mensagem no chat, processar OCR, solicitar exportação e gerar insight.

---

### D7 — Isolamento entre usuários é garantido pelo banco

**Problema.** Cada usuário só pode ver os próprios dados. Se isso for garantido apenas por filtros no código, basta alguém esquecer um filtro para vazar dados.

**Decisão.** Todas as tabelas que têm dono ativam RLS **e forçam** RLS. A diferença importa: ativar sem forçar deixa o dono da tabela contornar a regra. A política é sempre a mesma: o usuário autenticado precisa coincidir com o dono da linha. O papel administrativo do banco só é usado dentro dos processos de fila, nunca num endpoint que atende requisição do aplicativo.

**Na prática.** Pedir um recurso de outro usuário devolve **"não encontrado"**, não "proibido". Isso é deliberado: dizer "proibido" já revelaria que o recurso existe. Esse detalhe precisa estar no pacote entregue aos dois ciclos, senão um deles trata um erro que nunca vai chegar.

---

### D8 — O modelo de embedding é o `voyage-4`, com 1024 dimensões

**Problema.** O documento original deixava em aberto entre duas versões. Ambiguidade aqui é fatal: modelos diferentes geram listas de tamanhos diferentes, o que muda a estrutura da tabela e torna os resultados de busca incomparáveis entre os ciclos.

**Decisão.** `voyage-4`, 1024 dimensões, com o tipo de entrada marcado como "documento" na hora de salvar e "consulta" na hora de buscar. Cada linha guarda qual modelo e qual dimensão foram usados, para que uma troca acidental seja detectável em vez de silenciosa.

**Verificação — feita em 31/08/2026.** Uma chamada real à API confirmou que o `voyage-4` aceita 1024 dimensões e devolve exatamente 1024 números. A versão anterior deste plano fixava o `voyage-3.5`, mas a Voyage lançou a série 4 e passou a tratar a 3.5 como legada, recomendando migração. Trocar agora custou duas linhas; trocar depois da migração do banco custaria refazer todos os embeddings e o cache inteiro. E o pior cenário possível seria o modelo ser descontinuado no meio dos ciclos.

---

### D9 — O status de sincronização sai do servidor

**Problema.** A tabela de entradas tinha uma coluna chamada `sync_status`. Mas a arquitetura é "só nuvem": não existe escrita offline. Se a linha existe no servidor, ela está sincronizada por definição. A coluna não tinha o que representar.

**Decisão.** Coluna removida. O servidor passa a expor uma data de última atualização por entrada e um número de versão por usuário, que sobe a cada escrita. O selo que aparece na timeline muda de significado: passa a ser **"esta entrada já foi confirmada pelo servidor"**, calculado pelo próprio aplicativo.

**Na prática.** O selo tem três estados, todos derivados no aplicativo: *sincronizando* (requisição em andamento), *erro de sync* (a última tentativa falhou e há reenvio pendente na fila local) e *sincronizado* (confirmada pelo servidor). Essa definição vai literalmente no pacote entregue aos dois ciclos, para que nenhum invente uma semântica própria.

---

### D10 — Insights disparam uma vez só, garantido pelo banco

**Problema.** O RF08 exige que o insight dispare "exatamente uma vez por condição satisfeita". Nada registrava que um insight já tinha sido disparado.

**Decisão.** Nova tabela de insights, com uma regra de unicidade sobre a combinação de sessão, tipo de gatilho e chave do gatilho. A chave é calculada de forma previsível: para o gatilho de contagem, é o número do bloco de cinco mensagens; para o gatilho de inatividade, é o identificador da última mensagem do usuário.

**Na prática.** O aplicativo decide **quando** disparar — isso é comportamento, e é onde as metodologias podem divergir, o que é dado do experimento. O banco garante que **dispara uma vez só** — isso é integridade, e precisa ser idêntico. Se as duas condições coincidirem, a segunda tentativa esbarra na regra e recebe o insight que já existe, sem duplicar.

---

### D11 — A exportação tem dois estados independentes

**Problema.** O RF05 exige que uma falha na geração do texto pela IA **não** impeça o download dos dados brutos. Com um único campo de status, isso é impossível de representar: o job estaria "com erro" e não daria para baixar nada.

**Decisão.** Dois campos separados: o status geral do job e o status específico da narrativa. O download libera assim que os dados estiverem prontos, sem esperar a narrativa.

**Na prática.** O protótipo confirmou exatamente este desenho. Ele tem quatro estados de exportação, e o que ele chama de "erro" não é falha total — é dados prontos com narrativa falhada, oferecendo apenas o arquivo bruto. O mapeamento completo está na Seção 4.

---

### D12 — O formato do streaming do chat é fixo

**Problema.** O RF04 exige que, se a conexão cair no meio da resposta, o texto parcial continue visível com indicação de falha. Para o aplicativo conseguir guardar esse texto parcial, ele precisa de um identificador — e se o identificador só chegasse no final, não haveria onde ancorar o pedaço recebido.

**Decisão.** A sequência de eventos do streaming é fixa e sempre a mesma: primeiro um evento anunciando que a mensagem foi criada (com o identificador), depois um evento com a lista de entradas recuperadas pelo RAG, depois os pedaços de texto, e por fim um evento de conclusão ou de erro.

**Na prática.** O evento com as entradas recuperadas **não vai para a tela** — o protótipo não mostra citação de fontes no chat. Ele existe para auditoria: é a prova de que o RAG recuperou o mesmo contexto nos dois ciclos. Custa nada manter e vale como evidência.

---

### D13 — Tarefas demoradas rodam dentro do próprio banco

**Problema.** A exportação é demorada demais para responder na hora. Precisa virar uma tarefa em fila.

**Decisão.** Usar duas extensões do Postgres: uma para a fila e outra para o agendamento. Nada fora do Supabase.

**Na prática.** Zero infraestrutura adicional para configurar, e portanto zero variabilidade de ambiente entre os ciclos. A tarefa demora um pouco mais para começar (depende do intervalo do agendador), o que é irrelevante aqui.

---

### D14 — Três ambientes separados

**Problema.** Se os dois ciclos usassem o mesmo banco, o ciclo A deixaria dados que mudariam o comportamento do ciclo B: a busca retornaria coisas diferentes, o dashboard somaria números diferentes, o RAG recuperaria outro contexto. Todas as métricas ficariam contaminadas.

**Decisão.** Três projetos Supabase: um para construir o backend, um para o ciclo A e um para o ciclo B. Os dois de ciclo são criados pelas **mesmas migrações e o mesmo seed**, com conferência de que a estrutura ficou idêntica.

**Na prática.** Atenção a um detalhe operacional: projetos gratuitos do Supabase **pausam por inatividade**. Como o ambiente do ciclo B vai ficar semanas parado esperando o ciclo A terminar, ele pode pausar. Ao reativá-lo, é obrigatório reconferir a estrutura antes de liberar — está no checklist.

---

### D15 — Existe um endpoint para regenerar resposta da IA

**Problema.** O protótipo mostra "toque para tentar novamente" numa resposta da IA que falhou. Mas o endpoint de enviar mensagem **cria uma nova mensagem do usuário** — chamá-lo de novo duplicaria a pergunta na conversa.

**Decisão.** Um endpoint dedicado de retry, que recebe o identificador da mensagem do usuário e regenera a resposta.

**Na prática.** Tem uma propriedade elegante: como o histórico e a pergunta são os mesmos, a impressão digital do cache é idêntica à da primeira tentativa. **O retry acerta o cache, não gasta token nenhum e é perfeitamente determinístico.** Sem esse endpoint, cada ciclo inventaria uma solução diferente para o mesmo estado de tela.

---

### D16 — Política de defeito depois do congelamento

**Problema.** E se aparecer um bug no backend depois que ele estiver congelado e um dos ciclos já tiver começado?

A intuição diz: "o backend é um só, corrige uma vez e resolve nos dois". **Isso está errado**, por quatro motivos.

Primeiro, os ciclos são **sequenciais**. Se o ciclo A rodou contra a versão 1.0 e a correção sai depois, o ciclo B roda contra a 1.1. Os dois apps foram *construídos* contra backends diferentes, mesmo que o artefato final seja um só — e o que se mede é a construção.

Segundo, são três ambientes separados: a correção precisa ser aplicada mais de uma vez, com reconferência de estrutura.

Terceiro, se a correção tocar a montagem de prompt ou a ordenação de resultados, as impressões digitais do cache mudam e o ciclo B recebe respostas de IA que o ciclo A nunca viu.

Quarto, e mais importante: quem construiu o ciclo A já gastou horas escrevendo um contorno para o bug. Essas horas contam em quatro das seis métricas de processo. A correção posterior não devolve essas horas ao ciclo A nem as cobra do ciclo B.

**Decisão.**

| Gravidade | O que é | O que fazer |
|---|---|---|
| **Não bloqueante** | Existe contorno razoável; nenhum critério de aceite fica impossível | **Não corrigir.** Registrar num arquivo de defeitos conhecidos, entregue igual aos dois ciclos. Um backend com o mesmo defeito nos dois lados continua sendo um backend idêntico. |
| **Bloqueante** | Algum critério de aceite se torna impossível de cumprir | Corrigir nos três ambientes, reexecutar o roteiro, repopular o cache, registrar em "Ameaças à Validade". Se o ciclo A já terminou, registrar que ele não teve a correção. |
| **Bloqueante descoberto durante o ciclo B** | Pior caso | Corrigir, terminar o ciclo, e **declarar aquela métrica como não comparável**. Não maquiar. |

**O corolário incômodo:** descobrir defeitos cedo vale mais do que corrigi-los bem. É por isso que o teste de determinismo (Seção 7) roda **antes** do ciclo A começar, não depois.

---

### D17 — Nenhuma imagem é armazenada

**Problema.** O protótipo oferecia, no erro de OCR, a opção "salvar só a foto". Mas a arquitetura estabelece que a imagem nunca é persistida. As duas coisas não podem coexistir.

**Decisão.** A opção foi **removida do protótipo**. Não existe armazenamento de imagem em lugar nenhum: nem no Storage, nem no banco, nem no registro do cache (que guarda apenas uma impressão digital da imagem, jamais a imagem).

**Na prática.** Evitou criar um bucket de arquivos, uma política de segurança para ele, uma coluna de referência e uma rotina de limpeza no apagamento de conta — cerca de um dia de trabalho que não geraria nenhum dado comparativo novo.

---

### D18 — Ordem dos ciclos

**Decisão.** O **GitHub Spec Kit** roda primeiro, por ser a metodologia mais familiar ao pesquisador.

**Raciocínio.** O efeito de aprendizado favorece o segundo ciclo (você já construiu o app uma vez, sabe onde ficam as armadilhas). A familiaridade prévia favorece o primeiro. Colocar a metodologia familiar em primeiro faz os dois vieses agirem em direções opostas.

**Isso atenua, não elimina.** A monografia precisa dizer exatamente assim. Prometer neutralização seria mais bonito e menos defensável.

---

## 4. O banco de dados

Oito tabelas. Abaixo, o que cada uma guarda e por quê. As migrações que criam essa estrutura serão escritas no Claude Code a partir desta especificação.

### Convenções gerais

- Todo identificador é um UUID gerado pelo banco.
- Toda data e hora é gravada em UTC.
- Toda tabela que tem dono ativa **e força** RLS (D7).
- As migrações são numeradas e aplicadas na mesma ordem nos três ambientes.

### 4.1 `profiles` — os usuários

Espelha a tabela de autenticação do Supabase, sem substituí-la.

| Campo | O que guarda |
|---|---|
| identificador | Mesmo do sistema de autenticação |
| e-mail | Espelhado; **somente leitura**, não editável pela API |
| nome de exibição | Editável pelo usuário |
| biometria habilitada | Preferência do usuário. O servidor **não valida** biometria (D1) |
| persona | Analítico, empático ou socrático. Entra na impressão digital do cache (D5) |
| versão do servidor | Número que sobe a cada escrita nas entradas daquele usuário. É o insumo do selo do RF07 (D9) |
| datas de criação e atualização | — |

### 4.2 `entries` — as entradas do diário

A tabela central do sistema.

| Campo | O que guarda |
|---|---|
| identificador, dono | — |
| conteúdo | O **texto original íntegro**, nunca censurado (D3) |
| origem | Manual, áudio, foto ou chat |
| identificador da mensagem do chat | Preenchido apenas quando a origem é chat. É a base da idempotência |
| data do acontecimento | A data que a entrada representa, que pode diferir da data de criação |
| embedding | A lista de 1024 números que permite a busca semântica |
| modelo, dimensão e tipo do embedding | Versionamento — permite detectar troca acidental de modelo (D8) |
| status do embedding | Pendente, pronto ou falhou |
| status da verificação de PII | Pendente, limpo, sinalizado ou falhou |
| anotações de PII | Onde há informação sensível no texto. **Anotação, nunca remoção** (D3) |
| duração da mídia em segundos | Só para entradas de áudio. A tela mostra "áudio original · 42s" |
| datas | — |

**Índices.** Um para ordenar a timeline por data. E o índice único parcial que garante a idempotência do RF10 (D4).

**Deliberadamente sem índice vetorial.** Existem índices especiais para busca vetorial (HNSW, IVFFlat) que aceleram a busca em bases grandes. Eles fazem busca **aproximada** — podem devolver resultados ligeiramente diferentes entre execuções. Com o volume deste projeto (dezenas de entradas), a varredura completa é mais rápida e, principalmente, **100% determinística**. Usar índice aproximado aqui introduziria variação sem nenhum ganho.

### 4.3 `tags` e `entry_tags` — as etiquetas

Tabelas mantidas, mas **populadas apenas pelo seed**. Nenhum endpoint escreve nelas. As etiquetas aparecem nos cartões da timeline, vindas dos dados de teste.

Motivo: etiquetas criadas pelo usuário não geram dado comparativo entre as metodologias e custariam três endpoints implementados nos dois ciclos.

### 4.4 `chat_sessions` — as conversas

| Campo | O que guarda |
|---|---|
| identificador, dono, título, datas | O título é gerado **no servidor** a partir da primeira mensagem — gerado no cliente, variaria entre os ciclos e quebraria o cache |
| persona congelada | A persona no momento em que a conversa começou. Congelar isso mantém a impressão digital do cache estável mesmo se o usuário trocar a persona depois |
| contagem de mensagens do usuário | Insumo do gatilho de 5 mensagens do RF08 |
| data da última mensagem do usuário | Insumo do gatilho de 2 minutos de inatividade |

### 4.5 `chat_messages` — as mensagens

| Campo | O que guarda |
|---|---|
| identificador, sessão, dono, conteúdo, data | O dono aparece repetido aqui de propósito, para a regra de RLS funcionar sem precisar consultar outra tabela |
| papel | Usuário ou assistente |
| sequência | Ordem estável dentro da conversa |
| status | Em streaming, completa ou falhada. É o que sustenta o critério "a mensagem parcial permanece visível" do RF04 |
| contagem de retries | Quantas vezes a resposta precisou ser regenerada. Vira dado auditável: quantas falhas de IA por ciclo |

### 4.6 `insights` — os insights proativos

| Campo | O que guarda |
|---|---|
| identificador, sessão, dono, data | — |
| tipo de gatilho | Contagem de mensagens ou inatividade |
| chave do gatilho | Valor previsível que identifica *qual* disparo é este |
| status | Gerando, pronto, falhou ou descartado |
| conteúdo | Vazio se falhou — e falhar **não** bloqueia o chat (RF08) |
| código de erro | Quando aplicável |

**A regra de unicidade sobre sessão + tipo + chave é o coração desta tabela.** É ela que transforma "dispara exatamente uma vez" de observação manual em teste automatizado.

### 4.7 `export_jobs` — as exportações

| Campo | O que guarda |
|---|---|
| identificador, dono, período, datas | O período pode ter início e fim nulos, significando "todo o período" |
| status do job | Pendente, processando, dados prontos, concluído ou erro |
| **status da narrativa** | Pendente, processando, concluída, falhou ou pulada — **independente do anterior** (D11) |
| contagem de entradas | Se for zero, o pedido nem vira job |
| caminho do arquivo bruto | Os dados em formato aberto |
| caminho do PDF | Vazio se a narrativa falhou |
| dois códigos de erro | Um para o job, outro para a narrativa |

**O mapeamento que vai para os dois ciclos:**

| O que a tela mostra | Status do job | Status da narrativa | Download disponível |
|---|---|---|---|
| Preparando exportação | pendente | pendente | não |
| Gerando resumo com IA | processando | processando | não |
| Resumo pronto | concluído | concluída | sim — PDF e bruto |
| Narrativa falhou | dados prontos | falhou | sim — só o bruto |
| Período vazio | *(não existe job)* | — | erro imediato |

Entregar esta tabela pronta aos dois ciclos evita que cada um combine os dois campos do seu próprio jeito.

### 4.8 `ai_replay_cache` — o cache de respostas de IA

Tabela de infraestrutura do experimento, não de produto. Guarda a impressão digital do que foi enviado, a resposta recebida, e um contador de quantas vezes foi reaproveitada. Vive num espaço separado do banco, inacessível pelas regras normais de usuário.

O contador de reaproveitamentos é **métrica de saúde do experimento**: permite reportar a taxa de acerto do cache por operação e por ciclo na monografia.

### 4.9 `fault_injection_log` — o registro de falhas forçadas

Guarda cada falha injetada: qual endpoint, qual tipo, quando. Serve para que a evidência dos 15 cenários seja auditável em vez de depender de anotação manual.

### 4.10 O que deliberadamente **não** existe

- **Tabela de cache do dashboard.** O RF09 pede um teste de invalidação de cache, mas criar cache no servidor colocaria um componente com bug próprio dentro do instrumento de medição. Em vez disso, o endpoint calcula sempre e devolve um marcador de versão. O cache — e portanto a invalidação testada — fica no aplicativo, que é onde os dois ciclos divergem e onde a métrica tem valor comparativo.
- **Tabela de dispositivos ou sessões biométricas** (D1).
- **Armazenamento de imagens ou áudios** (D17). O áudio nunca chega ao backend; a imagem é processada e descartada.

---

## 5. Os 23 endpoints

Todos passam pelo mesmo ponto de entrada, que padroniza três coisas: o formato de sucesso, o formato de erro e os cabeçalhos.

**Formato de erro, igual em toda a API:** um código da taxonomia, uma mensagem legível, um indicador de se vale a pena tentar de novo, e o identificador da requisição.

**Formato de sucesso:** sempre um objeto com os dados dentro, nunca uma lista solta no topo — listas soltas levam parsers a divergir entre implementações.

### 5.1 Autenticação — 5 endpoints

| Endpoint | O que faz |
|---|---|
| Cadastro | Cria conta. Nativo do Supabase |
| Login | Autentica. Nativo do Supabase |
| Renovar sessão | Renova o token. É o que a biometria local dispara |
| Consultar sessão | Devolve os dados do usuário e a versão do servidor. Único escrito por nós |
| Logout | Encerra a sessão |

Não existe endpoint de biometria nem de PIN (D1).

### 5.2 Entradas — 5 endpoints

**Criar entrada** é o endpoint mais crítico do sistema. Recebe o texto, a origem e, quando vem do chat, o identificador da mensagem. A ordem interna é: validar, verificar PII, gravar, e só então gerar o embedding.

Essa ordem tem uma consequência importante: **se a geração do embedding falhar, a entrada já existe**. Ela fica marcada como "embedding falhou" e o usuário não perde o que escreveu. O erro de embedding aparece na consulta da entrada, não na criação. A alternativa — falhar tudo — perderia dado do usuário por indisponibilidade de um serviço terceiro, o que é inaceitável num diário.

| Endpoint | O que faz |
|---|---|
| Criar entrada | Descrito acima. Idempotente quando vem do chat (D4) |
| Listar entradas | Com paginação e filtros. **Devolve as etiquetas embutidas** — o cartão da timeline mostra etiquetas, e buscá-las separadamente faria cada ciclo resolver o problema de N+1 requisições do seu jeito |
| Consultar entrada | Uma entrada específica |
| Buscar entradas | Busca semântica combinada com filtros. Filtros combinam com **E**, nunca com OU |
| Processar OCR | Recebe a imagem, devolve o texto. **A imagem não é guardada** (D17) |

Não existem endpoints de editar nem apagar entrada, nem endpoints de etiqueta.

**Sobre a busca:** o atraso de 300ms entre teclas é responsabilidade do aplicativo. O servidor **não** limita a frequência — se limitasse, mascararia a diferença entre os dois ciclos, que é justamente o que se quer medir.

### 5.3 Chat — 6 endpoints

| Endpoint | O que faz |
|---|---|
| Criar conversa | Chamado ao enviar a primeira mensagem de uma conversa nova. Desde 10/09/2026 também acionado pelo botão "Novo Chat" no menu lateral (que abre a Home vazia, disparando o mesmo endpoint na 1ª mensagem seguinte) — ver `Contexto Geral.md` Seção 2.1 |
| Listar conversas | Para o menu lateral |
| Listar mensagens | De uma conversa |
| Enviar mensagem | Responde em streaming, no formato fixo da D12 |
| Regenerar resposta | O retry da D15. Reaproveita o cache, custo zero |
| Gerar insight | O aplicativo decide quando; o banco garante que é uma vez só (D10) |

**Sobre o insight:** se a geração falhar, a resposta é **sucesso (200)** com o status marcado como falhado. Nunca um erro HTTP. O chat não pode receber um erro que o faça quebrar — é o critério de aceite do RF08.

### 5.4 Exportação — 3 endpoints

| Endpoint | O que faz |
|---|---|
| Solicitar exportação | Recebe o período (do filtro ativo na tela de registros). Se não houver entradas, devolve erro **imediato**, sem criar job |
| Consultar status | Devolve os dois status e um campo já resolvido dizendo se o download está disponível — para o aplicativo não precisar combinar os dois campos |
| Baixar | Redireciona para o arquivo. Responde com sucesso sempre que houver dados, escolhendo o PDF se existir e o arquivo bruto se não |

**A contagem de entradas é feita na hora**, não dentro do job. Assim o erro de período vazio é imediato, e não um job que falha vinte segundos depois — muito mais fácil de testar de forma idêntica nos dois ciclos.

### 5.5 Dashboard — 2 endpoints

| Endpoint | O que faz |
|---|---|
| Agregado | Os números do gráfico. **Sempre sucesso**, mesmo com zero entradas (devolve lista vazia) |
| Narrativa | O texto de balanço, gerado por IA. **Independente do agregado** |

**Assimetria intencional:** zero entradas **não é erro** no dashboard, mas **é erro** na exportação. Isso precisa estar explícito para os dois ciclos, senão um deles "corrige a incoerência" e diverge do outro.

### 5.6 Conta — 2 endpoints

| Endpoint | O que faz |
|---|---|
| Atualizar configurações | Aceita nome de exibição, persona e preferência de biometria. **E-mail é rejeitado** |
| Apagar conta | Apagamento definitivo, em cascata, sem deixar nada órfão (LGPD) |

### 5.7 Taxonomia de erro — 13 códigos, fechada

Os dez originais mais três acrescentados nesta revisão: período de exportação vazio, imagem grande demais, e OCR sem texto encontrado.

O código de limite de requisições permanece na lista, mas **nenhum limite real é aplicado** — com três contas de teste, um limite verdadeiro só produziria falso positivo. Ele existe como contrato que os dois ciclos precisam tratar, e é exercitado pela injeção de falha.

**Esta lista está fechada.** Qualquer código acrescentado depois do congelamento invalida a comparação do RNF09 no ciclo que rodou primeiro, porque aquele app terá sido construído contra um contrato menor.

### 5.8 A documentação da API

Os contratos são definidos uma única vez, em arquivos de validação, e a documentação formal da API é **gerada** a partir deles. O sistema de CI compara o arquivo gerado com o que está versionado e **falha se houver diferença**. O contrato não pode mudar sem revisão — ele é o insumo de entrada dos dois ciclos.

---

## 6. Reprodutibilidade

Esta seção decide se o TCC produz um resultado defensável.

### 6.1 O cache de replay, explicado do começo

Funciona em três passos.

**Passo 1 — a impressão digital.** Antes de chamar a IA, o servidor monta um pacote com tudo o que define aquela chamada: qual operação, qual modelo, qual persona, qual histórico, qual texto. Desse pacote ele calcula uma impressão digital — um código de tamanho fixo que muda completamente se qualquer detalhe mudar.

**Passo 2 — consultar.** O servidor procura essa impressão digital na tabela de cache. Se encontrar, devolve a resposta guardada, sem chamar a IA.

**Passo 3 — guardar.** Se não encontrar, chama a IA de verdade e guarda a resposta associada àquela impressão digital.

### 6.2 Os quatro modos

O comportamento é controlado por uma configuração de ambiente:

| Modo | O que faz | Quando é usado |
|---|---|---|
| Desligado | Sempre chama a IA, não guarda nada | Durante a construção do backend |
| Gravação | Chama a IA e guarda tudo | Na execução única que popula o cache |
| Reprodução | Usa o cache; se não achar, chama a IA e guarda | **Durante a construção dos dois apps** |
| Reprodução estrita | Usa o cache; se não achar, **devolve erro e registra** | **Na execução final de cada ciclo** — é a que gera as métricas |

O modo de reprodução simples durante a construção tem um efeito colateral interessante e não planejado: **a taxa de "não encontrado" durante o desenvolvimento indica quanto cada metodologia explorou fora do roteiro previsto**. Vale coletar — pode virar um dado que nenhuma das 15 métricas originais captura.

### 6.3 A armadilha que quase passou despercebida

O cache só produz determinismo se os dois ciclos gerarem exatamente o mesmo pacote de entrada. Isso tem duas consequências.

**A primeira já virou decisão:** a montagem do prompt vive no servidor (D5). Sem isso, os dois apps montariam pacotes diferentes e o cache erraria quase sempre.

**A segunda exige um artefato que não estava previsto em nenhuma versão anterior do plano.** Mesmo com o prompt no servidor, o pacote só é idêntico se a **sequência de ações** for idêntica. Se no ciclo A você digitou "oi, tudo bem?" e no ciclo B digitou "olá, como vai?", são pacotes diferentes.

Por isso existe o **roteiro de validação**: um script literal, passo a passo, das interações a executar de forma idêntica ao final de cada ciclo. Textos exatos a digitar, imagens exatas a enviar, ordem exata das telas.

**Sem esse roteiro, o cache é decorativo.** Ele é o artefato que popula o cache no modo de gravação e é o mesmo que valida os dois apps. Está no checklist de congelamento.

### 6.4 Não-determinismo que não é a IA

Três fontes de variação que não vêm do modelo e passariam despercebidas:

**Busca vetorial aproximada.** Já tratada: não usamos índice vetorial (Seção 4.2).

**Ordenação incompleta.** Se uma consulta ordena por data e duas linhas têm a mesma data, o banco decide a ordem por conta própria — e pode decidir diferente entre execuções. Regra: **toda ordenação termina com um critério de desempate pelo identificador**. Verificado por revisão na Fase 2.

**Relógio.** Endpoints que dependem de "agora" — o período de 7 dias, o gatilho de inatividade — dão resultados diferentes conforme o dia da execução. Solução: um cabeçalho de teste que fixa o "agora", protegido pela mesma chave secreta da injeção de falha. E o seed usa datas **relativas a uma âncora fixa**, nunca datas absolutas.

Esses três pontos merecem menção na seção de Ameaças à Validade — mostram controle metodológico, não só de engenharia.

### 6.5 Custo

Com o cache, o custo total de IA do backend fica abaixo de vinte dólares para todo o projeto: uma execução de gravação e depois reproduções gratuitas. **Sem o cache, cada rodada de teste custaria de novo.** O cache é, além de instrumento metodológico, o controle de custo.

Ainda assim, configure teto de gasto nas duas APIs antes de começar. Um erro de laço infinito num endpoint de IA durante o desenvolvimento pode queimar crédito rápido — e crédito estourado no meio de um ciclo contamina o cronograma, não só o bolso.

---

## 7. Testes

Três camadas, cada uma com uma função distinta.

### 7.1 pgTAP — provar que o banco protege os dados

Uma suíte para cada tabela que tem dono, testando:

- O usuário A enxerga as próprias linhas
- O usuário A recebe **zero linhas** das do usuário B — zero linhas, não mensagem de erro
- O usuário A não consegue gravar dado marcado como pertencente ao B
- A regra está **forçada**, não apenas ativada
- O papel de visitante não lê nada de nenhuma tabela

Além da segurança, provar as regras que sustentam critérios de aceite:

- Não é possível criar a segunda entrada com o mesmo identificador de mensagem do chat (RF10)
- Não é possível criar o segundo insight com a mesma chave de gatilho (RF08)
- Entrada com origem "chat" obrigatoriamente tem identificador de mensagem, e vice-versa
- Apagar a conta não deixa nenhuma linha órfã em nenhuma tabela (LGPD)

**Meta: 100% das tabelas com dono.** Diferente da cobertura de testes do aplicativo, aqui não existe meta parcial — isolamento de dados é binário.

### 7.2 Hurl — provar que os endpoints cumprem o contrato

Para cada um dos 23 endpoints, quatro testes básicos: caminho feliz com validação do formato da resposta; requisição inválida devolvendo erro de validação; requisição sem token devolvendo erro de autenticação; recurso de outro usuário devolvendo "não encontrado".

Mais as suítes específicas que provam critérios de aceite:

| Suíte | O que prova |
|---|---|
| Idempotência | Criar a mesma entrada de chat duas vezes devolve o mesmo identificador e não muda o total |
| Insight único | Dois pedidos com a mesma chave devolvem o mesmo insight |
| Exportação resiliente | Com a IA forçada a falhar, a narrativa fica marcada como falhada **e** o download continua disponível |
| Exportação vazia | Período sem entradas devolve o erro certo **e não cria job** |
| Retry do chat | Regenerar acerta o cache e incrementa o contador |
| Etiquetas embutidas | A listagem devolve as etiquetas sem requisição adicional |
| Dashboard degradado | Com a narrativa falhando, o agregado continua respondendo normalmente |
| Os 15 cenários | Cinco endpoints × três tipos de falha, cada um com o código e o indicador de retry corretos |
| Streaming | Os eventos chegam na ordem fixa da D12 |

### 7.3 O teste de determinismo — o mais importante de todos

Um teste dedicado que executa o roteiro de validação **duas vezes** contra um banco recém-criado, em modo de reprodução estrita, e compara as respostas caractere por caractere. Identificadores gerados e marcações de tempo são normalizados antes da comparação; qualquer outra diferença quebra o teste.

É este teste que prova, de forma automatizada e reportável, que o backend é determinístico. Sem ele, "o backend foi idêntico nos dois ciclos" é uma afirmação. Com ele, é um fato verificável.

### 7.4 A automação

Cinco tarefas rodando a cada alteração no código:

1. **Banco** — sobe o Supabase local, aplica as migrações, carrega o seed, roda o pgTAP
2. **Contratos** — gera a documentação da API e falha se ela divergir da versionada
3. **API** — sobe os endpoints localmente e roda toda a suíte Hurl
4. **Determinismo** — roda o roteiro duas vezes e compara
5. **Congelamento** — só na etiqueta final: valida o checklist da Seção 9

---

## 8. As fases

**Situação em 31/08:** todas as 18 decisões estão fechadas, o documento de requisitos está atualizado na versão 2.0, e o protótipo está congelado com hash registrado. Falta a parte operacional da Fase 0.

### Fase 0 — Fundação · até 01/09

| Entregável | Como saber que está pronto |
|---|---|
| Decisões assinadas | D1 a D18 formalmente aprovadas |
| Três ambientes | Projetos `dev`, `ciclo-a` e `ciclo-b` criados no Supabase |
| Repositório | Criado, privado, com a automação configurada e passando vazia |
| Chaves e tetos | Anthropic e Voyage configuradas, com limite de gasto |
| Arquivo de defeitos conhecidos | Criado vazio — ativa a política D16 |
| Fixtures de mídia | Áudio de 42 segundos, uma imagem legível e uma ilegível |
| Textos literais | Os sete textos do roteiro, definidos e imutáveis |
| Pares semânticos | Três pares para o critério do RF06, definidos **antes** de testar |

**Sobre os pares semânticos:** o critério do RF06 exige que buscar "ansiedade" encontre um texto que só menciona "nervosismo". Se o modelo não aproximar suficientemente esses dois termos, o critério falha. Definir três pares de antemão, com a regra "pelo menos um precisa passar", é metodologicamente limpo. Escolher os pares depois de ver quais funcionaram seria escolher o resultado.

### Fase 1 — Banco e segurança · 02/09 a 05/09

| Entregável | Como saber que está pronto |
|---|---|
| Migrações | Aplicadas nos três ambientes, com estrutura conferida como idêntica |
| RLS | Suíte pgTAP inteira passando |
| Seed | Três contas carregadas: uma com mais de 30 entradas, uma com uma entrada, uma vazia |
| Prova do RF06 | Uma busca por "ansiedade" no seed encontra o texto que só diz "nervosismo" |

Esta última linha é a mais importante da fase. Se ela falhar, você descobre agora — e tem os pares de reserva.

### Fase 2 — Contratos e ponto de entrada · 06/09 a 09/09

| Entregável | Como saber que está pronto |
|---|---|
| Contratos | Definidos para os 23 endpoints |
| Documentação da API | Gerada e versionada, sem divergência |
| Ponto de entrada | Formato de erro padronizado, injeção de falha e **ganchos do cache já instalados** |

**Atenção ao sequenciamento.** O cache de replay e a injeção de falha precisam estar no ponto de entrada **aqui**, não no final. Instalá-los depois significaria reescrever todos os endpoints de IA. A Fase 6 apenas popula e valida o que foi construído agora.

**Este é o ponto de decisão do cronograma.** Se a Fase 2 não fechar em 09/09, corte o RF05 (exportação). Ele leva junto a fila, o agendamento, o armazenamento de arquivos, a geração de PDF e três endpoints — é a maior economia isolada disponível.

### Fase 3 — Entradas · 10/09 a 13/09

Os cinco endpoints de entrada, incluindo OCR e busca. Verificação de PII e geração de embedding funcionando. **Idempotência do RF10 provada por teste automatizado**, não por observação.

### Fase 4 — Chat · 14/09 a 18/09

Streaming no formato fixo, endpoint de retry, os dois gatilhos de insight com a regra de unicidade funcionando, e o RAG recuperando sempre o mesmo contexto para a mesma pergunta.

É a fase mais longa de propósito: os dois endpoints de streaming são os mais difíceis de acertar de forma determinística.

### Fase 5 — Exportação, dashboard e conta · 19/09 a 20/09

Fila e agendamento operando. Os quatro estados de exportação mapeados exatamente como a tabela da Seção 4.7. Dashboard nos três cenários. Apagamento de conta sem deixar nada órfão.

### Fase 6 — Reprodutibilidade · 21/09 a 22/09

| Entregável | Como saber que está pronto |
|---|---|
| Roteiro de validação | Escrito e revisado |
| Cache populado | Executado uma vez em modo de gravação |
| Determinismo | Reexecução em modo estrito sem nenhum "não encontrado" |
| Teste automatizado | A tarefa de determinismo passando |
| Os 15 cenários | Demonstrados e registrados na tabela de falhas injetadas |

### Fase 7 — Congelamento · 23/09

Checklist da Seção 9 completo, etiqueta de versão criada, pacote de entrega publicado.

### Sobre o prazo

São 23 dias corridos com dedicação integral. **Não há folga estrutural.** A economia de cinco endpoints (etiquetas, edição e exclusão de entrada) devolveu cerca de um dia e meio, que foi realocado da Fase 3 para a Fase 4. O gatilho de corte em 09/09 é a válvula de escape.

---

## 9. Checklist de congelamento

Nenhum ciclo comparativo começa antes de **todos** os itens estarem verdadeiros.

**Banco e segurança**
- [ ] Migrações aplicadas e estrutura conferida como idêntica nos três ambientes
- [ ] Suíte pgTAP 100% verde
- [ ] RLS forçada em todas as tabelas com dono
- [ ] Apagamento de conta verificado sem linhas nem arquivos órfãos
- [ ] Seed carregado com as três contas e datas relativas a âncora fixa
- [ ] A busca semântica encontra o par plantado (critério do RF06)

**Contratos**
- [ ] Documentação da API gerada, versionada, sem divergência
- [ ] Taxonomia de erro fechada em 13 códigos
- [ ] Os 23 endpoints com suíte de contrato passando
- [ ] Formato do streaming validado por teste

**Reprodutibilidade**
- [ ] Roteiro de validação escrito e revisado
- [ ] Cache populado; reexecução em modo estrito sem nenhum "não encontrado"
- [ ] Teste de determinismo passando — duas execuções idênticas
- [ ] Modelo de embedding fixado, sem nenhuma chamada sem versão explícita
- [ ] Nenhum índice vetorial aproximado; toda ordenação com desempate

**Tratamento de erro**
- [ ] Os 15 cenários demonstrados e registrados
- [ ] Lista dos cinco endpoints de escrita confirmada e congelada

**Protótipo**
- [x] Congelado, com hash registrado no documento de requisitos — `ux/Cerne - Prototipo Final.html` (10/09/2026); ⚠️ **reaberto no mesmo dia** pela decisão de acrescentar o botão "Novo Chat" à Tela 3 — ver `Contexto Geral.md` Seção 2.1 e `ux/Requisitos_e_Fluxo_de_Telas_TCC.md` §13.1. Hash precisa ser recalculado após a nova versão sair do Claude Design.
- [x] Todos os estados de tela sustentados por algum endpoint — verificado tela a tela contra os 23 endpoints (`big-plan.md`, checklist final); o novo botão reaproveita `POST /chat/sessions`, sem endpoint novo

**Entrega**
- [ ] Repositório de entrega publicado, somente leitura
- [ ] Etiqueta de versão criada; ramo protegido
- [ ] Arquivo de defeitos conhecidos presente, ainda que vazio
- [ ] Política D16 escrita e anexada ao pacote

---

## 10. O pacote entregue aos dois ciclos

Um repositório separado, somente leitura, contendo:

| Item | Por que está aqui |
|---|---|
| Documentação da API | O contrato completo dos 23 endpoints |
| Taxonomia de erro | Os 13 códigos e quando cada um aparece |
| Mapa de estados de tela | A tabela da Seção 4.7 e as equivalentes — evita que cada ciclo infira o mapeamento |
| Semântica do selo de sincronização | A definição dos três estados (D9) |
| Roteiro de validação | O script literal de execução |
| Fixtures | Os textos, o áudio e as imagens |
| Coleção de testes de contrato | Para o ciclo conferir a própria integração |
| Credenciais do ambiente | Cada ciclo recebe o seu |
| Defeitos conhecidos | Igual para os dois |

**O código do backend não vai no pacote.** Se um ciclo lesse o código e o outro não, isso seria uma assimetria de informação entre as duas construções — exatamente o tipo de contaminação que o congelamento existe para evitar.

---

## 11. Riscos abertos

**Aprovação do orientador em paralelo.** É o único risco não técnico e o de maior impacto. O escopo divergiu da proposta assinada em seis pontos documentados. Uma objeção em outubro não custa uma reunião — custa o backend congelado e possivelmente um ciclo inteiro. O documento de ciência já está preparado; leve-o à próxima orientação.

**Cronograma sem folga.** Mitigado pelo gatilho de corte em 09/09.

**Determinismo residual.** Durante a construção dos apps o modo é de reprodução com recurso à IA real, então chamadas fora do roteiro não são replicadas entre ciclos. Isso é intencional — travar tudo emperraria o desenvolvimento — mas precisa aparecer em Ameaças à Validade: apenas a execução final é integralmente determinística.

**Pausa de ambiente por inatividade.** O ambiente do ciclo B ficará semanas parado. Reconferir a estrutura antes de liberá-lo é obrigatório.

---

## 12. Documentos relacionados

| Documento | Papel |
|---|---|
| `Requisitos_e_Fluxo_de_Telas_TCC_v2.md` | Fonte de verdade dos requisitos. Os dois ciclos recebem este arquivo |
| `roteiro_de_validacao.md` | O script determinístico de execução |
| `Cerne_-_prototipo_final.html` | Referência visual congelada — 29 frames, 32 estados |
| `Ciencia_Orientador_Divergencias_de_Escopo.md` | Registro das divergências para a orientação |

---

*Plano de desenvolvimento — versão 4.0, 31 de agosto de 2026. Nenhuma linha de código de implementação foi escrita, conforme a restrição do projeto.*
