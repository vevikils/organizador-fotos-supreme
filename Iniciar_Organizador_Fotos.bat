@echo off
title Organizador Supremo de Fotos
cd /d "%~dp0"

if exist "%~dp0Organizador_Fotos.exe" (
    start "" "%~dp0Organizador_Fotos.exe"
    exit
)

node "%~dp0node_modules\electron\cli.js" "%~dp0."
if %errorlevel% neq 0 (
    echo.
    echo Error al iniciar la aplicacion.
    pause
)
