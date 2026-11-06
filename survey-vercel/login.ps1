# Vercel / Supabase CLI login. Run in a normal PowerShell window:
#   powershell -ExecutionPolicy Bypass -File C:\2026CC\survey-vercel\login.ps1
# Press Enter when asked, then approve in the browser window that opens.
$npm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'npm'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $npm
Set-Location $PSScriptRoot

Write-Host "`n=== 1/2 Supabase login ===" -ForegroundColor Cyan
npx supabase login

Write-Host "`n=== 2/2 Vercel login ===" -ForegroundColor Cyan
& (Join-Path $npm 'vercel.cmd') login

Write-Host "`n=== Check ===" -ForegroundColor Cyan
& (Join-Path $npm 'vercel.cmd') whoami
npx supabase projects list
Write-Host "`nDone. You can close this window." -ForegroundColor Green
Read-Host "Press Enter to close"
