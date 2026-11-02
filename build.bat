@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Нужен Node.js: https://nodejs.org & pause & exit /b 1)
set NEED_INSTALL=
if not exist node_modules\electron-builder set NEED_INSTALL=1
if not exist node_modules\rcedit set NEED_INSTALL=1
if defined NEED_INSTALL (
  echo Устанавливаю зависимости...
  call npm install || (pause & exit /b 1)
)
echo Собираю NoteApp...
call npm run dist
if errorlevel 1 (
  echo.
  echo Сборка завершилась с ошибкой.
  pause
  exit /b 1
)
echo.
echo Готово: exe-файл лежит в папке dist
start "" "%~dp0dist"
pause
