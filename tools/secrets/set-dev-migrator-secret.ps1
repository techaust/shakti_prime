# Builds the dev migrator address from the dev database password, checks Supabase accepts it,
# and stores it as the GitHub secret DATABASE_URL_MIGRATOR_DEV. Shows no password.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\set-dev-migrator-secret.ps1"
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$node = 'C:\Program Files\nodejs\node.exe'
$gh   = 'C:\Program Files\GitHub CLI\gh.exe'
$cert = Join-Path $env:USERPROFILE 'Downloads\prod-ca-2021.crt'
$pg   = Join-Path $repo 'packages\db\node_modules\postgres\src\index.js'

$s = Read-Host 'Paste the dev database password from your password manager (typing stays hidden)' -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
$url = "postgresql://postgres.pgjwtygifnwxdkzdjsup:$([uri]::EscapeDataString($pw))@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
$pw = $null

$env:TEST_DB_URL = $url
$env:TEST_DB_CA = Get-Content -Raw $cert
$env:TEST_PG = ([uri]$pg).AbsoluteUri
$js = @'
const { default: postgres } = await import(process.env.TEST_PG);
const sql = postgres(process.env.TEST_DB_URL, { ssl: { ca: process.env.TEST_DB_CA }, max: 1, connect_timeout: 15 });
try { await sql`select 1`; console.log('ok'); } catch (e) { console.log('refused (' + (e.code || e.message) + ')'); }
finally { await sql.end({ timeout: 2 }); }
'@
$check = & $node --input-type=module -e $js
Remove-Item Env:TEST_DB_URL, Env:TEST_DB_CA, Env:TEST_PG -ErrorAction SilentlyContinue

if ($check -ne 'ok') {
  Write-Host "RESULT: Supabase $check - nothing was saved to GitHub." -ForegroundColor Red
} else {
  & $gh secret set DATABASE_URL_MIGRATOR_DEV --repo techaust/shakti_prime --body $url
  if ($LASTEXITCODE -eq 0) { Write-Host 'RESULT: password accepted and saved to GitHub as DATABASE_URL_MIGRATOR_DEV' -ForegroundColor Green }
  else { Write-Host 'RESULT: password accepted, but saving to GitHub failed' -ForegroundColor Red }
}
$url = $null
Read-Host 'Press Enter to close'
