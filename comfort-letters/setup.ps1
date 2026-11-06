# One-time setup for comfort-letters:
#  1) link this folder to the Supabase project and create the cb_* tables (needs the DB password)
#  2) copy the Supabase server key into Vercel via the Supabase CLI (never shown on screen)
# Result is written to setup.log (no secrets) so Claude can check it.
$npm = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'npm'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $npm + ';' + $env:Path
$vercel = Join-Path $npm 'vercel.cmd'
Set-Location $PSScriptRoot
$ref = 'fwpxfnbjwkzuglyrmraz'
Remove-Item setup.log -ErrorAction SilentlyContinue
function Log($m) { $m | Add-Content setup.log; Write-Host $m }
function Fail($m) { Log "FAIL: $m"; Write-Host $m -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

Write-Host "Supabase DB password (same one you used for the survey)." -ForegroundColor Cyan
$s = Read-Host "DB password (hidden)" -AsSecureString
$env:SUPABASE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
Remove-Variable s

Write-Host "`n=== 1/3 Link project ===" -ForegroundColor Cyan
npx supabase link --project-ref $ref 2>&1 | ForEach-Object { "$_" } | Tee-Object -Variable out | Write-Host
if ($LASTEXITCODE -ne 0) { Remove-Item Env:SUPABASE_DB_PASSWORD; Fail "link failed: $($out | Select-Object -Last 2)" }

Write-Host "`n=== 2/3 Create tables ===" -ForegroundColor Cyan
npx supabase db push --remote --yes 2>&1 | ForEach-Object { "$_" } | Tee-Object -Variable out | Write-Host
$code = $LASTEXITCODE
Remove-Item Env:SUPABASE_DB_PASSWORD
if ($code -ne 0) { Fail "db push failed: $($out | Select-Object -Last 3)" }
Log "tables: OK"

Write-Host "`n=== 3/3 Server key -> Vercel ===" -ForegroundColor Cyan
$raw = (npx supabase projects api-keys --project-ref $ref --reveal -o json 2>$null) -join "`n"
if (-not $raw) { $raw = (npx supabase projects api-keys --project-ref $ref -o json 2>$null) -join "`n" }
try { $data = $raw | ConvertFrom-Json } catch { Fail "could not read keys from Supabase CLI" }
$list = @($data); if ($data.PSObject.Properties.Name -contains 'keys') { $list = @($data.keys) }
$pick = $list | Where-Object { $_.type -eq 'secret' -and $_.api_key -like 'sb_secret_*' -and $_.api_key -notmatch '\*' } | Select-Object -First 1
if (-not $pick) { $pick = $list | Where-Object { $_.name -eq 'service_role' -and $_.api_key -like 'eyJ*' } | Select-Object -First 1 }
if (-not $pick) { Fail "no usable server key returned" }
$pick.api_key.Trim() | & $vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "vercel env add failed" }
Remove-Variable pick, list, data, raw
Log "key: OK"
Write-Host "`nDone." -ForegroundColor Green
Read-Host "Press Enter to close"
