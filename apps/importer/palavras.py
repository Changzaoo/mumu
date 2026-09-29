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
      `prompt`, quando presente, é título + artista + o vocabulário já
      aprendido deste artista (ver tempoDasPalavras.mjs/montarPrompt) — prima o
      decodificador com o nome da música e a gíria certa em vez de deixar o
      modelo "adivinhar" de novo o que já errou antes. Modelo padrão:
      `large-v3-turbo` (o `small` de antes errava demais em pt-BR cantado).
      Saída: {"language", "modelo", "words": [{"text", "startMs", "endMs", "prob"}]}

Compatível com a chamada antiga (sem modo): trata como `transcrever`.
"""
import json
import os
import sys
import time


def ms(s):
    return round(float(s) * 1000)


# Idioma de quem ninguém sabe o idioma: o acervo é majoritariamente brasileiro
# (funk, trap, rap). Deixar o whisper detectar sozinho numa faixa com autotune
# e batida pesada fazia ele "ouvir" inglês e devolver lixo ("proprietary Passe
# Passe…" em "Mantém"). A detecção agora só é aceita quando cai num idioma
# esperado com confiança; senão vale o padrão.
IDIOMA_PADRAO = os.environ.get("WHISPER_IDIOMA_PADRAO", "pt").strip() or "pt"
IDIOMAS_ACEITOS = [
    i.strip() for i in os.environ.get("WHISPER_IDIOMAS_ACEITOS", "pt,en").split(",") if i.strip()
]
CONFIANCA_DO_IDIOMA = 0.6
THREADS = int(os.environ.get("WHISPER_THREADS", "3") or 3)
# Quando o modelo pedido não existe NESTA instalação (faster-whisper antigo
# não conhece "large-v3-turbo") ou não baixa (sem rede), cai para o próximo —
# e a saída diz qual rodou de verdade (`modelo`), para o importador não gravar
# uma transcrição fraca achando que é forte.
RESERVAS = ["large-v3-turbo", "large-v3", "medium", "small"]


def carregar_modelo(modelo):
    from faster_whisper import WhisperModel

    # Só desce na lista (nunca "sobe" para um modelo mais pesado que o pedido).
    abaixo = RESERVAS[RESERVAS.index(modelo) + 1 :] if modelo in RESERVAS else RESERVAS
    tentativas = [modelo] + abaixo
    ultimo_erro = None
    for nome in tentativas:
        try:
            return WhisperModel(nome, device="cpu", compute_type="int8", cpu_threads=THREADS), nome
        except Exception as e:  # modelo desconhecido/sem rede: tenta o próximo
            ultimo_erro = e
            print(f"modelo {nome} indisponível: {e}", file=sys.stderr)
    raise ultimo_erro


def escolher_idioma(detectado, probabilidade, pedido):
    """Idioma a usar de verdade. Pura, para testar sem modelo."""
    if pedido:
        return pedido
    if detectado in IDIOMAS_ACEITOS and (probabilidade or 0) >= CONFIANCA_DO_IDIOMA:
        return detectado
    return IDIOMA_PADRAO


def parametros_de_qualidade(idioma, prompt):
    """Decodificação cuidadosa: música é o pior caso do reconhecimento livre."""
    return dict(
        language=idioma,
        word_timestamps=True,
        # Busca em feixe + reamostragem: o "chute guloso" é o que mais erra
        # gíria e palavra encoberta pela batida.
        beam_size=5,
        best_of=5,
        patience=1.0,
        # Temperatura 0 primeiro; só esquenta quando a saída degenera (laço
        # repetido, probabilidade baixa demais) — o fallback clássico do whisper.
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.6,
        # Música tem refrão: condicionar no texto anterior faz o modelo entrar
        # em laço repetindo o mesmo verso por minutos.
        condition_on_previous_text=False,
        vad_filter=False,
        # Título + artista + vocabulário aprendido do artista (ver
        # tempoDasPalavras.mjs/montarPrompt) — só um empurrão de contexto no
        # INÍCIO; não se repete a cada trecho (isso seria o
        # `condition_on_previous_text`, desligado acima).
        initial_prompt=prompt or None,
        # Introdução instrumental longa é onde o whisper alucina texto (muitas
        # vezes repetindo o próprio prompt): trecho mudo suspeito é pulado.
        hallucination_silence_threshold=2.0,
    )


def transcrever(audio, saida, idioma, modelo, prompt=None):
    from faster_whisper import decode_audio

    model, modelo_usado = carregar_modelo(modelo)
    # Decodifica UMA vez: a detecção de idioma e a transcrição usam o mesmo sinal.
    audio = decode_audio(audio, sampling_rate=16000)
    if not idioma:
        # A detecção roda na abertura do `transcribe` (o gerador de trechos
        # ainda não foi consumido) — descartar e refazer com o idioma certo
        # custa só essa detecção.
        _, info0 = model.transcribe(audio, language=None, beam_size=1)
        idioma = escolher_idioma(info0.language, info0.language_probability, None)
    parametros = parametros_de_qualidade(idioma, prompt)
    try:
        segmentos, info = model.transcribe(audio, **parametros)
    except TypeError:
        # faster-whisper antigo não conhece o corte de alucinação em silêncio.
        parametros.pop("hallucination_silence_threshold", None)
        segmentos, info = model.transcribe(audio, **parametros)
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
            os.replace(parcial + ".tmp", parcial)
        except OSError:
            pass
    return {"language": info.language, "words": palavras, "modelo": modelo_usado}


def alinhar(audio, saida, idioma, modelo, arquivo_texto):
    import stable_whisper

    with open(arquivo_texto, encoding="utf-8") as f:
        linhas = [l.strip() for l in f.read().split("\n")]
    linhas = [l for l in linhas if l]
    model = stable_whisper.load_faster_whisper(
        modelo, device="cpu", compute_type="int8", cpu_threads=THREADS
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
    r.setdefault("modelo", modelo)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
