/**
 * A PARTE DA JORNADA QUE PRECISA DE OUTRAS PESSOAS — liga semanal e amigos
 * indicados. Mora na API (`/jornada`); a sequência e as conquistas continuam
 * no aparelho (ver `jornada.ts`).
 *
 * INDICAÇÃO: o link é `radinho.online/c/<handle>`. Quem abre o link tem o
 * convite guardado e entregue à API com o `deviceId` do aparelho — com ou sem
 * conta. Cada aparelho só conta uma vez.
 */
import { api } from '@/lib/api';
import { getDeviceId } from '@/lib/devices/presence';
import { subscribeAuth } from '@/lib/firebase';
import { aplicarDoServidor, snapshot, subscribe } from './jornada';

export interface MembroDaLiga {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  sequencia: number;
  eu: boolean;
}

export interface JornadaDoServidor {
  semana: string;
  liga: number;
  xpSemana: number;
  sequencia: number;
  recorde: number;
  posicao: number;
  grupo: MembroDaLiga[];
  amigos: number;
  handle: string;
  mudouDeLiga?: 'subiu' | 'desceu';
}

export const LIGAS = [
  { nome: 'Bronze', cor: '#c8834f', icone: 'medalha-3' },
  { nome: 'Prata', cor: '#a9b4c2', icone: 'medalha-2' },
  { nome: 'Ouro', cor: '#f2c14e', icone: 'medalha-1' },
  { nome: 'Safira', cor: '#4f8df2', icone: 'safira' },
  { nome: 'Rubi', cor: '#e2486b', icone: 'rubi' },
  { nome: 'Diamante', cor: '#7fe3ff', icone: 'diamante' },
] as const;

/** Quantos sobem e descem por semana (o servidor decide; aqui é só para pintar as zonas). */
export const SOBEM = 10;
export const DESCEM = 5;

/** Preço de referência de um streaming pago individual (R$/mês) — estimativa. */
export const PRECO_DO_STREAMING = 21.9;

const CHAVE_CONVITE = 'radinho:convite';
const ENVIO_A_CADA_MS = 5 * 60_000;

let logado = false;
const ouvintes = new Set<(j: JornadaDoServidor) => void>();
let ultima: JornadaDoServidor | null = null;

export function ultimaJornada(): JornadaDoServidor | null {
  return ultima;
}
export function aoChegarJornada(o: (j: JornadaDoServidor) => void): () => void {
  ouvintes.add(o);
  return () => ouvintes.delete(o);
}

function receber(j: JornadaDoServidor): void {
  ultima = j;
  aplicarDoServidor({ amigos: j.amigos, liga: j.liga });
  for (const o of ouvintes) o(j);
}

/** Manda o XP da semana e a sequência; devolve a liga atualizada. */
export async function enviarJornada(): Promise<JornadaDoServidor | null> {
  if (!logado) return null;
  const e = snapshot();
  try {
    const { data } = await api.put<JornadaDoServidor>('/jornada/me', {
      semana: e.semana,
      xpSemana: Math.min(20_000, e.xpSemana),
      sequencia: e.sequencia,
      recorde: e.recorde,
    });
    receber(data);
    return data;
  } catch {
    return null;
  }
}

export function linkDeConvite(handle: string): string {
  return `https://radinho.online/c/${encodeURIComponent(handle)}`;
}

export function guardarConvite(handle: string): void {
  try {
    window.localStorage.setItem(CHAVE_CONVITE, JSON.stringify({ handle, enviado: false }));
  } catch {
    /* sem armazenamento */
  }
}

/** Entrega o convite guardado (uma vez com o aparelho, outra se entrar na conta). */
export async function entregarConvite(): Promise<void> {
  let guardado: { handle: string; enviado: boolean | 'conta' } | null = null;
  try {
    guardado = JSON.parse(window.localStorage.getItem(CHAVE_CONVITE) ?? 'null');
  } catch {
    return;
  }
  if (!guardado) return;
  if (guardado.enviado === 'conta' || (guardado.enviado && !logado)) return;
  try {
    await api.post('/jornada/convite', { padrinho: guardado.handle, deviceId: getDeviceId() });
    window.localStorage.setItem(
      CHAVE_CONVITE,
      JSON.stringify({ ...guardado, enviado: logado ? 'conta' : true }),
    );
  } catch {
    /* tenta de novo na próxima abertura */
  }
}

export function initJornadaNoServidor(): () => void {
  void entregarConvite();
  let ultimoEnvio = 0;
  const pararAuth = subscribeAuth((user) => {
    logado = Boolean(user && !user.isAnonymous);
    if (!logado) return;
    void entregarConvite();
    ultimoEnvio = Date.now();
    void enviarJornada();
  });
  // Enquanto ouve, o XP sobe: manda de tempos em tempos (não a cada minuto).
  const pararJornada = subscribe(() => {
    if (!logado || Date.now() - ultimoEnvio < ENVIO_A_CADA_MS) return;
    ultimoEnvio = Date.now();
    void enviarJornada();
  });
  return () => {
    pararAuth();
    pararJornada();
  };
}
