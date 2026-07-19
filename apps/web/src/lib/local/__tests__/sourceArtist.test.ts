/**
 * Ler o artista da fonte do download em vez de adivinhar.
 *
 * Esta função grava AUTORIA. Os casos negativos são o coração do arquivo: é
 * melhor a faixa continuar "Desconhecido" do que ganhar o nome errado, porque
 * o nome errado parece certo e o usuário não tem como perceber.
 */
import { describe, expect, it } from 'vitest';
import { artistFromVideo, youtubeIdFrom } from '@/lib/local/sourceArtist';

describe('youtubeIdFrom', () => {
  it('lê as formas usuais de URL', () => {
    expect(youtubeIdFrom('https://www.youtube.com/watch?v=abc123')).toBe('abc123');
    expect(youtubeIdFrom('https://youtu.be/abc123')).toBe('abc123');
    expect(youtubeIdFrom('https://www.youtube.com/shorts/abc123')).toBe('abc123');
    expect(youtubeIdFrom('https://music.youtube.com/watch?v=abc123&list=x')).toBe('abc123');
  });

  it('recusa o que não é YouTube', () => {
    expect(youtubeIdFrom('https://soundcloud.com/x/y')).toBeNull();
    expect(youtubeIdFrom('não é url')).toBeNull();
  });
});

describe('artistFromVideo', () => {
  it('tira o artista do padrão "ARTISTA - MÚSICA"', () => {
    expect(artistFromVideo('MATUÊ - BACKSTAGE', 'Canal X')).toBe('MATUÊ');
  });

  it('descarta o ruído de clipe grudado no título', () => {
    expect(artistFromVideo('BRANDÃO85 - RAGE (Official Music Video)', 'c')).toBe('BRANDÃO85');
  });

  it('fica com o dono, não com o convidado', () => {
    expect(artistFromVideo('ALEE feat. Klisman - SÃO PAULO', 'c')).toBe('ALEE');
  });

  it('aceita os outros separadores comuns', () => {
    expect(artistFromVideo('Matuê | Anos Luz', 'c')).toBe('Matuê');
    expect(artistFromVideo('Matuê – Kenny G', 'c')).toBe('Matuê');
  });

  it('cai para o canal quando o título não separa', () => {
    expect(artistFromVideo('BACKSTAGE', 'Matuê')).toBe('Matuê');
  });

  it('limpa o sufixo do canal automático do YouTube', () => {
    expect(artistFromVideo('BACKSTAGE', 'Matuê - Topic')).toBe('Matuê');
    expect(artistFromVideo('SONHOS', 'Brandão85VEVO')).toBe('Brandão85');
  });

  it('NÃO aceita frase inteira como nome de artista', () => {
    // Título descritivo, não "artista - música". Sobra o canal.
    const t = 'A melhor seleção de trap nacional de 2025 completa - ouça agora';
    expect(artistFromVideo(t, 'Trap Brasil')).toBe('Trap Brasil');
  });

  it('devolve null quando não há título nem canal utilizáveis', () => {
    expect(artistFromVideo('', '')).toBeNull();
    expect(artistFromVideo('X', 'A')).toBeNull();
  });
});
