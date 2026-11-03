# Auditoria de rotas, 03/11/2026

Escopo: todas as rotas da API (Express 5) e do importador (Node `http`), mais um smoke de
leitura em produção. Nada foi commitado.

## Resultado em uma tela

|                                                                 | Antes                                      | Depois                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Testes da API                                                   | 395 (+ o que outros agentes acrescentaram) | 5184 no total; `rotas.auditoria.test.ts` sozinho: 4082                                    |
| Testes do importador                                            | 146                                        | 901 no total; `rotas.test.mjs` sozinho: 723 (687 verdes, 22 `todo`, 14 `skip` com motivo) |
| Vermelhos                                                       | 0                                          | 0                                                                                         |
| Bugs reais corrigidos na API                                    | n/a                                        | 5                                                                                         |
| Bugs reais achados no importador (fora do escopo, `server.mjs`) | n/a                                        | 6, todos documentados como `todo`                                                         |

Saída real dos comandos finais:

```
$ cd apps/api && npx vitest run
 Test Files  49 passed (49)
      Tests  5184 passed (5184)

$ cd apps/importer && node --test *.test.mjs
ℹ tests 901
ℹ pass 865
ℹ fail 0
ℹ cancelled 0
ℹ skipped 14
ℹ todo 22
```

O importador usa `node:test`, não vitest (`npx vitest` nem existe nesse pacote). O comando é
`node --test rotas.test.mjs`.

## Como a API foi testada

`apps/api/src/rotas.auditoria.test.ts` percorre a pilha do router do Express 5
(`rotas.enumerar.ts`) e monta a lista de rotas **registradas**, não uma lista escrita à mão.
O Express 5 não guarda o texto do prefixo de um `router.use('/x', sub)`, então
`rotas.montagens.ts` espelha o `app.ts` por identidade de objeto. Um router novo sem entrada
ali faz o teste falhar (inventário), e uma rota nova sem `requireAuth` e fora da lista
`PUBLICAS` também. A política de quem precisa de conta ficou explícita no teste.

Prisma, Redis, Firebase, BullMQ e `fetch` entram dublados: banco "bonzinho" (qualquer modelo,
resultado vazio coerente com o método), filas que respondem vazio, rede fora do ar. Nada sai
da máquina. `AUDITORIA_SAIDA=arquivo.json` grava a matriz observada.

114 rotas registradas (112 em `/api/v1`, mais `GET /healthz` e `GET /api/docs/openapi.json`). Classes de caso:

| Classe                   | Casos                                                                                                                                            | Regra verificada                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| a) visitante             | 114 + 60 (credencial ruim)                                                                                                                       | rota com `requireAuth` responde 401; credencial podre nunca vira 5xx                                           |
| b) usuário comum e ADMIN | 228                                                                                                                                              | nunca 5xx; papel insuficiente é 403 (admin, telemetria, apagar do acervo)                                      |
| c) id hostil             | 8 valores por rota com parâmetro (`x`, `..`, `..%2F..`, `%00`, 5000 caracteres, SQL, `%E0%A4%A`, unicode bidi)                                   | nunca 5xx; percent quebrado e NUL = 400                                                                        |
| d) corpo inválido        | 8 corpos por rota de escrita (tipos errados, nulos, array no lugar de objeto, 100 kB por campo, array de 10 mil, `__proto__`, text/plain, vazio) | nunca 5xx; 100 kB por campo = 413                                                                              |
| d2) parser global        | 2 por rota                                                                                                                                       | JSON quebrado = 400; corpo maior que 1 MB = 413, até em GET e rota inexistente                                 |
| e) método errado         | todo método não registrado por caminho                                                                                                           | 404 JSON (a API não usa 405)                                                                                   |
| e2) HEAD                 | 1 por GET                                                                                                                                        | mesmo status do GET, sem corpo                                                                                 |
| f) CORS                  | origens permitidas e 7 negadas por GET sem parâmetro, mais preflight                                                                             | ecoa a origem e `credentials`; negadas não recebem cabeçalho CORS; sem Origin passa                            |
| g) Content-Type          | 1 por rota                                                                                                                                       | JSON (exceto HLS), `nosniff`, sem `x-powered-by`, 404 JSON, erro sem pilha                                     |
| h) leituras abertas      | 18                                                                                                                                               | 200 com banco vazio; item inexistente 404                                                                      |
| i) NUL e Prisma          | 1 por GET público e por escrita autenticada + 9                                                                                                  | NUL na query/corpo/chave = 400; erros conhecidos do Prisma mapeados                                            |
| j) upload multipart      | 8                                                                                                                                                | sem arquivo, extensão, falso mp3, campo errado, dois arquivos, multipart torto, nome hostil: 4xx               |
| k) query hostil          | 23 consultas por GET                                                                                                                             | `limit` negativo/gigante/array, cursor lixo, `q[a][b]`, `__proto__`, mil parâmetros...: nunca 5xx, sempre JSON |

