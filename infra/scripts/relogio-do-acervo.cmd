@echo off
rem O RELÓGIO DO ACERVO no PC (ver apps/importer/relogioDoAcervo.mjs): alinha a
rem letra ao áudio de cada faixa e publica em aurial-indice-musicas/alinhamentos.
rem Tarefa agendada do Windows "Radinho relogio do acervo" (infra/scripts/
rem relogio-do-acervo.ps1 cria): roda no logon, em prioridade baixa, e dorme
rem 30 min entre voltas. Log em D:\Aurial\relogio\relogio.log.
setlocal
set "PATH=C:\Users\vinicius\AppData\Local\Programs\ffmpeg\bin;%PATH%"
set "PYTHON_PATH=C:\Users\vinicius\AppData\Local\Programs\Python\Python311\python.exe"
set "RELOGIO_DIR=D:\Aurial\relogio"
if not exist "%RELOGIO_DIR%" mkdir "%RELOGIO_DIR%"
cd /d "%~dp0..\..\apps\importer"
node relogioDoAcervo.mjs --continuo >> "%RELOGIO_DIR%\relogio.log" 2>&1
