/**
 * AUDITORIA DE CRÉDITOS — as funções puras (o executável só lê e escreve).
 */
import { describe, expect, it } from 'vitest';
import {
  aplicarCorrecao,
  auditarFaixa,
  faixaDoAcervo,
  montarRelatorio,
  nomeDaTabelaDeBackup,
  proporCorrecao,
  TABELA_DE_BACKUP_VALIDA,
  type FaixaAuditavel,
} from './auditarCreditos.logica.js';

const faixa = (over: Partial<FaixaAuditavel> = {}): FaixaAuditavel => ({
  id: 'local:1',
  titulo: 'Anos Luz',
  artistas: ['Matuê'],
  tituloOriginal: null,
  artistasOriginais: [],
  selo: null,
  ...over,
});
const codigos = (f: FaixaAuditavel): string[] => auditarFaixa(f).map((a) => a.codigo);

describe('faixaDoAcervo', () => {
  it('lê título, artistas, originais e selo; ignora o que não é faixa', () => {
    const f = faixaDoAcervo('x', {
      track: {
        title: ' Oceano ',
        artists: [{ name: 'Djavan' }, { name: '  ' }],
        tituloOriginal: 'Djavan - Oceano',
        artistasOriginais: [{ name: 'Desconhecido' }],
        label: 'MK Music',
      },
    });
    expect(f).toEqual({
      id: 'x',
      titulo: 'Oceano',
      artistas: ['Djavan'],
      tituloOriginal: 'Djavan - Oceano',
      artistasOriginais: ['Desconhecido'],
      selo: 'MK Music',
    });
    expect(faixaDoAcervo('y', { track: {} })).toBeNull();
    expect(faixaDoAcervo('z', null)).toBeNull();
  });
});

describe('auditarFaixa — o que é suspeito', () => {
  it('faixa limpa não tem achado', () => {
    expect(codigos(faixa())).toEqual([]);
  });
  it('(i) artista é a gravadora/canal', () => {
    expect(codigos(faixa({ artistas: ['MK MUSIC'] }))).toContain('artista-igual-canal');
    expect(codigos(faixa({ artistas: ['GR6 Explode'] }))).toContain('artista-igual-canal');
    expect(codigos(faixa({ artistas: ['Canal X'], selo: 'Canal X' }))).toContain(
      'artista-igual-canal',
    );
  });
  it('(ii) título que parece nome de vídeo', () => {
    expect(codigos(faixa({ titulo: 'Matuê - Anos Luz' }))).toContain('titulo-nao-separado');
    expect(codigos(faixa({ titulo: 'Anos Luz | Matuê' }))).toContain('titulo-nao-separado');
    expect(codigos(faixa({ titulo: 'Anti-Hero' }))).not.toContain('titulo-nao-separado');
  });
  it('(iii) feat/lista no nome do artista, mas não banda ou dupla legítima', () => {
    expect(codigos(faixa({ artistas: ['Matuê feat. Teto'] }))).toContain('artista-feat-ou-lista');
    expect(codigos(faixa({ artistas: ['Matuê, Teto'] }))).toContain('artista-feat-ou-lista');
    expect(codigos(faixa({ artistas: ['MC Ryan SP e MC Davi'] }))).toContain(
      'artista-feat-ou-lista',
    );
    expect(codigos(faixa({ artistas: ['Earth, Wind & Fire'] }))).not.toContain(
      'artista-feat-ou-lista',
    );
    expect(codigos(faixa({ artistas: ['Tyler, The Creator'] }))).not.toContain(
      'artista-feat-ou-lista',
    );
    expect(codigos(faixa({ artistas: ['Jorge e Mateus'] }))).not.toContain('artista-feat-ou-lista');
  });
  it('(iv) Desconhecido ou vazio', () => {
    expect(codigos(faixa({ artistas: ['Desconhecido'] }))).toContain('artista-desconhecido');
    expect(codigos(faixa({ artistas: [] }))).toContain('artista-desconhecido');
  });
  it('(v) título contém o nome do artista', () => {
    expect(codigos(faixa({ titulo: 'Matuê Anos Luz' }))).toContain('titulo-contem-artista');
    // Música com o nome do artista é o título inteiro: não é suspeita.
    expect(codigos(faixa({ titulo: 'Queen', artistas: ['Queen'] }))).not.toContain(
      'titulo-contem-artista',
    );
  });
  it('(vi) artista reescrito sem prova no vídeo original', () => {
    const f = faixa({
      titulo: 'Liberdade',
      artistas: ['Gusttavo Lima'],
      tituloOriginal: 'MC Ryan SP e MC Davi - Liberdade',
      artistasOriginais: ['MC Ryan SP', 'MC Davi'],
    });
    expect(codigos(f)).toContain('artista-sem-prova');
    const ok = faixa({
      titulo: 'Liberdade',
      artistas: ['MC Davi'],
      tituloOriginal: 'MC Ryan SP e MC Davi - Liberdade',
      artistasOriginais: ['MC Ryan SP'],
    });
    expect(codigos(ok)).not.toContain('artista-sem-prova');
  });
  it('(vii) o parser de hoje diverge do gravado', () => {
    const f = faixa({
      titulo: 'Tá Tranquilo (Lançamento 2026) 60fps',
      artistas: ['MC Ryan SP'],
      tituloOriginal: 'MC Ryan SP - Tá Tranquilo (Lançamento 2026) 60fps',
    });
    const a = auditarFaixa(f).find((x) => x.codigo === 'parser-diverge');
    expect(a?.detalhe).toContain('Tá Tranquilo');
    const bom = faixa({ tituloOriginal: 'Matuê - Anos Luz (Clipe Oficial)' });
    expect(codigos(bom)).not.toContain('parser-diverge');
  });
});

