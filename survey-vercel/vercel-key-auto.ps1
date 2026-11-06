# Copy the Supabase server key straight from the Supabase CLI into Vercel (no copy/paste needed),
# then redeploy. The key is never printed on screen.
$npm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'npm'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $npm + ';' + $env:Path
$vercel = Join-Path $npm 'vercel.cmd'
Set-Location $PSScriptRoot
$ref = 'fwpxfnbjwkzuglyrmraz'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; "FAIL: $msg" | Set-Content keyauto.log; Read-Host "Press Enter to close"; exit 1 }

Write-Host "Reading API keys from Supabase..." -ForegroundColor Cyan
$raw = (npx supabase projects api-keys --project-ref $ref --reveal -o json 2>$null) -join "`n"
if (-not $raw) { $raw = (npx supabase projects api-keys --project-ref $ref -o json 2>$null) -join "`n" }
try { $data = $raw | ConvertFrom-Json } catch { Fail "Could not read keys from Supabase CLI (token may be read-only or expired)." }
$list = @($data); if ($data.PSObject.Properties.Name -contains 'keys') { $list = @($data.keys) }

$pick = $list | Where-Object { $_.type -eq 'secret' -and $_.api_key -like 'sb_secret_*' -and $_.api_key -notmatch '\*' } | Select-Object -First 1
if (-not $pick) { $pick = $list | Where-Object { $_.name -eq 'service_role' -and $_.api_key -like 'eyJ*' } | Select-Object -First 1 }
if (-not $pick) {
    $names = ($list | ForEach-Object { "$($_.name)/$($_.type)" }) -join ', '
    Fail "No usable server key returned (found: $names). The CLI token may not be allowed to read secret keys."
}
$key = $pick.api_key.Trim()
Write-Host ("Found key '" + $pick.name + "' (" + $key.Substring(0, 10) + "..., length " + $key.Length + ")") -ForegroundColor Green
$key | & $vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force
Remove-Variable key, pick, list, data, raw

Write-Host "`n=== Redeploy ===" -ForegroundColor Cyan
& $vercel deploy --prod --yes *> deploy.log
if ($LASTEXITCODE -eq 0) { "OK" | Set-Content keyauto.log; Write-Host "Done." -ForegroundColor Green } else { Fail "Deploy failed (deploy.log)." }
Read-Host "Press Enter to close"
