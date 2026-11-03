# Builds the dev DATABASE_URL_AUTH from the auth_service password, checks Supabase accepts it,
# and puts it on the clipboard for Vercel. Shows no password.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\copy-dev-auth-url.ps1"
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$node = 'C:\Program Files\nodejs\node.exe'
$cert = Join-Path $env:USERPROFILE 'Downloads\prod-ca-2021.crt'
$pg   = Join-Path $repo 'packages\db\node_modules\postgres\src\index.js'

$s = Read-Host 'Paste the dev auth_service password from your password manager (typing stays hidden)' -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
$url = "postgresql://auth_service.pgjwtygifnwxdkzdjsup:$([uri]::EscapeDataString($pw))@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
$pw = $null

$env:TEST_DB_URL = $url
$env:TEST_DB_CA = Get-Content -Raw $cert
$env:TEST_PG = ([uri]$pg).AbsoluteUri
$js = @'
const { default: postgres } = await import(process.env.TEST_PG);
const sql = postgres(process.env.TEST_DB_URL, { ssl: { ca: process.env.TEST_DB_CA }, max: 1, prepare: false, connect_timeout: 15 });
try { await sql`select 1`; console.log('ok'); } catch (e) { console.log('refused (' + (e.code || e.message) + ')'); }
finally { await sql.end({ timeout: 2 }); }
'@
$check = & $node --input-type=module -e $js
Remove-Item Env:TEST_DB_URL, Env:TEST_DB_CA, Env:TEST_PG -ErrorAction SilentlyContinue

if ($check -eq 'ok') {
  Set-Clipboard -Value $url
  Write-Host 'RESULT: password accepted; the full DATABASE_URL_AUTH value is on your clipboard' -ForegroundColor Green
} else {
  Write-Host "RESULT: Supabase $check - nothing was copied." -ForegroundColor Red
}
$url = $null
Read-Host 'Press Enter to close'
