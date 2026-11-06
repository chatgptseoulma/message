# Apply new DB migrations for comfort-letters (needs the Supabase DB password).
# Result is written to migrate.log (no secrets) so Claude can check it.
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $env:Path
Set-Location $PSScriptRoot
Remove-Item migrate.log -ErrorAction SilentlyContinue

Write-Host "Supabase DB password (same one as before)." -ForegroundColor Cyan
$s = Read-Host "DB password (hidden)" -AsSecureString
$env:SUPABASE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
Remove-Variable s

Write-Host "`n=== Apply migrations ===" -ForegroundColor Cyan
npx supabase db push --remote --yes 2>&1 | ForEach-Object { "$_" } | Tee-Object -Variable out | Write-Host
$code = $LASTEXITCODE
Remove-Item Env:SUPABASE_DB_PASSWORD
$out | Set-Content migrate.log
"exit code: $code" | Add-Content migrate.log
if ($code -eq 0) { Write-Host "`nDone." -ForegroundColor Green } else { Write-Host "`nFailed (see above)." -ForegroundColor Red }
Read-Host "Press Enter to close"
