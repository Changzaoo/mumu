// ESPELHO GERADO de apps/api/src/workers/escolhaEstrita.ts (transpilado). NAO EDITE:
// edite o .ts e regenere (o teste de paridade em escolhaEstrita.test.ts falha se divergir).
/**
 * ESCOLHA ESTRITA DO VÍDEO — a régua ÚNICA de "este vídeo é a música pedida?".
 *
 * Usada pelo semeador do ouvirmusica, pelo agente pesquisador e (por um espelho
 * gerado deste arquivo, apps/importer/escolhaEstrita.mjs) pelo importador quando
 * resolve links de Spotify/Deezer/Apple/Tidal.
 *
 * POR QUE ISTO EXISTE. A queixa do dono (03/11/2026): "algumas músicas estão
 * sendo passadas com o nome de OUTRO artista". A causa era a escolha frouxa:
 * `includes` sem fronteira de palavra ("Ana" casava "Mariana"), o nome do
 * artista aceito "no título OU no canal" sem olhar de quem era o vídeo (cover,
 * versão de fã, outro cantor com a mesma música), e o resultado gravado com o
 * artista DA LISTA — de modo que o vídeo errado ganhava o crédito certo.
 *
 * A REGRA (nesta ordem; qualquer "não" descarta o vídeo):
 *   1. versão alterada (remix, ao vivo, acústico, cover, karaokê, instrumental,
 *      slowed, sped up, 8D, nightcore, reaction, tutorial, versão, mashup, DJ
 *      set, playlist, mix, melhores, top N, álbum inteiro…) só passa se o
 *      título PEDIDO também a tem;
 *   2. o vídeo é "ARTISTA — TÍTULO" (em qualquer ordem, ou colado, ou só o
 *      título num canal que É o artista/Topic): o lado do artista tem de SER o
 *      artista pedido (palavras inteiras, sem acento nem caixa — "Ana" não é
 *      "Mariana" nem "Ana Castela") e o lado do título tem de SER o título
 *      pedido, sem palavra a mais;
 *   3. duração: conhecida → ±15% ou 20 s (o que for maior); desconhecida →
 *      entre 90 s e 8 min;
 *   4. entre os que sobram, prefere "- Topic" > oficial/VEVO/canal do próprio
 *      artista > o resto;
 *   5. EMPATE OU DÚVIDA = NÃO ESCOLHE. Dois candidatos do mesmo nível cujas
 *      durações divergem além da tolerância são gravações diferentes e nada diz
 *      qual é a pedida: devolve `null` com o motivo. Nunca palpite.
 *
 * Função pura, sem imports: o espelho .mjs é gerado por transpilação deste
 * arquivo e os dois são testados com o MESMO corpus de cenários.
 */
