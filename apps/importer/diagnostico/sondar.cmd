@echo off
cd /d "%~dp0..\"
echo Sondando transcricao (NVIDIA + whisper local)... pode levar alguns minutos.
node diagnostico\sondarTranscricao.mjs %* > diagnostico\resultado-sonda.log 2>&1
echo Pronto. Resultado em diagnostico\resultado-sonda.log
