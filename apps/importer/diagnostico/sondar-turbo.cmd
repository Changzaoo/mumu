@echo off
cd /d "%~dp0..\"
set SONDA_MODELOS=large-v3-turbo,small
node diagnostico\sondarTranscricao.mjs %* > diagnostico\resultado-sonda-turbo.log 2>&1
