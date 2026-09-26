"""
Tempo por PALAVRA do canto, com faster-whisper rodando na CPU desta máquina.

Existe porque nenhum serviço na nuvem que usamos dá tempo por palavra em
português (o whisper da NVCF só devolve janelas de 30 s). Com o instante de cada
palavra, o app reancora a letra publicada no áudio real — letra adiantada,
letra que "acaba antes da música" e letra sem tempo nenhum viram a mesma coisa:
texto da fonte, relógio do áudio.

Uso: python palavras.py <audio> <saida.json> [idioma] [modelo]
Saída: {"language": "pt", "words": [{"text": "...", "startMs": 0, "endMs": 0}]}
"""
import json
import sys
import time

from faster_whisper import WhisperModel


def main() -> None:
    audio, saida = sys.argv[1], sys.argv[2]
    idioma = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ("", "auto") else None
    modelo = sys.argv[4] if len(sys.argv) > 4 else "small"
    inicio = time.time()
    # int8 na CPU: o i5 desta máquina não tem GPU utilizável.
    model = WhisperModel(modelo, device="cpu", compute_type="int8", cpu_threads=3)
    segmentos, info = model.transcribe(
        audio,
        language=idioma,
        word_timestamps=True,
        # Música tem refrão: condicionar no texto anterior faz o modelo entrar
        # em laço repetindo o mesmo verso por minutos.
        condition_on_previous_text=False,
        vad_filter=False,
        beam_size=1,
    )
    palavras = []
    for seg in segmentos:
        for w in seg.words or []:
            texto = w.word.strip()
            if texto:
                palavras.append(
                    {"text": texto, "startMs": round(w.start * 1000), "endMs": round(w.end * 1000)}
                )
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(
            {"language": info.language, "words": palavras, "segundos": round(time.time() - inicio, 1)},
            f,
            ensure_ascii=False,
        )


if __name__ == "__main__":
    main()
