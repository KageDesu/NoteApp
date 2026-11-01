@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Нужен Node.js: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install || (pause & exit /b 1)
)
call npm start
