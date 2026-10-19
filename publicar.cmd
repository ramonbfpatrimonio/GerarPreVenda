@echo off
rem ==================================================================
rem  Gerar Pré-Venda - publicar uma versão nova
rem  Uso: dê dois cliques, ou no cmd:  publicar.cmd  [patch|minor|major]
rem   1. guarda as alterações no Git
rem   2. sobe a versão (1.2.6 -> 1.2.7) e cria a tag
rem   3. envia para o GitHub, que gera o instalador e publica sozinho
rem ==================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set TIPO=%1
if "%TIPO%"=="" set TIPO=patch

git rev-parse --is-inside-work-tree >nul 2>&1 || (echo Esta pasta ainda nao esta ligada ao Git. Veja o LEIAME, secao "Publicar pelo GitHub". & pause & exit /b 1)

echo.
echo Conferindo o codigo...
call npm run typecheck || (echo Corrija os erros acima antes de publicar. & pause & exit /b 1)
call npm test || (echo Os testes falharam. & pause & exit /b 1)

git add -A
git diff --cached --quiet || git commit -m "Alterações para a próxima versão"

call npm version %TIPO% -m "Versão %%s" || (pause & exit /b 1)

git push origin HEAD --follow-tags || (echo Nao foi possivel enviar para o GitHub. & pause & exit /b 1)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSAO=%%v
echo.
echo ============================================================
echo  Versao %VERSAO% enviada.
echo  O GitHub esta gerando o instalador (leva uns 5 minutos):
echo  https://github.com/ramonbfpatrimonio/gerar-pre-venda/actions
echo  Depois, os computadores atualizam sozinhos.
echo ============================================================
pause
