"""
Relógio das letras, rodando na CPU desta máquina (faster-whisper / stable-ts).

Dois modos:

  alinhar <audio> <saida.json> <idioma> <modelo> <texto.txt>
      ALINHAMENTO FORÇADO: o texto da letra (publicada) é conhecido; o modelo só
      diz QUANDO cada verso e cada palavra são cantados. Nunca inventa palavra —
      é a saída para sotaque, autotune e jeito de cantar, que derrubam o
      reconhecimento livre. Medido em 2026-09-26 com "Mantém" (Matuê, trap com
      autotune): o reconhecimento livre devolveu lixo ("proprietary Passe
      Passe…"); o alinhamento com `small` achou a voz ~11,6 s depois do que a
      letra publicada dizia, coerente em 80% dos versos (+11,2 a +12,4 s).
      Saída: {"linhas": [{"startMs", "endMs", "words": [{"text", "startMs",
      "endMs", "prob"}]}]} — uma linha por linha do texto, na mesma ordem.

  transcrever <audio> <saida.json> <idioma> <modelo> [prompt]
      Último recurso, quando não existe letra publicada em lugar nenhum. Cada
      palavra sai com a confiança do modelo (`prob`), para quem consome
      descartar o que ele não ouviu direito em vez de mostrar texto inventado.
      `prompt`, quando presente, é o vocabulário já aprendido deste artista
      (ver vocabulario.mjs) — primeira o decodificador com a gíria/palavra
      certa em vez de deixar o modelo "adivinhar" de novo o que já errou antes.
      Saída: {"language", "words": [{"text", "startMs", "endMs", "prob"}]}

Compatível com a chamada antiga (sem modo): trata como `transcrever`.
"""
import json
import sys
import time


def ms(s):
    return round(float(s) * 1000)


def transcrever(audio, saida, idioma, modelo, prompt=None):
    from faster_whisper import WhisperModel

    model = WhisperModel(modelo, device="cpu", compute_type="int8", cpu_threads=3)
    segmentos, info = model.transcribe(
        audio,
        language=idioma or None,
        word_timestamps=True,
        # Música tem refrão: condicionar no texto anterior faz o modelo entrar
        # em laço repetindo o mesmo verso por minutos.
        condition_on_previous_text=False,
        vad_filter=False,
        beam_size=5,
        # Vocabulário aprendido deste artista (ver vocabulario.mjs) — só um
        # empurrão de contexto no INÍCIO da decodificação; não repete a cada
        # segmento (isso é `condition_on_previous_text`, que fica desligado
        # de propósito acima).
        initial_prompt=prompt or None,
    )
    palavras = []
    parcial = saida + ".parcial"
    # AO VIVO: o modelo decodifica a música em trechos, e cada trecho pronto é
    # gravado na hora — o app mostra as palavras aparecendo enquanto o resto
    # ainda está sendo ouvido, em vez de uma tela vazia por minutos.
    for seg in segmentos:
        for w in seg.words or []:
            texto = w.word.strip()
            if texto:
                palavras.append(
                    {
                        "text": texto,
                        "startMs": ms(w.start),
                        "endMs": ms(w.end),
                        "prob": round(float(w.probability or 0), 3),
                    }
                )
        try:
            with open(parcial + ".tmp", "w", encoding="utf-8") as f:
                json.dump({"words": palavras, "ouvidoMs": ms(seg.end)}, f, ensure_ascii=False)
            import os

            os.replace(parcial + ".tmp", parcial)
        except OSError:
            pass
    return {"language": info.language, "words": palavras}


def alinhar(audio, saida, idioma, modelo, arquivo_texto):
    import stable_whisper

    with open(arquivo_texto, encoding="utf-8") as f:
        linhas = [l.strip() for l in f.read().split("\n")]
    linhas = [l for l in linhas if l]
    model = stable_whisper.load_faster_whisper(
        modelo, device="cpu", compute_type="int8", cpu_threads=3
    )
    res = model.align(audio, "\n".join(linhas), language=idioma or "pt", original_split=True)
    saida_linhas = []
    for seg in res.segments:
        saida_linhas.append(
            {
                "startMs": ms(seg.start),
                "endMs": ms(seg.end),
                "words": [
                    {
                        "text": w.word.strip(),
                        "startMs": ms(w.start),
                        "endMs": ms(w.end),
                        "prob": round(float(getattr(w, "probability", 0) or 0), 3),
                    }
                    for w in (seg.words or [])
                    if w.word.strip()
                ],
            }
        )
    return {"linhas": saida_linhas, "esperadas": len(linhas)}


def main():
    args = sys.argv[1:]
    modo = "transcrever"
    if args and args[0] in ("alinhar", "transcrever"):
        modo = args.pop(0)
    audio, saida = args[0], args[1]
    idioma = args[2] if len(args) > 2 and args[2] not in ("", "auto") else None
    modelo = args[3] if len(args) > 3 else "small"
    inicio = time.time()
    if modo == "alinhar":
        r = alinhar(audio, saida, idioma, modelo, args[4])
    else:
        prompt = args[4] if len(args) > 4 and args[4] else None
        r = transcrever(audio, saida, idioma, modelo, prompt)
    r["segundos"] = round(time.time() - inicio, 1)
    r["modelo"] = modelo
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
