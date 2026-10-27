#!/bin/bash
# Invólucro do yt-dlp para o importador no vnmax (instalado em /home/v/aurial/yt-dlp.sh).
# 1) O importador chama o yt-dlp com --ignore-config, e é o ~/.config/yt-dlp/config
#    do servidor que liga "--js-runtimes node" — sem ele o YouTube responde 403 nos
#    bytes (desafio JS "n" não resolvido). Injetado aqui, explícito.
# 2) O importador engole o stderr do yt-dlp ("Não foi possível baixar desse link");
#    fica uma cópia em ytdlp-stderr.log (truncado ao passar de 5 MB).
LOG=/home/v/aurial/ytdlp-stderr.log
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5000000 ] && : > "$LOG"
{ printf "=== %s CMD:" "$(date "+%F %T")"; printf " %q" "$@"; echo; } >> "$LOG"
exec /home/v/.local/bin/yt-dlp --js-runtimes node "$@" 2> >(tee -a "$LOG" >&2)
