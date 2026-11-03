# Auditoria do projeto musicas (Radinho/Aurial), 03/11/2026

## 1. Resumo executivo

- Produção do backend fora do ar desde a manhã: o servidor vnmax (100.103.150.56) está offline, e a API e o importador não respondem (Cloudflare 530, erro 1033).
- O front em radinho.online (Vercel) abre, mas sem backend: acervo vazio, busca sem resultado, player e letra não testáveis.
- Hoje foram corrigidos achados de segurança na API, no importador e no web (seção 3), incluindo escrita irrestrita no acervo, promoção a admin sem e-mail verificado, vazamento de faixa privada, token de stream no log, derrubada do importador sem login e XSS armazenado no blob.
- Dependências de produção: `pnpm audit --prod` caiu de 27 vulnerabilidades (2 críticas, 14 altas) para 5 (2 altas, 3 moderadas).
- Qualidade: lint de 9 erros para 0; typecheck passa em todos os pacotes; testes verdes em API, importador e shared.
- Continuam abertos achados de segurança altos: token de ID do Firebase na query do `/stream` do importador e `/stream` sem limite de processos.
- Regras do Firestore ainda deixam `catalogo/*` gravável por qualquer logado, e não há CSP.
- Funcional com impacto para o usuário: sincronia que ressuscita itens apagados, biblioteca que muda de conta junto com a troca de login, player sem watchdog de carga, letra alheia aceita e cold start sem recomendação.
- O semeador do ouvirmusica.com.br está pronto e testado só nas funções puras; não foi executado ponta a ponta.
- Próximo passo bloqueante: alguém precisa ligar ou reiniciar o vnmax fisicamente.

## 2. Produção

Estado observado em 03/11/2026, manhã.

| Serviço                                    | Estado              | Observação                                                                                        |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------- |
| Servidor vnmax (100.103.150.56, Tailscale) | Offline             | "last seen 1h ago". SSH conecta no TCP mas trava após SERVICE_ACCEPT. Ping do Tailscale responde. |
| api.radinho.online/healthz                 | HTTP 530, erro 1033 | Túnel cloudflared sem origem.                                                                     |
| importer.radinho.online/health             | HTTP 530, erro 1033 | Túnel cloudflared sem origem.                                                                     |
| musicas.radinho.online                     | Responde            | 404 na raiz é normal.                                                                             |
| radinho.online (Vercel)                    | Abre, sem backend   | Acervo vazio, busca sem resultado, player e letra não testáveis.                                  |

Verificado com Playwright headless no front:

- Service worker ativo, manifest ok, abre offline pelo cache.
- `/admin` e `/telemetria` dão 403; `/s/x` dá "Link não encontrado"; rota inexistente dá 404 amigável.
- Cabeçalhos presentes: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy. Sem CSP.

Para restabelecer:

1. Ligar ou reiniciar o vnmax fisicamente.
2. Conferir `systemctl --user status radinho-api radinho-worker radinho-importer`, disco e memória; religar cloudflared.
3. Publicar a API: `bash infra/scripts/publicar-api-vnmax.sh`.
4. Importador: `git pull` em /opt/aurial e `systemctl --user restart radinho-importer`.
5. Front: deploy automático da Vercel pelo push.

## 3. Segurança: corrigido hoje

Código no commit desta data.

### 3.1 API (apps/api)

