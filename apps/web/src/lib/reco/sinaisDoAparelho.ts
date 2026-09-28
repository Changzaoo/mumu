/**
 * Os sinais de gosto DESTE aparelho, prontos para `reordenarPeloGosto`.
 *
 * É a ponte entre as peças puras (pulos, perfil de gosto) e quem decide a fila
 * (o player). Monta tudo na hora em que é chamado — uma vez por emenda de fila,
 * não por faixa — para refletir o pulo de agora há pouco.
 */
import type { TrackDto } from '@radinho/shared';
import * as localHistory from '@/lib/local/localHistory';
import * as localLikes from '@/lib/local/localLikes';
import { chaveDeTexto, perfilDeGosto } from './perfilDeGosto';
import { fatorDePulo, lerPulos } from './pulos';
import type { SinaisDeGosto } from './continuacao';

/** `comGosto: false` para playlist da pessoa: a ordem é dela, só o pulo pesa. */
export function sinaisDoAparelho({ comGosto = true } = {}): SinaisDeGosto {
  const pulos = lerPulos();
  const agora = Date.now();
  const sinais: SinaisDeGosto = { fatorDePulo: (t) => fatorDePulo(t, pulos, agora) };
  if (!comGosto) return sinais;

  // A CONTA, NÃO O APARELHO: `list()` é o histórico do device inteiro, e o
  // device é compartilhado. Sem `listForCurrentUser()`, a rádio de parecidas
  // de quem acabou de entrar nasceria com os plays de quem usou antes dela.
  const curtidas = localLikes.list();
  const perfil = perfilDeGosto({ historico: localHistory.listForCurrentUser(), curtidas });

  let maximoArtista = 0;
  for (const v of perfil.porArtista.values()) if (v > maximoArtista) maximoArtista = v;
  if (maximoArtista > 0) {
    sinais.afinidade = (t: TrackDto) =>
      (perfil.porArtista.get(chaveDeTexto(t.artists[0]?.name ?? '')) ?? 0) / maximoArtista;
  }

  let maximoGenero = 0;
  for (const v of perfil.porGenero.values()) if (v > maximoGenero) maximoGenero = v;
  if (maximoGenero > 0) {
    sinais.afinidadeDeGenero = (t: TrackDto) => {
      if (!t.genre) return 0;
      return (perfil.porGenero.get(chaveDeTexto(t.genre)) ?? 0) / maximoGenero;
    };
  }

  // A faixa em si, curtida — sinal explícito, não aprendido do artista.
  if (curtidas.length > 0) {
    const curtidasIds = new Set(curtidas.map((t) => t.id));
    sinais.curtida = (t: TrackDto) => curtidasIds.has(t.id);
  }

  return sinais;
}