describe('proporCorrecao — só pelo parser, nunca inventa', () => {
  it('separa o título de vídeo não separado', () => {
    const f = faixa({ titulo: 'Matuê - Anos Luz (Clipe Oficial)', artistas: ['Desconhecido'] });
    const c = proporCorrecao(f, auditarFaixa(f));
    expect(c).toEqual({ titulo: 'Anos Luz', artistas: ['Matuê'], selo: null });
  });
  it('tira o selo do lugar do artista e devolve o cantor do título original', () => {
    const f = faixa({
      titulo: 'Raridade',
      artistas: ['MK MUSIC'],
      tituloOriginal: 'Anderson Freire - Raridade',
    });
    const c = proporCorrecao(f, auditarFaixa(f));
    expect(c?.artistas).toEqual(['Anderson Freire']);
    expect(c?.titulo).toBe('Raridade');
  });
  it('mantém os atuais quando o parser não acha ninguém, e nunca propõe nome sem prova', () => {
    const f = faixa({
      titulo: 'Evidências (Áudio Oficial) - Topic',
      artistas: ['Chitãozinho e Xororó'],
      tituloOriginal: 'Evidências (Áudio Oficial)',
    });
    const c = proporCorrecao(f, auditarFaixa(f));
    if (c) for (const a of c.artistas) expect(['Chitãozinho e Xororó']).toContain(a);
  });
  it('faixa sem achado corrigível não tem proposta', () => {
    const f = faixa();
    expect(proporCorrecao(f, auditarFaixa(f))).toBeNull();
  });
  it('só selo e nada mais: não propõe (sem quem creditar)', () => {
    const f = faixa({ titulo: 'Raridade', artistas: ['MK MUSIC'] });
    expect(proporCorrecao(f, auditarFaixa(f))).toBeNull();
  });
});

describe('aplicarCorrecao', () => {
  it('troca título e artistas e guarda a marca de reversão uma vez só', () => {
    const track = {
      title: 'Matuê - Anos Luz',
      artists: [{ name: 'Desconhecido', id: 'a' }],
      dna: undefined,
    };
    const novo = aplicarCorrecao(track, { titulo: 'Anos Luz', artistas: ['Matuê'], selo: null });
    expect(novo.title).toBe('Anos Luz');
    expect((novo.artists as Array<{ name: string }>).map((a) => a.name)).toEqual(['Matuê']);
    expect(novo.tituloOriginal).toBe('Matuê - Anos Luz');
    expect(novo.artistasOriginais).toEqual([{ name: 'Desconhecido', id: 'a' }]);
    // Segunda correção não sobrescreve a marca original.
    const de_novo = aplicarCorrecao(novo, { titulo: 'Anos Luz', artistas: ['Matuê'], selo: null });
    expect(de_novo.tituloOriginal).toBe('Matuê - Anos Luz');
  });
});

describe('relatório e backup', () => {
  it('conta os achados por código', () => {
    const r = montarRelatorio(
      [
        {
          id: '1',
          titulo: 'a',
          artistas: [],
          tituloOriginal: null,
          achados: [{ codigo: 'artista-desconhecido', detalhe: '' }],
        },
        {
          id: '2',
          titulo: 'b',
          artistas: [],
          tituloOriginal: null,
          achados: [
            { codigo: 'artista-desconhecido', detalhe: '' },
            { codigo: 'titulo-nao-separado', detalhe: '' },
          ],
        },
      ],
      10,
      '2026-11-03T00:00:00.000Z',
    );
    expect(r).toMatchObject({
      total: 10,
      sinalizadas: 2,
      porCodigo: { 'artista-desconhecido': 2, 'titulo-nao-separado': 1 },
    });
  });
  it('o nome da tabela de backup tem a data e é seguro para o SQL', () => {
    const nome = nomeDaTabelaDeBackup(new Date(2026, 10, 3, 12));
    expect(nome).toBe('catalog_backup_creditos_20261103');
    expect(TABELA_DE_BACKUP_VALIDA.test(nome)).toBe(true);
    expect(TABELA_DE_BACKUP_VALIDA.test('x; drop table "User"')).toBe(false);
  });
});