| Achado                                                                    | Onde                                                                                                      | Correção                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qualquer conta logada apagava ou reescrevia o acervo inteiro              | catalog.routes.ts, catalog.controller.ts                                                                  | DELETE só ADMIN. PUT e bulk gravam `publicadoPor` (campo de servidor, não desce na listagem). Entrada existente só para dono ou ADMIN. Legado sem dono só ADMIN. Violações no bulk são puladas e contadas em `recusadas`. Id da URL tem de bater com track.id. |
| URLs de áudio arbitrárias no catálogo                                     | catalog.hosts.ts (novo), catalog.repository.ts                                                            | `remoteUrl`, `streamUrl` e `sourceUrl` validados contra lista de hosts (`CATALOGO_HOSTS_DE_AUDIO` mais hosts do importador). `sourceUrl` aceita YouTube, SoundCloud, Bandcamp e Vimeo.                                                                         |
| Promoção a ADMIN por e-mail não verificado                                | middlewares/auth.ts, infra/firebase/firebase.ts                                                           | Exige `email_verified`. Admin existente nunca é rebaixado. Teste auth.test.ts.                                                                                                                                                                                 |
| Faixa privada vazava por playlist, sessão social, álbum, waveform e letra | playlists.service.ts, social.service.ts, albums.repository.ts (take 200), tracks.service.ts (visivelPara) | Checagem `isPublic` ou dono.                                                                                                                                                                                                                                   |
| Token de stream e de cofre no log                                         | httpLogger.ts, errorHandler.ts                                                                            | `urlSemSegredos` mascara token, k, key e authorization.                                                                                                                                                                                                        |
| Cache de estações de rádio sem teto                                       | radios/agora.ts                                                                                           | Teto de 2000 entradas.                                                                                                                                                                                                                                         |
| Validação de IP insuficiente nas rádios                                   | radios/agora.ts                                                                                           | `isBlockedAddress` e bloqueio de 64:ff9b::/96. Anti-rebinding só em http; em https o fetch nativo não fixa IP (documentado).                                                                                                                                   |
| 403 contado como faixa morta nos workers                                  | acervoFiel.worker.ts, duracoes.worker.ts                                                                  | Só 404 mata faixa. 403 e 416 são incertos. Freio de 8 mortas seguidas por volta.                                                                                                                                                                               |
| Curadoria lia a tabela inteira com `dna` (OOM)                            | curation.worker.ts                                                                                        | Lê `data - 'dna'` e carrega dna só das candidatas, em lotes de 200.                                                                                                                                                                                            |
| SSRF pelos workers                                                        | hostConfiavel.ts                                                                                          | Workers só fazem fetch de remoteUrl em hosts do importador.                                                                                                                                                                                                    |
| Fetch sem timeout                                                         | workers                                                                                                   | 30 s para controle, 10 min para arquivo.                                                                                                                                                                                                                       |
| Teto diário do pesquisador perdido no reinício                            | pesquisador.worker.ts                                                                                     | Persistido em WorkerState com dia de São Paulo.                                                                                                                                                                                                                |
| Cast de `versao` sem proteção                                             | conteudoDaFaixa.worker.ts                                                                                 | Protegido.                                                                                                                                                                                                                                                     |

### 3.2 Importador (apps/importer)

