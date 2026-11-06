# 전체 회귀 테스트 실행: powershell -ExecutionPolicy Bypass -File C:\2026CC\tests\run-all.ps1
# 리팩토링 전/후 모두 이 스크립트가 0으로 끝나야 한다.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$failed = @()

Write-Host "=== [1/2] Python: survey/ ===" -ForegroundColor Cyan
python -m unittest discover -s "$here\survey_py" -t "$here\survey_py"
if ($LASTEXITCODE -ne 0) { $failed += "python(survey)" }

Write-Host "=== [2/2] Node: survey-vercel, comfort-letters, HTML apps ===" -ForegroundColor Cyan
Push-Location "$here\node"
if (-not (Test-Path node_modules)) { npm install --silent }
npm test --silent
if ($LASTEXITCODE -ne 0) { $failed += "node" }
Pop-Location

if ($failed.Count) { Write-Host "FAILED: $($failed -join ', ')" -ForegroundColor Red; exit 1 }
Write-Host "ALL PASSED" -ForegroundColor Green; exit 0
