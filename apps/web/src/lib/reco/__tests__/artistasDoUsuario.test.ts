/**
 * "SEUS ATALHOS" QUE SÃO IGUAIS PARA TODO MUNDO NÃO SÃO ATALHOS.
 *
 * A grade da tela inicial vinha de `localLibrary.artists()`, que conta as
 * faixas da biblioteca inteira — incluindo o acervo compartilhado — e ordena
 * por quantidade. Todo usuário abria o app e via os mesmos três nomes.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { artistasDoUsuario } from '../artistasDoUsuario';

const t = (id: string, artista: string): TrackDto =>
  ({ id, title: id, artists: [{ id: artista, name: artista }] }) as unknown as TrackDto;

const acervo = [
  { name: 'Gigante do Acervo', coverUrl: null, trackCount: 900 },
  { name: 'Outro Gigante', coverUrl: null, trackCount: 800 },
];

describe('artistasDoUsuario', () => {
  it('o que ela TOCOU vem antes do que o acervo tem mais', () => {
    // O defeito inteiro num teste: o gigante do acervo não pode encabeçar a
    // grade de quem nunca o ouviu.
    const r = artistasDoUsuario([{ track: t('1', 'Banda Dela') }], [], [], acervo);
    expect(r[0]?.name).toBe('Banda Dela');
  });

  it('play recente pesa mais que play antigo', () => {
    const agora = new Date('2026-08-31T12:00:00Z');
    const r = artistasDoUsuario(
      [
        { track: t('1', 'Antiga'), playedAt: '2026-01-01T00:00:00Z' },
        { track: t('2', 'Recente'), playedAt: '2026-08-30T00:00:00Z' },
      ],
      [],
      [],
      acervo,
      { now: agora },
    );
    expect(r[0]?.name).toBe('Recente');
  });

  it('uma curtida vale mais que um play — ela foi deliberada', () => {
    const r = artistasDoUsuario(
      [{ track: t('1', 'Tocada Uma Vez'), playedAt: new Date().toISOString() }],
      [t('2', 'Curtida')],
      [],
      acervo,
    );
    expect(r[0]?.name).toBe('Curtida');
  });

  it('no primeiro dia, a escolha do onboarding sustenta a grade', () => {
    const r = artistasDoUsuario([], [], ['Escolhida no Onboarding'], acervo);
    expect(r[0]?.name).toBe('Escolhida no Onboarding');
  });

  it('mas o que ela FAZ passa na frente do que ela DISSE', () => {
    const r = artistasDoUsuario([], [t('1', 'Curtida de Verdade')], ['Só Escolhida'], acervo);
    expect(r[0]?.name).toBe('Curtida de Verdade');
  });

  it('conta nova sem nada cai na biblioteca — grade vazia é pior que genérica', () => {
    const r = artistasDoUsuario([], [], [], acervo);
    expect(r).toEqual(acervo);
  });

  it('mesmo artista com grafias diferentes não vira dois atalhos', () => {
    const r = artistasDoUsuario([{ track: t('1', 'racionais') }], [t('2', 'Racionais')], [], []);
    expect(r).toHaveLength(1);
  });

  it('completa a capa que a biblioteca já conhece', () => {
    // Quem entrou pela semente é só um nome; sem isto apareceria com ícone
    // genérico mesmo tendo arte disponível.
    const r = artistasDoUsuario(
      [],
      [],
      ['Com Arte'],
      [{ name: 'Com Arte', coverUrl: 'https://capa', trackCount: 4 }],
    );
    expect(r[0]?.coverUrl).toBe('https://capa');
  });
});
