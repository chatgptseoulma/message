# Re-enter the Supabase server key in Vercel, then redeploy.
$npm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'npm'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $npm + ';' + $env:Path
$vercel = Join-Path $npm 'vercel.cmd'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "Copy the Supabase SERVER key from this page (opening it now):" -ForegroundColor Cyan
Write-Host "  https://supabase.com/dashboard/project/fwpxfnbjwkzuglyrmraz/settings/api-keys"
Write-Host "  - 'Secret keys' section: starts with sb_secret_   (press the copy icon)"
Write-Host "  - or 'Legacy API keys' tab: 'service_role' key, starts with eyJ (long)"
Write-Host "  NOT the publishable/anon key, NOT the database password." -ForegroundColor Yellow
Write-Host "Paste with RIGHT-CLICK in this window, then press Enter." -ForegroundColor Yellow
Start-Process "https://supabase.com/dashboard/project/fwpxfnbjwkzuglyrmraz/settings/api-keys"

while ($true) {
    $s = Read-Host "`nSupabase server key (hidden)" -AsSecureString
    $key = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))).Trim()
    $head = $key.Substring(0, [Math]::Min(10, $key.Length))
    if ($key.StartsWith('sb_secret_') -and $key.Length -ge 40) { break }
    if ($key.StartsWith('eyJ') -and $key.Length -ge 150) { break }
    if ($key.StartsWith('sb_publishable_')) { Write-Host "That is the PUBLISHABLE key. Copy the SECRET key." -ForegroundColor Red }
    else { Write-Host "Not a Supabase server key (starts with '$($head.Substring(0, [Math]::Min(3, $head.Length)))...', length $($key.Length)). Try again." -ForegroundColor Red }
}
Write-Host "OK: key starts with $head... length $($key.Length)" -ForegroundColor Green
$key | & $vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force
Remove-Variable key, s

Write-Host "`n=== Redeploy ===" -ForegroundColor Cyan
& $vercel deploy --prod --yes *> deploy.log
if ($LASTEXITCODE -eq 0) { Write-Host "Done." -ForegroundColor Green } else { Write-Host "Deploy failed (deploy.log)." -ForegroundColor Red }
Read-Host "Press Enter to close"
