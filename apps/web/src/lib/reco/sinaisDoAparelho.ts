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

  const perfil = perfilDeGosto({ historico: localHistory.list(), curtidas: localLikes.list() });
  let maximo = 0;
  for (const v of perfil.porArtista.values()) if (v > maximo) maximo = v;
  if (maximo <= 0) return sinais;
  sinais.afinidade = (t: TrackDto) =>
    (perfil.porArtista.get(chaveDeTexto(t.artists[0]?.name ?? '')) ?? 0) / maximo;
  return sinais;
}