Total do arquivo: 4082 testes; a matriz observada tem 2738 linhas (status por rota e caso).

Uma ressalva honesta: com o Prisma dublado não dá para ver erro que só o Postgres produz. Os
dois achados abaixo que dependem disso (NUL em texto, erros `P20xx`) foram fechados por
construção e testados na camada HTTP, **não** reproduzidos contra um Postgres real.

## Bugs encontrados e corrigidos (API)

| #   | Sintoma                                                                                                                                                          | Causa                                                                                   | Correção                                                                                                                                              | Onde                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `POST /uploads` com multipart torto ("Boundary not found", "Malformed part header") respondia **500** e logava pilha                                             | o busboy lança `Error` cru, sem `MulterError`; caía no ramo final do `errorHandler`     | `arquivoUnico` envolve `upload.single('file')`: `MulterError` segue como antes (413/400), o resto vira 400 `BAD_REQUEST`                              | `apps/api/src/modules/uploads/uploads.routes.ts:43` (usado em `:64`)       |
| 2   | `GET /radios/agora/:estacao` com o Radio Browser fora do ar respondia **500**                                                                                    | `fetch` lança `TypeError`/`Error` genérico em `agora.ts:73`; ninguém traduzia           | o controller converte erro que não é `AppError` em 502 `BAD_GATEWAY`. Falha de fornecedor deixa de parecer defeito da API e de poluir o log com pilha | `apps/api/src/modules/radios/radios.controller.ts:17-24`                   |
| 3   | byte NUL em id, query ou campo de corpo (`/tracks/a%00b`, `{"title":"a\u0000b"}`) chegaria ao Postgres, que não guarda NUL em `text`: erro de consulta = **500** | nenhuma barreira                                                                        | middleware `semNulo`: 400 para NUL na URL, nas strings e nas chaves do corpo, e para JSON aninhado a mais de 64 níveis                                | `apps/api/src/middlewares/semNulo.ts`, montado em `apps/api/src/app.ts:76` |
| 4   | erros conhecidos do Prisma causados por entrada do cliente (`P2025`, `P2002`, `P2003`, `P2000`, `P2023`) viravam 500 `INTERNAL`                                  | o `errorHandler` só conhecia `AppError`, `ZodError`, `MulterError` e erros com `status` | mapa para 404/409/409/400/400, sem vazar texto do Prisma; código desconhecido continua 500                                                            | `apps/api/src/middlewares/errorHandler.ts:51-66`                           |
| 5   | `DELETE/PATCH/POST /api/docs/openapi.json` respondia **200** (o `router.use('/')` do Swagger UI aceita qualquer método)                                          | router do Swagger montado sem filtro de método                                          | `apenasLeitura`: só GET, HEAD e OPTIONS passam; o resto cai no 404 JSON padrão                                                                        | `apps/api/src/app.ts:42-46` e `:141`                                       |

Hipóteses que o teste descartou (não eram bug): `PATCH /me` com corpo vazio devolve 200 (nada a
atualizar, coerente); `jornada/me` 500 e `PATCH /me` 500 que apareceram na primeira rodada eram
do dublê (faltava `findUniqueOrThrow` e o retorno de `update` do usuário), não da rota.

Observações sem correção:

- `422` é a convenção de validação (zod) da API. O pedido falava em 400/404; o teste aceita 400,
  404 e 422 como "recusado por entrada inválida".