| Achado                                                                     | Onde                   | Correção                                                                                                                                       |
| -------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Processo derrubado sem login por `GET /blob/%E0%A4%A` (URIError sem catch) | server.mjs             | Decodificação segura retorna 400. Catch no handler retorna 500. Handlers globais só logam. Teste servidor.test.mjs sobe o servidor de verdade. |
| `readBody` seguia lendo após 1 MB                                          | server.mjs             | Destrói a conexão ao passar de 1 MB.                                                                                                           |
| DELETE /blob/:id exigia só conta                                           | server.mjs             | Exige `k` correto (comparação de tempo constante) ou crachá de serviço. Sem meta retorna 404.                                                  |
| Reenvio de POST /blob com bytes diferentes sem prova                       | server.mjs             | 403 sem devolver token. Valida `pareceAudio`. Só Content-Type audio/*.                                                                         |
| XSS armazenado no subdomínio do blob                                       | server.mjs (GET /blob) | Traz nosniff e CSP sandbox.                                                                                                                    |
| `cf-connecting-ip` forjável pela LAN ou Tailscale                          | server.mjs             | Só aceito de loopback.                                                                                                                         |
| Login sem `email_verified`                                                 | server.mjs             | Exigido.                                                                                                                                       |
| Rotas administrativas abertas a qualquer conta                             | server.mjs             | `authorizeAdmin` (lista ADMIN_EMAILS copiada do shared) em /jev/aprender, /cofre/estado e POST /speed. /letra/aprendizado exige conta.         |
| /ai/chat e /ai/embed sem limite                                            | server.mjs             | Lista fixa de modelos, max_tokens 1024, 30 chamadas a cada 10 min por conta.                                                                   |
| /ai/transcribe sem limite                                                  | server.mjs             | Semáforo global de 1 e 3 chamadas a cada 10 min por conta.                                                                                     |
| dumpJson e listPlaylist sem teto de tempo                                  | server.mjs             | Timeout de 120 s com SIGKILL.                                                                                                                  |

### 3.3 Web (apps/web)

| Achado                                                                                    | Onde               | Correção                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Service worker cacheava /api/v1/* inteiro por 24 h (dados de conta sobreviviam ao logout) | swRegras.ts        | Só GETs públicos: catalogo, em-alta, artists, albums, radios, podcasts, mundo, categorias. Testes em swRegras.                       |
| Logout não limpava dados da conta                                                         | lib/local (logout) | Limpa cache `aurial-api`, fila offline, `conhecidos` de importacoesNaConta e pendentes do importQueue. Biblioteca e downloads ficam. |
| Fila offline sem dono                                                                     | filaOffline.ts     | Guarda `uid` e descarta itens de outra conta.                                                                                        |
| Fila offline nunca subia (brinde)                                                         | filaOffline.ts     | Chave usava NUL e o filtro de coleção usava espaço, então `pendentes(colecao)` não achava nada. Corrigido com separador único.       |

### 3.4 Dependências

| Pacote                          | Versão após a correção |
| ------------------------------- | ---------------------- |
| express                         | 5.2.1                  |
| multer                          | 2.5                    |
| sharp                           | 0.35.5                 |
| music-metadata                  | 11.16                  |
| @capacitor (core e plataformas) | 8.4.3                  |
| @grpc/grpc-js                   | 1.14.5                 |
| overrides body-parser           | 2.4                    |
| proxy-addr                      | 2.0.8                  |
| engine.io                       | 6.6.10                 |
| @fastify/busboy                 | 3.2.2                  |
| source-map-js                   | 1.2.2                  |
| qs                              | 6.16.1                 |

## 4. Segurança: pendente

### 4.1 Importador

| Achado                                                                                        | Onde                                                                        | Gravidade | Correção sugerida                                                          |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| ID token do Firebase vai na query de `/stream?token=`, fica em logs da Cloudflare e da Vercel | apps/web/src/lib/local/importerHelper.ts:634; apps/importer/server.mjs:3471 | Alto      | Token de uso único e vida curta, enviado por cabeçalho ou cookie HttpOnly. |
| `/stream` sem limite global de processos yt-dlp e ffmpeg, sem filtro de live e duração        | server.mjs ~3596                                                            | Alto      | Semáforo global, recusar live e duração acima de um teto.                  |
| `/blob/:id/tempo` com áudio em cache não confere o `k`                                        | server.mjs ~1757                                                            | Médio     | Aplicar a mesma conferência de `k` do DELETE.                              |
| Sem autenticação configurada, tudo aberto com ALLOW_ORIGIN=* e PNA                            | server.mjs 1878, 2156, 2030                                                 | Médio     | Recusar partida com HOST diferente de 127.0.0.1 sem autenticação.          |
| Jobs de import sem dono (/import/job, /import/file; só UUID v4)                               | server.mjs                                                                  | Baixo     | Vincular job ao uid de quem criou.                                         |
| /health aberto mostra commit e modo de auth; /cofre/estado mostra caminhos absolutos          | server.mjs                                                                  | Baixo     | Reduzir o que /health expõe; /cofre/estado com autorização de admin.       |
| yt-dlp baixado sem hash nem versão fixa                                                       | server.mjs:318; Dockerfile:35                                               | alto      | Fixar versão e conferir hash.                                              |

### 4.2 API

| Achado                                                                           | Onde                      | Gravidade | Correção sugerida                                            |
| -------------------------------------------------------------------------------- | ------------------------- | --------- | ------------------------------------------------------------ |
| `/media` público com STORAGE_DRIVER=local anula o token de stream                | apps/api/src/app.ts:81-86 | Médio     | Conferir o driver em produção; exigir token em /media.       |
| Telemetria sem conta enche o banco (60 por minuto por IP, 64 KB, deviceId livre) | rota de telemetria        | Médio     | Teto de aparelhos novos por IP e por dia; TTL nos registros. |
| `POST /jornada/convite` sem conta infla indicações                               | rota /jornada             | Médio     | Exigir conta.                                                |
| XP da jornada vem do cliente (xpSemana até 20000)                                | jornada                   | Baixo     | Calcular XP no servidor.                                     |
| Coleções por usuário sem teto de volume                                          | coleções                  | Baixo     | Teto de itens por coleção.                                   |
| Swagger público em /api/docs                                                     | app.ts                    | Baixo     | Desligar em produção ou exigir autenticação.                 |
| Socket ignora bannedUntil                                                        | socket                    | Baixo     | Checar bannedUntil na conexão.                               |

### 4.3 Web e Firestore

| Achado                                                                                                   | Onde                                                                    | Gravidade | Correção sugerida                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `catalogo/*` gravável por qualquer logado (regra antiga; resgatarBiblioteca.ts lê dessa coleção)         | firestore.rules                                                         | médio     | `allow write: if false`. Confirmar antes que o script de resgate só lê.                                 |
| `sharedTracks` aceita `sharedAt` arbitrário (fixa no topo)                                               | firestore.rules                                                         | médio     | Exigir `sharedAt == request.time`.                                                                      |
| Tocar na fileira da comunidade enfileira 20 importações                                                  | apps/web/src/components/media/CommunityTracksRow.tsx:31-37 (`queueAll`) | médio     | Limitar a uma faixa por ação ou pedir confirmação.                                                      |
| Firestore sem validação de forma e tamanho (users/{uid}/**, trending, shares)                            | firestore.rules                                                         | médio     | Validar campos e tamanhos nas regras.                                                                   |
| Sem CSP na Vercel                                                                                        | vercel.json                                                             | médio     | Começar em Report-Only.                                                                                 |
| `socialLinks` aceita `javascript:`                                                                       | packages shared, schemas/user.ts:65                                     | baixo     | Aceitar só http e https.                                                                                |
| Links /s/:id não validam sourceUrl                                                                       | apps/web/src/lib/share/share.ts:109; SharedPage.tsx:120                 | baixo     | Validar com a mesma lista de hosts da API.                                                              |
| P2P: mensagens sem validação zod; peer pode sobrescrever faixa por id `local:` e enviar bytes sem limite | lib/p2p/peerConnection.ts:160; transfer.ts:104-124                      | médio     | Validar mensagens; limitar bytes; não sobrescrever faixa de outro peer. Latente, sinalização desligada. |
| Sinalização sem limite por IP nem timeout para socket fora de sala                                       | servidor de sinalização                                                 | baixo     | Limite por IP e timeout.                                                                                |

### 4.4 CI e deploy

| Achado                                            | Onde                 | Gravidade | Correção sugerida                |
| ------------------------------------------------- | -------------------- | --------- | -------------------------------- |
| Ações por tag móvel                               | ci.yml, deploy-*.yml | médio     | Fixar por SHA.                   |
| Sem `permissions:`                                | ci.yml, deploy-*.yml | médio     | Declarar permissões mínimas.     |
| `deploy-api.yml` morto, aponta para 192.168.0.100 | deploy-api.yml       | médio     | Remover.                         |
| VERCEL_TOKEN no argv                              | deploy-*.yml         | médio     | Passar por variável de ambiente. |

## 5. Funcional: achados pendentes

### 5.1 Player

- Carga local sem watchdog: spinner eterno. apps/web/src/stores/playerStore.ts:2148-2153, 2254-2260.
- Awaits sem teto antes do watchdog: playerStore.ts:2203-2252.
- Erro de faixa antiga derruba a atual: playerStore.ts:3474-3499.
- Pause não limpa isBuffering nem a carga.
- Media Session duplicada (useMediaSession.ts e initMediaSession) sobrescreve o artwork.
- HLS sem recoverMediaError: lib/audio/AudioEngine.ts:1198.
- Repetir uma faixa não rearma os timers.
- useSleepTimer não reinicia com o mesmo valor.

### 5.2 Letras

- Letra alheia aceita quando a duração é 0: lib/lyrics/lyrics.ts:161-197 (rowMatches); outrasFontesDeLetra.mjs:73-109; lyrics.ovh sem conferência.
- 429 e 5xx do importador viram "sem letra" por 7 dias: importerHelper.ts:1000; lyrics.ts:765.
- Cache positivo nunca expira: lyrics.ts:714-720.
- Offline devolve letra de metadado antigo: lyrics.ts:723.
- Com TEMPO_LOCAL=0, todo /tempo dá 422, inclusive o caminho Riva em inglês: tempoDasPalavras.mjs ~316. O áudio inteiro é baixado antes do 422: server.mjs:3128.
- Cliente repete POST de calibração a cada play: lib/lyrics/calibragem.ts:416.
- Indexador de fundo trava nas 15 primeiras sem letra: lyricsSearch.ts:172-181.
- Busca por trecho ignora alfabetos não latinos: função norm em lyricsSearch.

### 5.3 Downloads e sincronia

- Primeira sincronia lê só 500 itens e reenvia o resto, ressuscitando apagados: serverCollection.ts:208-217; collections.repository.ts:34 e 68.
- Cursor `gt` perde itens com mesmo updatedAt em lote: collections.repository.ts:92-104.
- Troca de conta leva biblioteca e curtidas de A para B: localLikes.ts (chave única); localItems() semeia a conta nova. Parcialmente mitigado hoje pela fila com uid; a biblioteca ainda não é por conta.
- Servidor e aparelho baixam a mesma playlist em paralelo após 8 min: importQueue tocar() só em process(); importacoes.worker CARENCIA_MIN=8.
- Biblioteca, download manual e guarda automática usam a mesma chave no store `audio`; deleteAudio apaga o áudio da biblioteca.
- LRU pode apagar download manual promovido durante a varredura: downloadManager.ts:613-621.
- Registro ignora falha de gravação: registry.ts:62.
- "Sem espaço" vira mensagem genérica: TrackRow.tsx:117.
- Timeout de 90 s cobre o corpo inteiro da transferência.
- Polling do job trata 401 e 403 como transitório por 15 min: importerHelper.ts:1485.
- abrirFaixas e abrirRegistro memoizam promessa rejeitada: localLibrary.ts:321, 351.
- Leitura do registro engole erro: localLibrary.ts:471.
- confirmar() da fila apaga escrita mais nova: filaOffline.ts:125-133.
- Telemetria manda e-mail e nome para endpoint sem conta; o painel agrupa pelo e-mail recebido.
- Perfil de A herdado por B até /auth/session responder: useAuthUser.ts:253.
- Tela branca offline após deploy: chunk do firebase fora do precache; AuthorizedRoute retorna null.

### 5.4 Catálogo e busca

- Nó Audius nunca rotaciona: lib/catalog/audius.ts:61-71, 144-156.
- Escolha do YouTube não é estrita (includes sem fronteira; remix e ao vivo passam): acharPelaBusca.ts:40-53.
- 401 e 403 do importador viram "Nada encontrado": MaisMusicas.tsx:74, 183.
- Busca local por includes do termo inteiro e corte em 10 sem ranquear: SearchPage.tsx:236-250.
- Busca do servidor usa ILIKE sem unaccent e sem relevância: search.repository.ts:175.
- If-None-Match comparado com ===: catalog.controller.ts:62.
- useAppleAlbumTracks sobrescreve a duração da prévia: features/catalog/api.ts:115.
- searchArtistId cai em results[0]: itunes.ts:153.
- tituloBase apaga tudo após remix ou edit: albuns.ts:152-156.
- remoteUrl vazio ("") torna a faixa não tocável: catalog.repository.ts:161.
- Worker duracoes marca `incerta` e repete as mesmas 100 a cada 10 min: duracoes.worker.ts.
- Norm de filaDoArtista colapsa "(Interlude)".
- Campos reparoImpossivel e duplicatasFundidas descem ao aparelho.

### 5.5 Recomendação

- Cold start sem "Feito para você": home.service.ts:54 retorna [] sem fallback.
- Like não pesa: recommendations.repository.ts:11-30.
- Cache de recomendações de 6 h nunca é invalidado; id do mix usa UTC.
- Mix sempre o mesmo top por playsCount.
- Moods com slugs inexistentes (electronic, hip-hop, classical, ambient, synthwave); a taxonomia usa eletronica, hip-hop-rap, classica.
- Genre criado com slug cru da tag ID3: audioProcess.worker.ts:174.
- Curadoria reescreve correção manual do admin, sem marca de travado: curation.worker.ts, auditarGeneros 1470-1517, revisarGeneros 1417, forcarGenerosReaisEmDocs 1346.
- NVIDIA sem orçamento diário.
- Índices faltando: TrackGenre(genreId) e Track(createdAt).
- emAlta e pesquisador leem CatalogTrack inteira; o pesquisador faz isso por usuário a cada 30 min.

### 5.6 Workers

- Gravação velha sobrescreve nova entre curadoria, varredura, conteúdo e duração: todos leem o documento, demoram e regravam inteiro.
- Shutdown não espera a volta em curso: apps/api/src/workers/index.ts:115-133.
- Cursor do acervoFiel zera no reinício.
- Corrida entre importacoes e aparelho gera duplicata.

## 6. Qualidade

| Verificação                | Antes                                                                                                   | Depois                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm audit --prod`        | 27 vulnerabilidades (2 críticas, 14 altas)                                                              | 5 (2 altas, 3 moderadas)                                             |
| Lint                       | 9 erros                                                                                                 | 0 erros; 57 avisos (exhaustive-deps e type-imports)                  |
| Typecheck                  | n/d                                                                                                     | Passa em todos os pacotes                                            |
| Testes API                 | n/d                                                                                                     | 41 arquivos, 395 testes ok                                           |
| Testes importador          | n/d                                                                                                     | 146 ok                                                               |
| Testes shared              | n/d                                                                                                     | 284 ok                                                               |
| Testes web                 | HomePage.foto e maisMusicas falhando                                                                    | Corrigidos (desatualizados). Contagem não registrada.                |
| Teste agents.test (shared) | Comparava id de modelo                                                                                  | Compara degrau                                                       |
| Build web                  | Sitemap imprime "catálogo indisponível (HTTP 530)"; Node cai com assertion do libuv no Windows ao final | dist gerado. Queda do Node é bug do ambiente Windows, não corrigido. |

Dependências restantes:

- zod 3.25: advisory pede 4.6.6 (major). Mitigado pelo limite de 1 MB do express.json.
- deepmerge-ts 7, via prisma.
- file-type 19: fix na 21 (major).
- uuid 9, transitivo.

## 7. Coleta do ouvirmusica.com.br e semeador

### 7.1 Coleta

- Fonte: https://www.ouvirmusica.com.br. A Akamai bloqueia curl e fetch; só navegador real funciona.
- Páginas `/mais-acessadas/musicas/<estilo>/` (top 100 por estilo).
- 95 estilos, 9.500 músicas, 9.381 únicas por "artista|título". Todas têm título, artista e gênero. Coletado em 03/11/2026.
- Arquivo: `apps/api/dados/ouvirmusica.json` (1,4 MB, versionado).
- Só nomes. O áudio vem do YouTube pelo mesmo caminho do agente pesquisador: busca, escolha estrita, download, cofre, CatalogTrack, letra.
- A cada música o script confere folga de 200 MB no cofre.

### 7.2 Semeador

- Código: `apps/api/src/scripts/semearDoOuvirMusica.ts`, com `semear.ts` (funções puras, 10 testes).
- Estado retomável: `apps/api/dados/semeadura.estado.json` (fora do git).
- Requer `IMPORTER_URL` e `IMPORT_SERVICE_TOKEN`.
- Não foi executado ponta a ponta, porque o servidor está offline.

Como rodar no vnmax:

```
cd /home/v/radinho-api
node dist/scripts/semearDoOuvirMusica.js --lista dados/ouvirmusica.json --max 40
```

Opções: `--dry-run` (simula), `--pausa-ms 5000` (pausa entre músicas).

Ordem sugerida:

1. `--dry-run` para conferir a lista.
2. `--max 10` para validar a cadeia completa.
3. Agendar com `systemd --user` (timer noturno), 40 por noite. Com 9.381 músicas, são cerca de 235 noites (9.381 / 40).

O cofre é antessala de 2 GB; o GitHub é o destino final.

## 8. Próximos passos, em ordem de prioridade

1. Ligar o vnmax fisicamente; conferir os serviços systemd, disco e memória; religar o cloudflared.
2. Publicar a API (`publicar-api-vnmax.sh`) e atualizar o importador (`git pull` e restart); a Vercel sobe sozinha.
3. Fechar `catalogo/*` para escrita e exigir `sharedAt == request.time` nas regras do Firestore.
4. Trocar o token do `/stream` do importador por token de uso único e vida curta (alto).
5. Limite global de yt-dlp e ffmpeg no `/stream` e filtro de live e duração (alto).
6. Conferir `k` em `/blob/:id/tempo`; recusar partida com HOST diferente de 127.0.0.1 sem autenticação.
7. Conferir o driver de `/media` em produção; teto de aparelhos novos na telemetria; exigir conta em `/jornada/convite`.
8. CSP em Report-Only na Vercel.
9. Rodar o semeador: `--dry-run`, depois `--max 10`, depois o timer noturno.
10. Sincronia: paginação completa na primeira sincronia e respeito a tombstones; biblioteca e curtidas por uid.
11. Player: watchdog na carga local; remover o useMediaSession duplicado.
12. Letras: não gravar vazio em 429 e 5xx; expiração do cache positivo.
13. Recomendação: fallback de cold start; corrigir slugs de mood.
14. Workers: gravação com versão para evitar regravar por cima de dado novo; shutdown que espera a volta em curso.
15. CI: `permissions:`, ações fixadas por SHA, remover deploy-api.yml, fixar yt-dlp por versão e hash.
