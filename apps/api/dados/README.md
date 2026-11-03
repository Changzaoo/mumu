# Semeador do acervo

Enche o acervo a partir de uma lista de nomes (artista, título, gênero), pelo mesmo
caminho do agente pesquisador: busca no YouTube pelo importador, escolha estrita,
download, cofre, `CatalogTrack`, letra. Não grava na biblioteca de ninguém.

## Formato da lista

`{ "fonte": "...", "coletadoEm": "ISO", "musicas": [{ "artista", "titulo", "genero?", "posicao?", "url?" }] }`
(veja `ouvirmusica.exemplo.json`). Copie para `ouvirmusica.json` (ignorado pelo git).

## Rodar no vnmax

    cd /home/v/radinho-api && node dist/scripts/semearDoOuvirMusica.js --lista dados/ouvirmusica.json --max 40

O `tsconfig.build.json` emite `dist/scripts/` (só exclui testes). Sem build, a partir de `apps/api`:

    npx tsx src/scripts/semearDoOuvirMusica.ts --lista dados/ouvirmusica.json --max 40

Opções: `--max <n>` por execução (40), `--pausa-ms <ms>` entre músicas (5000, o YouTube
recua em rajada), `--dry-run` (só mostra o que faria; não baixa nem grava), `--lista`.
Precisa de `IMPORTER_URL` e `IMPORT_SERVICE_TOKEN` no ambiente da API.

## Retomada

`dados/semeadura.estado.json` guarda `feitas`, `semResultado` e `falhas` por chave
"artista|título". Rode de novo e ele continua de onde parou; Ctrl+C salva o estado.
Para tentar de novo as sem resultado, apague a chave do arquivo. Quem já está no acervo
é pulado. Com menos de 200 MB livres no cofre, o script para. Falhas são tentadas até
3 vezes no total.
