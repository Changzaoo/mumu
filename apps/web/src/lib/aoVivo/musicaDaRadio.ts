/**
 * Qual música está tocando na rádio — e em que ponto dela estamos.
 *
 * A API (GET /radios/agora/:estacao, ver apps/api/src/modules/radios/agora.ts)
 * lê o metadado da rádio (ICY ou Triton), confirma a música no catálogo e diz
 * quando ela começou. Daqui sai uma "faixa" com título/artista/capa — que a
 * letra e o clipe já sabem tratar — e um relógio que diz em que segundo da
 * música estamos, para a letra e o vídeo andarem junto com o que se ouve.
 */
import { useQuery } from '@tanstack/react-query';
import type { MusicaDaRadioDto, TrackDto } from '@radinho/shared';
import { api } from '@/lib/api';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Quanto o som que sai daqui está atrás do instante que a rádio informa.
 * ICY: o servidor lê o mesmo stream na ponta ao vivo; o aparelho ouve com o
 * próprio buffer (~2 s). Triton: o `cue_time_start` é o da emissora, e o
 * stream chega ao ouvinte com o atraso da CDN. Estimativas — não medidas com
 * ouvido; se a letra andar adiantada/atrasada, é aqui que se acerta.
 */
const ATRASO_DO_OUVINTE_S: Record<NonNullable<MusicaDaRadioDto['fonte']>, number> = {
  icy: 2,
  triton: 6,
};

const ESTACAO_DO_RADIO_BROWSER = /^[0-9a-f-]{36}$/i;

export interface MusicaTocandoNaRadio {
  /** A música no formato de faixa (letra e clipe a aceitam como qualquer outra). */
  faixa: TrackDto;
  /** Em que segundo da música estamos agora; null = não se sabe (começou antes). */
  posicao: () => number | null;
}

function paraFaixa(m: NonNullable<MusicaDaRadioDto['musica']>): TrackDto {
  const chave = `${m.artista}-${m.titulo}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-');
  return {
    id: `radio-musica:${chave}`,
    title: m.titulo,
    durationMs: m.duracaoMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: m.capaUrl,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: [{ id: '', name: m.artista, slug: '', imageUrl: null }],
    streamUrl: null,
    uploadedByUserId: null,
  };
}

/** Estação do Radio Browser tocando agora (as da API antiga não têm metadado). */
export function useEstacaoTocando(): string | null {
  return usePlayerStore((s) => {
    const id = s.currentTrack?.id;
    if (!id?.startsWith('radio:')) return null;
    const estacao = id.slice('radio:'.length);
    return ESTACAO_DO_RADIO_BROWSER.test(estacao) ? estacao : null;
  });
}

export function useMusicaDaRadio(): MusicaTocandoNaRadio | null {
  const estacao = useEstacaoTocando();
  const tocando = usePlayerStore((s) => s.isPlaying);
  const { data } = useQuery({
    queryKey: ['radio-agora', estacao],
    enabled: estacao !== null && tocando,
    // A troca de música é percebida em até ~10 s; o início dela vem do servidor.
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      const pedidoEm = Date.now();
      const r = (await api.get<MusicaDaRadioDto>(`/radios/agora/${estacao}`)).data;
      // Relógio do aparelho × do servidor: o meio da ida e volta vale como "agora" lá.
      const diferenca = r.agoraMs - (pedidoEm + Date.now()) / 2;
      return { ...r, diferenca };
    },
  });
  if (!estacao || !data?.musica) return null;
  const { musica, inicioMs, fonte, diferenca } = data;
  return {
    faixa: paraFaixa(musica),
    posicao: () => {
      if (inicioMs === null || fonte === null) return null;
      const s = (Date.now() + diferenca - inicioMs) / 1000 - ATRASO_DO_OUVINTE_S[fonte];
      return Math.max(0, s);
    },
  };
}