- Os limitadores de taxa se desligam em `NODE_ENV=test` (`skip: () => isTest`), então 429 não é
  coberto aqui. `rateLimit.ts` segue testado só por inspeção.
- `GET /catalogo` ignora `limit` e devolve o acervo inteiro (3,1 MB em produção, ~2,6 s). É decisão
  de projeto (o app baixa tudo), mas é o ponto mais pesado da API.
- `rotas.enumerar.ts` e `rotas.montagens.ts` entram no `tsc -p tsconfig.build.json` (não terminam
  em `.test.ts`). São inertes, ninguém os importa fora dos testes.

## Matriz da API (observada)

Colunas "visitante / comum / ADMIN" = status com dublê de banco vazio e id/valores plausíveis
(`x1abc`). 404 em ADMIN significa "registro inexistente" (o dublê não tem dados). "Corpo tipos
errados" = status do caso `tipos-errados`. "id hostil" = status para `x` / `..` / 5000 caracteres / NUL.

| Metodo | Caminho                           | Auth                       | visitante | comum | ADMIN | corpo tipos errados | id hostil (x/../5000/NUL) |
| ------ | --------------------------------- | -------------------------- | --------- | ----- | ----- | ------------------- | ------------------------- |
| GET    | `/healthz`                        | aberta                     | 200       | 200   | 200   | -                   | -                         |
| POST   | `/auth/session`                   | conta                      | 401       | 200   | 200   | 200                 | -                         |
| DELETE | `/auth/session`                   | conta                      | 401       | 204   | 204   | 204                 | -                         |
| GET    | `/me`                             | conta                      | 401       | 200   | 200   | -                   | -                         |
| PATCH  | `/me`                             | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/me/stats`                       | conta                      | 401       | 200   | 200   | -                   | -                         |
| GET    | `/users/:id`                      | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/users/:id/playlists`            | aberta                     | 404       | 404   | 404   | -                   | 404/200/422/400           |
| POST   | `/users/:id/follow`               | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| DELETE | `/users/:id/follow`               | conta                      | 401       | 204   | 204   | 204                 | 204/404/422/400           |
| GET    | `/artists`                        | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/artists/:id`                    | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/artists/:id/top-tracks`         | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/artists/:id/albums`             | aberta                     | 200       | 200   | 200   | -                   | 200/200/422/400           |
| GET    | `/artists/:id/related`            | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| POST   | `/artists/:id/follow`             | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| DELETE | `/artists/:id/follow`             | conta                      | 401       | 204   | 204   | 204                 | 204/404/422/400           |
| GET    | `/albums/new-releases`            | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/albums`                         | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/albums/:id`                     | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/tracks/:id`                     | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/tracks/:id/waveform`            | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/tracks/:id/lyrics`              | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/tracks/:id/download`            | conta                      | 401       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/playlists`                      | conta                      | 401       | 200   | 200   | -                   | -                         |
| POST   | `/playlists`                      | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/playlists/:id`                  | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| PATCH  | `/playlists/:id`                  | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| DELETE | `/playlists/:id`                  | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| POST   | `/playlists/:id/tracks`           | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| DELETE | `/playlists/:id/tracks`           | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| PATCH  | `/playlists/:id/tracks/reorder`   | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| POST   | `/playlists/:id/collaborators`    | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| GET    | `/me/library`                     | conta                      | 401       | 200   | 200   | -                   | -                         |
| GET    | `/me/library/liked-tracks`        | conta                      | 401       | 200   | 200   | -                   | -                         |
| PUT    | `/me/library/tracks/:id`          | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| DELETE | `/me/library/tracks/:id`          | conta                      | 401       | 204   | 204   | 204                 | 204/404/422/400           |
| PUT    | `/me/library/albums/:id`          | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| DELETE | `/me/library/albums/:id`          | conta                      | 401       | 204   | 204   | 204                 | 204/404/422/400           |
| PUT    | `/me/library/artists/:id`         | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| DELETE | `/me/library/artists/:id`         | conta                      | 401       | 204   | 204   | 204                 | 204/404/422/400           |
| POST   | `/me/history`                     | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/me/history/recent`              | conta                      | 401       | 200   | 200   | -                   | -                         |
| GET    | `/me/history`                     | conta                      | 401       | 200   | 200   | -                   | -                         |
| DELETE | `/me/history`                     | conta                      | 401       | 200   | 200   | 200                 | -                         |
| GET    | `/me/uploads`                     | conta                      | 401       | 200   | 200   | -                   | -                         |
| GET    | `/search`                         | aberta                     | 422       | 422   | 422   | -                   | -                         |
| GET    | `/search/suggest`                 | aberta                     | 422       | 422   | 422   | -                   | -                         |
| GET    | `/home`                           | conta                      | 401       | 200   | 200   | -                   | -                         |
| POST   | `/uploads`                        | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/uploads/:id/status`             | conta                      | 401       | 404   | 404   | -                   | 404/404/422/400           |
| DELETE | `/uploads/:id`                    | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| POST   | `/imports/cloud`                  | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/imports/config`                 | conta                      | 401       | 200   | 200   | -                   | -                         |
| POST   | `/imports/link`                   | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/imports/:id/status`             | conta                      | 401       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/stream/:trackId/manifest.m3u8`  | aberta                     | 422       | 422   | 422   | -                   | 422/404/422/400           |
| GET    | `/stream/:trackId/:quality/:file` | aberta                     | 422       | 422   | 422   | -                   | 422/404/422/400           |
| GET    | `/podcasts`                       | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/podcasts/:id`                   | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/podcasts/:id/episodes`          | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/radios`                         | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/radios/agora/:estacao`          | aberta                     | 502       | 502   | 502   | -                   | 422/200/422/400           |
| GET    | `/radios/:id`                     | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/recs/daily-mix`                 | conta                      | 401       | 200   | 200   | -                   | -                         |
| GET    | `/recs/discover`                  | conta                      | 401       | 200   | 200   | -                   | -                         |
| GET    | `/recs/mood/:mood`                | aberta                     | 200       | 200   | 200   | -                   | 422/404/422/400           |
| GET    | `/recs/track-radio/:trackId`      | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/feed`                           | conta                      | 401       | 200   | 200   | -                   | -                         |
| POST   | `/tracks/:id/comments`            | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| GET    | `/tracks/:id/comments`            | aberta                     | 200       | 200   | 200   | -                   | 200/404/422/400           |
| DELETE | `/comments/:id`                   | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| PUT    | `/comments/:id/like`              | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| DELETE | `/comments/:id/like`              | conta                      | 401       | 204   | 204   | 204                 | 204/404/422/400           |
| POST   | `/sessions`                       | conta                      | 401       | 422   | 422   | 422                 | -                         |
| GET    | `/sessions/:id`                   | conta                      | 401       | 404   | 404   | -                   | 404/404/422/400           |
| DELETE | `/sessions/:id`                   | conta                      | 401       | 404   | 404   | 404                 | 404/404/422/400           |
| GET    | `/admin/stats`                    | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 200   | -                   | -                         |
| GET    | `/admin/users`                    | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 200   | -                   | -                         |
| PATCH  | `/admin/users/:id`                | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 422   | 422                 | 422/404/422/400           |
| POST   | `/admin/users/:id/ban`            | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 422   | 422                 | 422/404/422/400           |
| DELETE | `/admin/users/:id/ban`            | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 404   | 404                 | 404/404/422/400           |
| GET    | `/admin/uploads`                  | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 200   | -                   | -                         |
| GET    | `/admin/jobs`                     | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 200   | -                   | -                         |
| GET    | `/admin/logs`                     | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 200   | -                   | -                         |
| GET    | `/admin/analytics/plays`          | MODERATOR+ (mutacao ADMIN) | 401       | 403   | 200   | -                   | -                         |
| GET    | `/underground/artists`            | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/underground/artists/search`     | aberta                     | 422       | 422   | 422   | -                   | -                         |
| GET    | `/underground/tracks`             | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/underground/genres`             | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/underground/locations`          | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/underground/trending`           | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/em-alta`                        | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/catalogo`                       | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/catalogo/:id`                   | aberta                     | 404       | 404   | 404   | -                   | 404/404/404/400           |
| POST   | `/catalogo/bulk`                  | conta                      | 401       | 422   | 422   | 422                 | -                         |
| PUT    | `/catalogo/:id`                   | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| DELETE | `/catalogo/:id`                   | ADMIN                      | 401       | 403   | 204   | 204                 | 204/404/204/400           |
| GET    | `/me/colecoes/:nome`              | conta                      | 401       | 422   | 422   | -                   | 422/200/422/400           |
| POST   | `/me/colecoes/:nome`              | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| POST   | `/me/colecoes/:nome/apagar`       | conta                      | 401       | 422   | 422   | 422                 | 422/404/422/400           |
| PUT    | `/telemetria/:deviceId`           | aberta                     | 422       | 422   | 422   | 422                 | 422/404/422/400           |
| GET    | `/telemetria`                     | ADMIN                      | 401       | 403   | 200   | -                   | -                         |
| GET    | `/categorias`                     | aberta                     | 200       | 200   | 200   | -                   | -                         |
| GET    | `/mundo/artista/:nome`            | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/mundo/avisos`                   | aberta                     | 422       | 422   | 422   | -                   | -                         |
| GET    | `/mundo/faixa/:id/creditos`       | aberta                     | 200       | 200   | 200   | -                   | 200/404/422/400           |
| GET    | `/mundo/artista/:nome/creditos`   | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/mundo/pessoa/:chave`            | aberta                     | 404       | 404   | 404   | -                   | 404/404/422/400           |
| GET    | `/jornada/me`                     | conta                      | 401       | 200   | 200   | -                   | -                         |
| PUT    | `/jornada/me`                     | conta                      | 401       | 422   | 422   | 422                 | -                         |
| POST   | `/jornada/convite`                | aberta                     | 422       | 422   | 422   | 422                 | -                         |
| GET    | `/jornada/convite/:handle`        | aberta                     | 404       | 404   | 404   | -                   | 404/404/404/400           |
| GET    | `/api/docs/openapi.json`          | aberta                     | 200       | 200   | 200   | -                   | -                         |

## Importador (`apps/importer/server.mjs`)

`apps/importer/rotas.test.mjs` sobe o servidor real em porta efêmera, modo `IMPORT_TOKEN`, e depois
de **cada** caso ruim confirma que `/health` ainda responde e que o processo não saiu. 723 testes:
inventário (falha se `server.mjs` ganhar rota sem linha na tabela), sem credencial, 8 credenciais
ruins por rota, entrada vazia com credencial, 8 corpos JSON por rota, corpo maior que 1 MB, 14 ids
hostis por rota de id (inclusive travessia de pasta com arquivo-isca fora do cofre: não vazou),
método errado, HEAD, 19 rotas inexistentes, linhas de requisição cruas, CORS (preflight em todos os
caminhos, 4 origens permitidas, 6 negadas, Private Network Access), forma de `/health` e
`/jev/estado`, 100 pedidos paralelos e uma rajada de 300 pedidos ruins.

| Método    | Caminho                                                                      | Auth                   | Sem credencial                                   | Entrada vazia c/ credencial |
| --------- | ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------ | --------------------------- |
| GET       | `/health`                                                                    | aberta                 | 200                                              | 200                         |
| GET       | `/cofre/estado`                                                              | admin/token            | 403                                              | 200                         |
| GET       | `/artist-image` `/artist-top` `/album` `/cover` `/artist-catalog` `/credits` | token                  | 403                                              | 200                         |
| GET       | `/letra/outras-fontes`                                                       | aberta (limite por IP) | 404                                              | 404                         |
| POST      | `/letra/aprendizado`                                                         | token                  | 403                                              | 204                         |
| GET, POST | `/speed`                                                                     | token                  | 403                                              | 200                         |
| POST      | `/blob`                                                                      | token                  | 403                                              | 400 (sem `X-Blob-Id`)       |
| POST      | `/blob/:id/alinhar`                                                          | `k` do cofre           | 400 (valida antes)                               | 400                         |
| GET       | `/blob/:id/tempo`                                                            | `k`                    | 403                                              | 403                         |
| GET, HEAD | `/blob/:id`                                                                  | `k`                    | 403 (404 com `AUDIO_BORDA` vazio), 302 com borda | idem                        |
| DELETE    | `/blob/:id`                                                                  | `k`                    | 403                                              | 404                         |
| POST      | `/aquecer`                                                                   | token                  | 403                                              | 202                         |
| GET       | `/stream`                                                                    | `k`/token              | 403 (`text/plain`)                               | 403                         |
| POST      | `/playlist` `/search` `/meta`                                                | token                  | 403                                              | 400                         |
| GET       | `/buscar-youtube` `/buscar-artistas` `/artista-youtube`                      | token                  | 403                                              | 400                         |
| POST      | `/jev/decidir`                                                               | token                  | 403                                              | 400                         |
| POST      | `/jev/aprender`                                                              | token                  | 403                                              | 200                         |
| GET       | `/jev/estado`                                                                | aberta                 | 200                                              | 200                         |
| POST      | `/ai/chat` `/ai/embed`                                                       | token                  | 403                                              | 503 (IA não configurada)    |
| GET       | `/ai/transcribe/estado`                                                      | token                  | 403                                              | 200                         |
| POST      | `/ai/transcribe`                                                             | token                  | 403                                              | 502 (deveria ser 400)       |
| POST      | `/import/start` `/import`                                                    | token                  | 403                                              | 400                         |
| GET       | `/import/job/:id` `/import/file/:id`                                         | token                  | 403                                              | 404                         |
| qualquer  | rota inexistente / método não suportado                                      | n/a                    | 404 `{"error":"not found"}`                      |                             |
| OPTIONS   | qualquer                                                                     | n/a                    | 204 com CORS                                     |                             |

Esta API nega com **403**, nunca 401. O pedido esperava 401; o teste documenta o 403 real.

Casos que dependem de rede (Deezer, MusicBrainz, YouTube, yt-dlp, NVIDIA, fontes de letra) entram
só com entrada vazia/inválida, que a validação recusa antes de sair. O caso feliz de cada um é um
`skip` com motivo explícito (14 no total).

### Pendências em `server.mjs` (fora do escopo; cada uma é um `todo` no teste, que vira verde sozinho)

| #   | Rota                                                                            | Defeito                                                                                                 | Correção proposta                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /playlist` (L3853), `/search` (L3905), `/meta` (L4011), `/import` (L4458) | JSON quebrado ou `null` = **500** "Erro interno" e linha de log por pedido                              | helper `lerJson(req)` que devolve `{}` ou lança um erro de 400; trocar `JSON.parse((await readBody(req)) \|\| '{}')` por ele e checar `typeof corpo === 'object' && corpo !== null` |
| 2   | `POST /jev/decidir` (L4049), `/jev/aprender` (L4097)                            | JSON quebrado ou `null` = **503** (cai no catch genérico "indisponível")                                | mesmo helper; 400 para entrada ruim, 503 só para falha do motor                                                                                                                     |
| 3   | todas as rotas que usam `readBody` (L2066)                                      | corpo > 1 MB: `req.destroy()` sem resposta, o cliente vê `ECONNRESET` em vez de 413                     | antes do `destroy`, `res.writeHead(413)` + `res.end()` (ou `req.pause()`, responder e fechar). Idem `POST /blob` com `Content-Length` > 140 MB                                      |
| 4   | `POST /ai/transcribe` (L4200)                                                   | corpo que não é áudio vira **502** "Falha ao transcrever" (ffmpeg recusou)                              | tratar erro de conversão do ffmpeg como 415/400, deixar 502 só para falha de fornecedor                                                                                             |
| 5   | `GET //` (L2578)                                                                | `new URL('//', base)` lança, cai no catch externo: **500** + log                                        | montar a URL dentro de try/catch e responder 400, ou usar `req.url` já normalizado                                                                                                  |
| 6   | `HEAD /health`                                                                  | 404 (só `GET` é tratado). Monitor de disponibilidade que use HEAD marcaria o importador como fora do ar | aceitar `HEAD` ali como no `/blob`                                                                                                                                                  |

