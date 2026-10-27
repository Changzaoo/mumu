"""
MEDIR A SINCRONIA DA LETRA CONTRA A VOZ ISOLADA — números, não impressão.

Para cada faixa: separa a voz da mixagem (HDemucs, torchaudio, CPU), acha os
ATAQUES da voz (começo de canto depois de um silêncio vocal) e compara com o
instante que o alinhamento deu à linha/palavra que começa ali. O desvio é
`alinhamento − voz`: negativo = a letra acende ANTES da voz; positivo = depois.

Uso:
  python apps/importer/diagnostico/medirSincronia.py manifesto.json [--segundos 150]
      [--saida resultado-sincronia.json] [--voz-em PASTA]

`manifesto.json`:
  [{"nome": "Mundo Fashion", "audio": "x.mp3",
    "alinhamentos": {"small-mix": "x.al.json", "small-voz": "y.al.json"}}]

Os arquivos de alinhamento são a saída do `palavras.py alinhar` (ou os
`D:/Aurial/tempos/<id>.al-<hash>.v2.json` do importador): `{"linhas": [{startMs,
endMs, words: [{text, startMs, endMs, prob}]}]}`.

`--voz-em PASTA` grava a voz isolada (WAV 16 kHz mono) de cada faixa, para
alinhar de novo SOBRE A VOZ e medir se melhora. `--voz-de PASTA` reaproveita
essas vozes (a separação é o que demora: ~1 min por faixa de 150 s) — a
medição então leva segundos.

A medida, por alinhamento:
  • ATAQUES: para cada linha (e palavra) que começa depois de um respiro, o
    início do alinhamento contra o ataque de voz mais perto (±350 ms):
    mediana, quartis, quantas dentro de 100 ms, quantas acendem ANTES da voz.

Rode com o `python` normal (sem `-I`): o torchaudio mora no site-packages do
usuário. Primeira execução baixa os pesos do HDemucs (~320 MB).
"""
import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import time