export const DURACAO_MIN_S = 90;
export const DURACAO_MAX_S = 8 * 60;
/** Sem acento, sem caixa, só letras e números separados por espaço. */
export function normalizar(s) {
    return String(s ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
/**
 * Versões alteradas, já em forma normalizada, cada uma como regex de palavra
 * inteira. O RÓTULO serve para ver se o título pedido também a tem.
 */
const VERSOES = [
    ['remix', /\b(?:remix|rmx|remixed|rework|bootleg|flip)\b/],
    ['ao vivo', /\b(?:ao vivo|live|at|en vivo|en directo|show|concert|concerto|tour)\b/],
    ['acustico', /\b(?:acustico|acoustic|unplugged|stripped)\b/],
    ['cover', /\b(?:cover|covers|regravacao|tributo|tribute|homenagem)\b/],
    [
        'karaoke',
        /\b(?:karaoke|karaoque|karaokê|videoke|playback|play back|backing track|sem voz|instrumental|minus one)\b/,
    ],
    [
        'slowed',
        /\b(?:slowed|slow|sped up|speed up|speedup|spedup|sped|reverb|reverbed|nightcore|8d|16d|bass boosted|bassboosted|bass boost|lofi|lo fi|pitched|reverse)\b/,
    ],
    [
        'reaction',
        /\b(?:reaction|reacao|reagindo|react|reacts|analise|review|resenha|comentando|explicando)\b/,
    ],
    [
        'tutorial',
        /\b(?:tutorial|aula|como tocar|how to play|cifra|cifras|tab|tabs|violao|guitar lesson|lesson|dance|coreografia|choreography)\b/,
    ],
    ['versao', /\b(?:versao|version|ver|edit|extended|radio edit)\b/],
    ['mashup', /\b(?:mashup|mash up|medley|pot pourri|megamix|dj set|set|mixtape|b2b)\b/],
    [
        'playlist',
        /\b(?:playlist|mix|mixed|melhores|best of|greatest hits|top \d+|top|hits|compilation|coletanea|album completo|full album|disco completo|completo|completa|full|todas|todos|sequencia|1 hour|2 hours|hora|horas|hours|hour|loop|10 minutes|nonstop|non stop)\b/,
    ],
    [
        'bastidor',
        /\b(?:teaser|trailer|preview|snippet|trecho|amostra|making of|bastidores|behind the scenes|entrevista|interview|podcast|parodia|parody|shorts)\b/,
    ],
    ['tradu', /\b(?:traducao|traduzido|legendado|subtitulado|subtitled|translated|dublado)\b/],
];
/** Rótulos de versão que o texto (normalizado) carrega. */
export function versoesDe(textoNormalizado) {
    const achadas = new Set();
    for (const [rotulo, re] of VERSOES)
        if (re.test(textoNormalizado))
            achadas.add(rotulo);
    return achadas;
}
/**
 * Versões que valem como ALTERADAS. Algumas palavras acima ("at", "show",
 * "set", "ver", "slow", "full", "top", "hits", "vs", "tour", "hora") são vagas
 * demais sozinhas: só pesam no texto cru do vídeo, nunca isoladas no título
 * pedido (o pedido só "libera" a versão quando ele próprio a tem).
 */
const FRACAS = new Set([
    'at',
    'show',
    'set',
    'ver',
    'slow',
    'full',
    'top',
    'hits',
    'tour',
    'hora',
    'dance',
    'mix',
    'live',
    'edit',
    'cover',
    'tab',
]);
function termosDe(textoNormalizado) {
    const termos = new Set();
    for (const [, re] of VERSOES) {
        const g = new RegExp(re.source, 'g');
        for (const m of textoNormalizado.matchAll(g))
            termos.add(m[0]);
    }
    return termos;
}
/** O vídeo traz alguma versão alterada que o pedido NÃO pediu? Devolve o termo. */
export function versaoNaoPedida(tituloDoVideo, tituloPedido) {
    const video = termosDe(normalizar(tituloDoVideo));
    const pedido = termosDe(normalizar(tituloPedido));
    for (const t of video) {
        if (pedido.has(t))
            continue;
        // Vago + presente como palavra do título pedido ("Live Forever") já é pedido.
        if (FRACAS.has(t) && normalizar(tituloPedido).split(' ').includes(t))
            continue;
        return t;
    }
    return null;
}
/**
 * "Canção - Remastered 2011", "Será - Ao Vivo": o sufixo que Spotify/Deezer
 * põem depois do traço é da edição, não do nome da música.
 */
export function tituloSemSufixoDeCatalogo(titulo) {
    return String(titulo ?? '').replace(/\s+[-–—]\s+[^-–—]*\b(?:remaster\w*|ao vivo|live|version|versao|versão|mono|stereo|acoustic|acustico|acústico|remix|edit|deluxe|bonus|single|(?:19|20)\d{2})\b.*$/i, '');
}
/** Versões (rótulos fortes) que o título pedido exige do vídeo. */
export function versoesExigidas(tituloPedido) {
    const n = normalizar(tituloPedido);
    const exigidas = [];
    for (const [rotulo, re] of VERSOES) {
        const m = n.match(new RegExp(re.source, 'g'));
        if (m && m.some((t) => !FRACAS.has(t)))
            exigidas.push(rotulo);
    }
    return exigidas;
}
/** Palavras de divulgação que não são parte do nome de ninguém. */
const RUIDO = new Set([
    'official',
    'oficial',
    'video',
    'videos',
    'videoclipe',
    'clipe',
    'clip',
    'audio',
    'lyrics',
    'lyric',
    'letra',
    'letras',
    'hd',
    '4k',
    '8k',
    'fhd',
    'uhd',
    'visualizer',
    'mv',
    'dvd',
    'lancamento',
    'remastered',
    'remasterizado',
    'remasterizada',
    'remaster',
    'topic',
    'vevo',
    'shorts',
    'fps',
    '60fps',
    '30fps',
    '1080p',
    '720p',
    '2160p',
    '1440p',
    '480p',
    '360p',
    'hq',
]);
/** Frases de divulgação (já normalizadas) que se removem ANTES de tokenizar. */
const FRASES_DE_RUIDO = /\b(?:official music video|music video|official lyric video|official audio|official video|video oficial|clipe oficial|audio oficial|video clipe|lyric video|lyrics video|com letra|lancamento oficial|full hd)\b/g;
/** Palavras que abrem um convidado: o resto do trecho não é do lado em questão. */
const ABRE_CONVIDADO = /\b(?:feat|ft|featuring|part|participacao|with|com)\b.*$/;
function tokens(normalizado) {
    return normalizado
        .replace(FRASES_DE_RUIDO, ' ')
        .split(' ')
        .filter(Boolean)
        .filter((p) => !RUIDO.has(p));
}
/**
 * Limpa UM pedaço do título: sem parênteses/colchetes, hashtags, ano de
 * lançamento, resolução, convidado e ruído de divulgação. Devolve as palavras.
 */
export function palavrasLimpas(bruto, cortarConvidado = true) {
    const t = String(bruto ?? '')
        .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ')
        .replace(/#[\p{L}\p{N}_]+/gu, ' ')
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');
    let n = normalizar(t).replace(/\blancamento\s+(?:19|20)\d{2}\b/g, ' ');
    if (cortarConvidado)
        n = n.replace(ABRE_CONVIDADO, ' ');
    return tokens(n);
}
/** "a e b" == "a b": o conector não distingue dupla de dupla. */
function semConector(palavras) {
    return palavras.filter((p) => p !== 'e' && p !== 'and' && p !== 'x' && p !== 'vs');
}
function iguais(a, b) {
    return a.length === b.length && a.every((p, i) => p === b[i]);
}
/** Separa o título do vídeo nos seus pedaços por "-", "–", "—", "|". */
export function segmentar(titulo) {
    const t = String(titulo ?? '');
    // Aspas: o que está entre elas é o título; o resto, quem canta.
    const citado = /["“”]([^"“”]{1,80})["“”]/.exec(t);
    if (citado) {
        const fora = (t.slice(0, citado.index) + ' ' + t.slice(citado.index + citado[0].length)).trim();
        return [fora, citado[1]].filter((p) => semConector(palavrasLimpas(p)).length > 0);
    }
    // Separador dentro de parênteses não divide.
    const mascarado = t.replace(/\([^)]*\)|\[[^\]]*\]/g, (m) => m.replace(/[-–—|｜]/g, '⁓'));
    return mascarado
        .split(/\s+[-–—]\s+|\s*[|｜]\s*|\s+[-–—]|[-–—]\s+/)
        .map((p) => p.replace(/⁓/g, '-').trim())
        .filter((p) => palavrasLimpas(p, false).length > 0);
}
const MC_DJ = /^(?:mc|dj|mcs|djs)\b/;
/**
 * O pedaço é o lado do ARTISTA e nomeia (por inteiro) um dos artistas pedidos?
 * "Ana" não é "Ana Castela"; "Jorge" não é "Jorge e Mateus".
 */
export function ladoDoArtistaCasa(pedaco, artistas) {
    const todo = semConector(palavrasLimpas(pedaco));
    if (todo.length === 0)
        return false;
    const alvos = artistas.map((a) => semConector(a));
    if (alvos.some((a) => iguais(a, todo)))
        return true;
    const sem = String(pedaco)
        .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(ABRE_CONVIDADO, ' ');
    const nomeDe = (n) => semConector(tokens(normalizar(n)));
    // Lista "A, B x C": cada nome inteiro conta.
    const porSeparador = sem
        .split(/\s*[,;+/]\s*|\s+(?:x|vs\.?)\s+/)
        .map(nomeDe)
        .filter((n) => n.length > 0);
    if (porSeparador.some((n) => alvos.some((a) => iguais(a, n))))
        return true;
    // "A e B" / "A & B": só separa com prova — funk (MC/DJ em todos) ou todos os
    // nomes serem artistas pedidos. Sem prova, "Jorge" não é "Jorge e Mateus".
    const pecas = sem
        .replace(/&/g, ' e ')
        .split(/\s*[,;+/]\s*|\s+(?:x|vs\.?|e|and)\s+/)
        .map((n) => n.trim())
        .filter(Boolean);
    if (pecas.length > 1) {
        const nomes = pecas.map(nomeDe);
        if (nomes.every((n) => n.length > 0)) {
            if (pecas.every((p) => MC_DJ.test(normalizar(p))) &&
                nomes.some((n) => alvos.some((a) => iguais(a, n)))) {
                return true;
            }
            if (nomes.every((n) => alvos.some((a) => iguais(a, n))))
                return true;
        }
    }
    return false;
}
/** O lado do título é exatamente o título pedido (sem palavra a mais)? */
function ladoDoTituloCasa(pedaco, titulo) {
    return iguais(palavrasLimpas(pedaco), titulo);
}
/** Canal sem os sufixos de canal oficial: "Dua Lipa - Topic" → "dua lipa". */
export function nomeDoCanal(canal) {
    return normalizar(canal)
        .replace(/\b(?:topic|vevo|oficial|official|channel|canal|tv|music|musica|records|brasil|brazil)\b/g, ' ')
        .replace(/vevo\b/g, ' ')
        .split(' ')
        .filter(Boolean);
}
/** Nível do canal: 3 = Topic, 2 = oficial/VEVO/o próprio artista, 0 = outro. */
export function nivelDoCanal(canal, artistas) {
    const k = normalizar(canal);
    if (/\btopic\b/.test(k))
        return 3;
    const nome = semConector(nomeDoCanal(canal));
    if (nome.length > 0 && artistas.some((a) => iguais(semConector(a), nome)))
        return 2;
    if (/\b(?:vevo|oficial|official)\b/.test(k) || /vevo$/.test(k))
        return 2;
    return 0;
}
/** O canal É o artista (Topic, VEVO, oficial ou o nome puro)? */
function canalEhOArtista(canal, artistas) {
    const nome = semConector(nomeDoCanal(canal));
    return nome.length > 0 && artistas.some((a) => iguais(semConector(a), nome));
}
/**
 * O vídeo é "ARTISTA — TÍTULO" do pedido? `titulo` pode ser `null` (modo
 * pesquisador: qualquer música DESTE artista): então o lado do título é o que
 * sobrar do lado do artista.
 */
export function lerVideo(r, artistas, titulo) {
    const segs = segmentar(r.titulo);
    if (segs.length === 0)
        return { motivo: 'título vazio' };
    const casaTitulo = (p) => titulo ? ladoDoTituloCasa(p, titulo) : semConector(palavrasLimpas(p)).length > 0;
    if (segs.length === 1) {
        const s = segs[0];
        // Só o título, num canal que É o artista ("Dua Lipa - Topic", VEVO…).
        if (casaTitulo(s) && canalEhOArtista(r.canal, artistas)) {
            return { tituloBruto: s };
        }
        // Colado, sem separador: "Dua Lipa Levitating" / "Levitating Dua Lipa".
        const p = palavrasLimpas(s);
        for (const a of artistas) {
            if (a.length === 0 || p.length <= a.length)
                continue;
            const inicio = p.slice(0, a.length);
            const fim = p.slice(p.length - a.length);
            const resto = (que) => que === inicio ? p.slice(a.length) : p.slice(0, p.length - a.length);
            if (iguais(inicio, a) && (!titulo || iguais(resto(inicio), titulo))) {
                return { tituloBruto: resto(inicio).join(' ') };
            }
            if (iguais(fim, a) && (!titulo || iguais(resto(fim), titulo))) {
                return { tituloBruto: resto(fim).join(' ') };
            }
        }
        return { motivo: casaTitulo(s) ? 'canal não é o artista' : 'título diferente do pedido' };
    }
    // Dois pedaços ou mais: artista de um lado, título do outro; o que sobrar
    // tem de ser só a assinatura do artista/canal.
    const assinatura = (p) => {
        const k = semConector(palavrasLimpas(p));
        return (ladoDoArtistaCasa(p, artistas) ||
            (k.length > 0 && iguais(k, semConector(nomeDoCanal(r.canal)))));
    };
    let motivo = 'artista ou título diferente do pedido';
    for (let i = 0; i < segs.length; i++) {
        if (!ladoDoArtistaCasa(segs[i], artistas))
            continue;
        for (let j = 0; j < segs.length; j++) {
            if (j === i)
                continue;
            if (!casaTitulo(segs[j]))
                continue;
            const sobras = segs.filter((_, k) => k !== i && k !== j);
            if (sobras.every(assinatura))
                return { tituloBruto: segs[j] };
            motivo = 'pedaço a mais no título do vídeo';
        }
    }
    return { motivo };
}
/** Duração aceitável? Conhecida: ±15% ou 20 s; senão, faixa de música. */
export function duracaoServe(real, esperada) {
    if (!(real > 0))
        return false;
    if (esperada && esperada > 0) {
        return Math.abs(real - esperada) <= Math.max(20, esperada * 0.15);
    }
    return real >= DURACAO_MIN_S && real <= DURACAO_MAX_S;
}
/**
 * Escolhe o vídeo da música pedida entre os resultados da busca, ou `null` com
 * o motivo. Ver o cabeçalho para a regra completa.
 */
export function escolherVideoEstrito(pedido, resultados) {
    const artistas = pedido.artistas.map((a) => palavrasLimpas(a, false)).filter((a) => a.length > 0);
    const titulo = palavrasLimpas(tituloSemSufixoDeCatalogo(pedido.titulo));
    const exigidas = versoesExigidas(pedido.titulo);
    if (artistas.length === 0)
        return { escolhido: null, motivo: 'pedido sem artista' };
    if (titulo.length === 0)
        return { escolhido: null, motivo: 'pedido sem título' };
    const motivos = [];
    const aceitos = [];
    resultados.forEach((r, i) => {
        if (!r || typeof r.titulo !== 'string' || typeof r.canal !== 'string')
            return;
        const termo = versaoNaoPedida(r.titulo, pedido.titulo);
        if (termo) {
            motivos.push(`#${i} versão alterada (${termo})`);
            return;
        }
        // Pediu a versão ("Hear Me Now (Remix)"): o vídeo tem de ser ela.
        const nele = versoesDe(normalizar(r.titulo));
        const falta = exigidas.find((v) => !nele.has(v));
        if (falta) {
            motivos.push(`#${i} não é a versão pedida (${falta})`);
            return;
        }
        // Canal de karaokê/cover/playlist não publica a gravação original.
        const termoCanal = versaoNaoPedida(r.canal, pedido.titulo);
        if (termoCanal &&
            /^(?:karaoke|karaoque|karaokê|cover|covers|playlist|mix|instrumental|playback|lofi|reaction|react)$/.test(termoCanal)) {
            motivos.push(`#${i} canal de ${termoCanal}`);
            return;
        }
        const lido = lerVideo(r, artistas, titulo);
        if ('motivo' in lido) {
            motivos.push(`#${i} ${lido.motivo}`);
            return;
        }
        if (!duracaoServe(r.duracaoSeg, pedido.duracaoSeg)) {
            motivos.push(`#${i} duração ${r.duracaoSeg}s fora do esperado`);
            return;
        }
        aceitos.push({ r, nivel: nivelDoCanal(r.canal, artistas), i });
    });
    if (aceitos.length === 0) {
        return {
            escolhido: null,
            motivo: `nenhum vídeo serve: ${motivos.slice(0, 5).join('; ') || 'sem resultados'}`,
        };
    }
    const topo = Math.max(...aceitos.map((a) => a.nivel));
    const finalistas = aceitos.filter((a) => a.nivel === topo).sort((a, b) => a.i - b.i);
    const primeiro = finalistas[0];
    // Empate: gravações que divergem além da tolerância não são "a mesma"; nada
    // diz qual foi a pedida.
    for (const outro of finalistas.slice(1)) {
        const base = pedido.duracaoSeg && pedido.duracaoSeg > 0 ? null : primeiro.r.duracaoSeg;
        if (base !== null && Math.abs(outro.r.duracaoSeg - base) > Math.max(20, base * 0.15)) {
            return {
                escolhido: null,
                motivo: `empate entre gravações diferentes (#${primeiro.i} e #${outro.i})`,
            };
        }
    }
    // Com duração pedida, os que sobram já estão dentro da tolerância: o mais
    // próximo da duração vale, e a ordem da busca desempata.
    if (pedido.duracaoSeg && pedido.duracaoSeg > 0) {
        const alvo = pedido.duracaoSeg;
        finalistas.sort((a, b) => Math.abs(a.r.duracaoSeg - alvo) - Math.abs(b.r.duracaoSeg - alvo) || a.i - b.i);
    }
    return { escolhido: finalistas[0].r, motivo: 'ok' };
}
/**
 * Modo PESQUISADOR (qualquer música deste artista): o vídeo é "ARTISTA — algo"
 * sem versão alterada, em duração de música? Devolve o pedaço que é o nome da
 * música (cru) ou `null`.
 */
export function musicaDoArtista(artista, r) {
    const a = palavrasLimpas(artista, false);
    if (a.length === 0 || a.join('').length < 2)
        return null;
    if (versaoNaoPedida(r.titulo, ''))
        return null;
    const termoCanal = versaoNaoPedida(r.canal, '');
    if (termoCanal &&
        /^(?:karaoke|karaoque|karaokê|cover|covers|playlist|mix|instrumental|playback|lofi|reaction|react)$/.test(termoCanal)) {
        return null;
    }
    if (!duracaoServe(r.duracaoSeg, null))
        return null;
    const lido = lerVideo(r, [a], null);
    if ('motivo' in lido)
        return null;
    // O pedaço do título não pode ser, ele mesmo, o nome do artista.
    const t = palavrasLimpas(lido.tituloBruto);
    if (t.length === 0 || iguais(semConector(t), semConector(a)))
        return null;
    const limpo = lido.tituloBruto
        .replace(/\s*(?:\([^)]*\)|\[[^\]]*\])/g, '')
        .replace(/#\S+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return { tituloBruto: limpo };
}
