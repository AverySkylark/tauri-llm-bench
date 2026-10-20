@echo off
REM Launch Claude Code in this folder to build and run the benchmark harness.
cd /d "%~dp0"
where claude >nul 2>&1 || (echo Claude Code not found. Install in PowerShell: irm https://claude.ai/install.ps1 ^| iex & exit /b 1)
if not exist .git git init
claude --model opus "Read PROMPT.md and SPEC.md in this folder, then start Phase 0."