FFMPEG = os.environ.get("FFMPEG_PATH") or "ffmpeg"
if os.path.isdir(FFMPEG):
    FFMPEG = os.path.join(FFMPEG, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")

HOP_MS = 10  # resolução da envoltória da voz
JANELA_MS = 25
LIMIAR_DB = -25.0  # voz "ativa": relativo ao pico (p99) da voz isolada
SUBIDA_DB = 8.0  # ataque = a voz sobe ao menos isto em 200 ms
JANELA_BUSCA_MS = 350  # quão longe do alinhamento procuramos o ataque
GAP_ALINHAMENTO_MS = 250  # linha/palavra "depois de respiro" segundo o alinhamento


def decodificar(caminho, sr, segundos):
    """Áudio como float32 [canais, amostras] via ffmpeg (estéreo para o demucs)."""
    import numpy as np

    args = [FFMPEG, "-v", "error", "-i", caminho]
    if segundos:
        args += ["-t", str(segundos)]
    args += ["-ac", "2", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()
    return x


def separar_voz(mix, sr):
    """Voz isolada (mono, float32) com o HDemucs em trechos de ~10 s com sobreposição."""
    import torch
    from torchaudio.pipelines import HDEMUCS_HIGH_MUSDB_PLUS as bundle
    from torchaudio.transforms import Fade

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    model = bundle.get_model().eval()
    assert bundle.sample_rate == sr
    idx_voz = model.sources.index("vocals")
    x = torch.from_numpy(mix)
    ref = x.mean(0)
    media, desvio = ref.mean(), ref.std() + 1e-8
    x = (x - media) / desvio
    n = x.shape[-1]
    trecho = int(10 * sr)
    sobre = int(1 * sr)
    fade = Fade(fade_in_len=0, fade_out_len=sobre, fade_shape="linear")
    saida = torch.zeros(n)
    ini = 0
    with torch.no_grad():
        while ini < n:
            fim = min(ini + trecho + sobre, n)
            pedaco = x[:, ini:fim].unsqueeze(0)
            fontes = model(pedaco)[0, idx_voz].mean(0)
            fontes = fade(fontes)
            saida[ini:fim] += fontes
            if fim == n:
                break
            ini += trecho
            fade.fade_in_len = sobre
    return (saida * desvio + media).numpy()


def envoltoria_db(voz, sr):
    import numpy as np

    hop = int(sr * HOP_MS / 1000)
    jan = int(sr * JANELA_MS / 1000)
    n = max(1, (len(voz) - jan) // hop + 1)
    rms = np.empty(n, dtype=np.float32)
    for i in range(n):
        seg = voz[i * hop : i * hop + jan]
        rms[i] = math.sqrt(float(np.mean(seg * seg)) + 1e-12)
    pico = float(np.percentile(rms, 99)) + 1e-9
    db = 20 * np.log10(rms / pico + 1e-9)
    # suaviza 30 ms para não quebrar sílaba em dois ataques
    k = 3
    db = np.convolve(db, np.ones(k) / k, mode="same")
    return db


def ataques(db):
    """Instantes (ms) em que a voz ATACA: sobe ≥ SUBIDA_DB em 200 ms e fica ativa."""
    import numpy as np

    antes = 200 // HOP_MS
    saida = []
    ultimo = -10_000
    for i in range(antes, len(db) - 6):
        if db[i] <= LIMIAR_DB:
            continue
        subida = db[i] - float(np.min(db[i - antes : i]))
        if subida < SUBIDA_DB:
            continue
        # o ponto do ataque é onde a subida fica mais íngreme (maior derivada)
        if i * HOP_MS - ultimo < 120:
            continue
        # exige 60 ms de voz seguida: estalo não é ataque
        if not all(db[i : i + 6] > LIMIAR_DB):
            continue
        # recua até o começo da subida (metade do caminho entre o vale e o pico)
        vale = float(np.min(db[i - antes : i]))
        meio = vale + subida / 2
        j = i
        while j > i - antes and db[j - 1] > meio:
            j -= 1
        t = j * HOP_MS
        if t - ultimo >= 120:
            saida.append(t)
            ultimo = t
    return saida


def pontos_do_alinhamento(al):
    """Linhas e palavras que começam DEPOIS de um respiro, segundo o alinhamento."""
    linhas = al.get("linhas") or []
    pontos_linha, pontos_palavra = [], []
    fim_anterior = -10_000
    for ln in linhas:
        palavras = [w for w in (ln.get("words") or []) if w.get("text")]
        inicio = ln.get("startMs")
        if inicio is None:
            continue
        if inicio - fim_anterior >= GAP_ALINHAMENTO_MS:
            pontos_linha.append(inicio)
        fim_w = fim_anterior
        for w in palavras:
            s = w.get("startMs")
            if s is None:
                continue
            if s - fim_w >= GAP_ALINHAMENTO_MS:
                pontos_palavra.append(s)
            fim_w = max(fim_w, w.get("endMs") or s)
        fim_anterior = max(fim_anterior, ln.get("endMs") or inicio, fim_w)
    return pontos_linha, pontos_palavra


def resumo(deltas):
    if not deltas:
        return {"n": 0}
    d = sorted(deltas)
    q = lambda p: d[min(len(d) - 1, int(p * len(d)))]
    return {
        "n": len(d),
        "medianaMs": int(statistics.median(d)),
        "p25Ms": int(q(0.25)),
        "p75Ms": int(q(0.75)),
        "mediaAbsMs": int(sum(abs(x) for x in d) / len(d)),
        "dentroDe100ms": round(sum(1 for x in d if abs(x) <= 100) / len(d), 2),
        "dentroDe250ms": round(sum(1 for x in d if abs(x) <= 250) / len(d), 2),
        "antesDaVoz150ms": round(sum(1 for x in d if x < -150) / len(d), 2),
    }


def medir(al, ataques_ms, limite_ms):
    pl, pp = pontos_do_alinhamento(al)
    out = {}
    for rotulo, pontos in (("linhas", pl), ("palavras", pp)):
        deltas, perdidos = [], 0
        for t in pontos:
            if t > limite_ms:
                continue
            a = mais_perto(ataques_ms, t)
            if a is None:
                perdidos += 1
            else:
                deltas.append(t - a)
        r = resumo(deltas)
        r["semAtaquePerto"] = perdidos
        out[rotulo] = r
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifesto")
    ap.add_argument("--segundos", type=float, default=150)
    ap.add_argument("--saida", default=os.path.join(os.path.dirname(__file__), "resultado-sincronia.json"))
    ap.add_argument("--voz-em", default=None)
    ap.add_argument("--voz-de", default=None, help="pasta com <nome>.voz.wav já separados")
    args = ap.parse_args()
    import numpy as np

    with open(args.manifesto, encoding="utf-8") as f:
        faixas = json.load(f)
    sr = 44100
    resultado = {"em": time.strftime("%Y-%m-%dT%H:%M:%S"), "segundos": args.segundos, "faixas": []}
    for faixa in faixas:
        t0 = time.time()
        base = os.path.splitext(os.path.basename(faixa["audio"]))[0]
        pronta = os.path.join(args.voz_de, base + ".voz.wav") if args.voz_de else None
        if pronta and os.path.exists(pronta):
            sr = 16000
            voz = decodificar(pronta, sr, args.segundos).mean(0)
        else:
            sr = 44100
            mix = decodificar(faixa["audio"], sr, args.segundos)
            voz = separar_voz(mix, sr)
        db = envoltoria_db(voz, sr)
        at = ataques(db)
        limite_ms = int(len(voz) / sr * 1000) - JANELA_BUSCA_MS
        if args.voz_em:
            os.makedirs(args.voz_em, exist_ok=True)
            destino = os.path.join(args.voz_em, os.path.splitext(os.path.basename(faixa["audio"]))[0] + ".voz.wav")
            subprocess.run(
                [FFMPEG, "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-ar", "16000", destino],
                input=voz.astype(np.float32).tobytes(),
                check=True,
            )
        item = {"nome": faixa["nome"], "ataques": len(at), "separacaoS": round(time.time() - t0), "alinhamentos": {}}
        for rotulo, caminho in (faixa.get("alinhamentos") or {}).items():
            with open(caminho, encoding="utf-8") as f:
                al = json.load(f)
            item["alinhamentos"][rotulo] = medir(al, at, limite_ms)
        resultado["faixas"].append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    with open(args.saida, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=1)
    # tabela para o README
    print("\n| faixa | alinhamento | linhas n | mediana | p25..p75 | ≤100 ms | antes da voz | palavras n | mediana | ≤100 ms |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for item in resultado["faixas"]:
        for rotulo, m in item["alinhamentos"].items():
            L, P = m["linhas"], m["palavras"]
            if not L.get("n") or not P.get("n"):
                print(f"| {item['nome']} | {rotulo} | sem pontos |")
                continue
            print(
                f"| {item['nome']} | {rotulo} | {L['n']} | {L['medianaMs']:+d} | {L['p25Ms']:+d}..{L['p75Ms']:+d} | "
                f"{int(L['dentroDe100ms']*100)}% | {int(L['antesDaVoz150ms']*100)}% | {P['n']} | {P['medianaMs']:+d} | {int(P['dentroDe100ms']*100)}% |"
            )


if __name__ == "__main__":
    sys.exit(main())
