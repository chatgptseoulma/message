# Create the survey table in the linked Supabase project (link is already done).
# The DB password is the one set when the project was created.
# Forgot it? Supabase dashboard > Project Settings > Database > Reset database password.
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $env:Path
Set-Location $PSScriptRoot

$secure = Read-Host "Supabase DB password (hidden)" -AsSecureString
$env:SUPABASE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Write-Host "`n=== Create table (db push) ===" -ForegroundColor Cyan
# Output is also saved to push.log (no password in it) so Claude can read the error.
npx supabase db push --remote --yes 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath push.log
$code = $LASTEXITCODE
Remove-Item Env:SUPABASE_DB_PASSWORD
"exit code: $code" | Add-Content push.log
if ($code -eq 0) { Write-Host "`nDone." -ForegroundColor Green } else { Write-Host "`nFailed (see message above)." -ForegroundColor Red }
Read-Host "Press Enter to close"
