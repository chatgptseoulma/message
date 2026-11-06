# Add the two secret environment variables to the Vercel project (Production).
#  1) SUPABASE_SERVICE_ROLE_KEY : Supabase dashboard > Project Settings > API Keys
#     -> "service_role" key (Legacy API keys tab) or a "Secret key" (sb_secret_...)
#  2) ADMIN_PASSWORD            : any password you choose for the results page
# Input is hidden and goes straight to Vercel.
$npm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'npm'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $npm + ';' + $env:Path
$vercel = Join-Path $npm 'vercel.cmd'
Set-Location $PSScriptRoot

function Read-Secret($prompt) {
    $s = Read-Host $prompt -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$key = Read-Secret "Supabase service_role / secret key (hidden)"
$key | & $vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force
Remove-Variable key

do {
    $pw = Read-Secret "New admin password for results page, 8+ chars (hidden)"
    $pw2 = Read-Secret "Type it again (hidden)"
    if ($pw -ne $pw2) { Write-Host "Passwords do not match. Try again." -ForegroundColor Yellow }
    elseif ($pw.Length -lt 8) { Write-Host "Too short. Use 8 or more characters." -ForegroundColor Yellow }
} until ($pw -eq $pw2 -and $pw.Length -ge 8)
$pw | & $vercel env add ADMIN_PASSWORD production --sensitive --force
Remove-Variable pw, pw2

Write-Host "`n=== Variables now set ===" -ForegroundColor Cyan
& $vercel env ls
Read-Host "`nPress Enter to close"
