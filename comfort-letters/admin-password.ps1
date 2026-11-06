# Set the comfort-letters admin password (used by the /admin page) in Vercel. Input is hidden.
# The password is sent straight to Vercel as a sensitive production variable; it is never printed or saved here.
$npm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'npm'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $npm + ';' + $env:Path
$vercel = Join-Path $npm 'vercel.cmd'
Set-Location $PSScriptRoot
Remove-Item admin-password.log -ErrorAction SilentlyContinue

function Read-Secret($prompt) {
    $s = Read-Host $prompt -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
Write-Host "Choose a NEW admin password for the comfort-letters admin page (12+ characters)." -ForegroundColor Cyan
do {
    $pw = Read-Secret "Admin password (hidden)"
    $pw2 = Read-Secret "Type it again (hidden)"
    if ($pw -ne $pw2) { Write-Host "Passwords do not match. Try again." -ForegroundColor Yellow }
    elseif ($pw.Length -lt 12) { Write-Host "Too short. Use 12 or more characters." -ForegroundColor Yellow }
} until ($pw -eq $pw2 -and $pw.Length -ge 12)
$pw | & $vercel env add ADMIN_PASSWORD production --sensitive --force | Out-Null
$code = $LASTEXITCODE
Remove-Variable pw, pw2
if ($code -eq 0) { "ADMIN_PASSWORD: OK" | Set-Content admin-password.log; Write-Host "Done." -ForegroundColor Green }
else { "ADMIN_PASSWORD: FAIL" | Set-Content admin-password.log; Write-Host "Failed." -ForegroundColor Red }
Read-Host "Press Enter to close"
