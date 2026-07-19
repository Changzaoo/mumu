/**
 * A regra de "uma reprodução por conta" — e a regressão cara que ela causou.
 *
 * A primeira versão pausava sempre que a posse apontava para OUTRO aparelho,
 * sem olhar se aquele aparelho ainda existia. Bastava ter tocado no celular
 * ontem para o play de hoje, no computador, morrer na hora: a posse antiga
 * seguia gravada no Firestore. O usuário relatou como "as músicas não estão
 * sendo reproduzidas" — um sintoma que não lembra em nada a causa.
 *
 * A regra correta está aqui em forma de teste: só existe conflito quando o
 * outro aparelho está ONLINE e TOCANDO agora. Em qualquer dúvida, a música
 * continua — dois aparelhos tocando alguns segundos é um incômodo; o app
 * emudecer sozinho é um defeito.
 */
import { describe, expect, it } from 'vitest';

interface Dono {
  online: boolean;
  isPlaying: boolean;
}

/**
 * Espelha a decisão tomada no listener de `state/activeDevice`
 * (lib/devices/presence.ts). Mantida aqui porque a lógica vive dentro de um
 * callback do Firestore; se ela mudar, este teste tem de mudar junto — e é
 * esse atrito que protege o usuário de ser silenciado de novo.
 */
function devePausar(params: {
  tocandoAqui: boolean;
  posseDeOutro: boolean;
  dono: Dono | undefined;
  msDesdeMinhaReivindicacao: number;
  gracaMs?: number;
}): boolean {
  const { tocandoAqui, posseDeOutro, dono, msDesdeMinhaReivindicacao } = params;
  const graca = params.gracaMs ?? 10_000;
  const conflitoReal = Boolean(dono?.online && dono.isPlaying);
  const reivindicacaoRecente = msDesdeMinhaReivindicacao < graca;
  return tocandoAqui && posseDeOutro && conflitoReal && !reivindicacaoRecente;
}

const tocandoLaFora: Dono = { online: true, isPlaying: true };

describe('posse da reprodução', () => {
  it('pausa quando o outro aparelho está mesmo tocando agora', () => {
    expect(
      devePausar({
        tocandoAqui: true,
        posseDeOutro: true,
        dono: tocandoLaFora,
        msDesdeMinhaReivindicacao: 60_000,
      }),
    ).toBe(true);
  });

  it('NÃO pausa por posse velha de aparelho offline (a regressão)', () => {
    // O celular de ontem. Está no documento, mas não está em lugar nenhum.
    expect(
      devePausar({
        tocandoAqui: true,
        posseDeOutro: true,
        dono: { online: false, isPlaying: true },
        msDesdeMinhaReivindicacao: 60_000,
      }),
    ).toBe(false);
  });

  it('NÃO pausa quando o outro aparelho está online mas parado', () => {
    expect(
      devePausar({
        tocandoAqui: true,
        posseDeOutro: true,
        dono: { online: true, isPlaying: false },
        msDesdeMinhaReivindicacao: 60_000,
      }),
    ).toBe(false);
  });

  it('NÃO pausa quando a presença do dono é desconhecida', () => {
    // Snapshot da posse chegou antes da lista de aparelhos. Na dúvida, toca.
    expect(
      devePausar({
        tocandoAqui: true,
        posseDeOutro: true,
        dono: undefined,
        msDesdeMinhaReivindicacao: 60_000,
      }),
    ).toBe(false);
  });

  it('NÃO pausa durante a carência da própria reivindicação', () => {
    // O eco do Firestore ainda traz o dono ANTIGO: sem a carência, o play do
    // usuário se pausava sozinho.
    expect(
      devePausar({
        tocandoAqui: true,
        posseDeOutro: true,
        dono: tocandoLaFora,
        msDesdeMinhaReivindicacao: 500,
      }),
    ).toBe(false);
  });

  it('não faz nada quando este aparelho já está parado', () => {
    expect(
      devePausar({
        tocandoAqui: false,
        posseDeOutro: true,
        dono: tocandoLaFora,
        msDesdeMinhaReivindicacao: 60_000,
      }),
    ).toBe(false);
  });

  it('não faz nada quando a posse é minha', () => {
    expect(
      devePausar({
        tocandoAqui: true,
        posseDeOutro: false,
        dono: undefined,
        msDesdeMinhaReivindicacao: 60_000,
      }),
    ).toBe(false);
  });
});
