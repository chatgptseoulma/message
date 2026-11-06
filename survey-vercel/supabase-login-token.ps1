# Supabase CLI login with a personal access token (no browser step needed).
# 1) Open https://supabase.com/dashboard/account/tokens  -> "Generate new token" -> copy it
# 2) Paste it below when asked (input is hidden). The token is saved by the Supabase CLI only.
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $env:Path
Set-Location $PSScriptRoot

$secure = Read-Host "Paste Supabase access token (sbp_...)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
npx supabase login --token $token
Remove-Variable token, secure

Write-Host "`n=== Check ===" -ForegroundColor Cyan
npx supabase projects list
Read-Host "`nPress Enter to close"