Observações do importador sem correção: `GET /jev/estado` é aberta (revela o modelo e a contagem
de exemplos por tarefa, sem conteúdo); `/stream` e `/blob/:id` negam com `text/plain` ("forbidden")
e não JSON; `GET /blob` sem id é 404 mas `/blob/` é 400 "bad id" (inconsistência inofensiva).

## Smoke em produção (somente leitura, 03/11/2026)

Nenhum POST que grave. O único POST foi `/import` sem token, recusado antes de qualquer efeito
(403). Medido com `curl` a partir desta máquina.

| URL                                                    | Status | Tempo  | Tamanho     | Observação                                                                                                                                                                         |
| ------------------------------------------------------ | ------ | ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.radinho.online/healthz`                           | 200    | 0,26 s | 67 B        | versão `3ea88c5`                                                                                                                                                                   |
| `/api/v1/catalogo`                                     | 200    | 2,59 s | 3 165 150 B | o mais pesado; sem paginação                                                                                                                                                       |
| `/api/v1/em-alta`                                      | 200    | 0,14 s | 276 157 B   | retrato de 02/11 17:05Z                                                                                                                                                            |
| `/api/v1/radios`                                       | 200    | 0,10 s | 11 B        | `{"data":[]}`: sem rádios cadastradas                                                                                                                                              |
| `/api/v1/mundo`                                        | 404    | 0,08 s | 76 B        | esperado: não há rota na raiz de `/mundo` (use `/mundo/avisos`)                                                                                                                    |
| `/api/v1/mundo/avisos?artistas=Anitta`                 | 200    | 0,11 s | 11 B        | `{"data":[]}`                                                                                                                                                                      |
| `/api/v1/categorias`                                   | 200    | 0,08 s | 24 B        | `{"familias":[]}`: curadoria ainda vazia                                                                                                                                           |
| `/api/v1/catalogo/local:6198b985-…`                    | 200    | 0,23 s | 1 432 B     |                                                                                                                                                                                    |
| `/api/v1/admin/qualquer` e `/admin/stats`              | 401    | 0,09 s | 69 B        |                                                                                                                                                                                    |
| `/api/v1/me`                                           | 401    | 0,09 s | 69 B        |                                                                                                                                                                                    |
| `/api/v1/nao-existe`                                   | 404    | 0,07 s | 81 B        | JSON `NOT_FOUND`                                                                                                                                                                   |
| `OPTIONS /api/v1/catalogo` (Origin `radinho.online`)   | 204    | 0,08 s | 0           |                                                                                                                                                                                    |
| `importer.radinho.online/health`                       | 200    | 0,11 s | 397 B       | versão `3ea88c5`                                                                                                                                                                   |
| `/blob/x`                                              | 403    | 0,11 s | 9 B         | `text/plain` "forbidden" (a expectativa de 400 não se aplica: `x` é id válido)                                                                                                     |
| `/blob/local:00000000-0000-4000-8000-000000000000?k=1` | 302    | 0,09 s | 0           | redireciona para a borda                                                                                                                                                           |
| `POST /import` sem token                               | 403    | 0,18 s | 60 B        |                                                                                                                                                                                    |
| `/jev/estado` (sem token)                              | 200    | 1,23 s | 63 B        | 6150 exemplos de gênero                                                                                                                                                            |
| `/nada`                                                | 404    | 0,31 s | 21 B        |                                                                                                                                                                                    |
| `/blob/%E0%A4%A`                                       | 520    | 0,05 s | 16 B        | **resposta do Cloudflare**, não do importador: o mesmo `%E0%A4%A` em `api.radinho.online/api/v1/tracks/…` e em `/health%E0%A4%A` também dá 520, e `/health` seguiu 200 logo depois |

Achados de produção: `radios` e `categorias` vazias (dados, não rota); `/jev/estado` leva 1,2 s no
primeiro acesso (cache frio do túnel); o servidor no ar roda `3ea88c5`, anterior ao HEAD local
`d0154d7`, portanto as correções deste relatório não estão no ar (ver abaixo).

## Para publicar

As correções da API (`app.ts`, `errorHandler.ts`, `semNulo.ts`, `uploads.routes.ts`,
`radios.controller.ts`) estão só na árvore de trabalho. Push sobe apenas a Vercel; a API precisa de
`publicar-api-vnmax.sh` (ver memória "A API não deploya sozinha"). O importador não mudou.
