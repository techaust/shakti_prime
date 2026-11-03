# Checks whether Supabase accepts a dev database password, without showing it.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\test-dev-db-password.ps1"
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$node = 'C:\Program Files\nodejs\node.exe'
$cert = Join-Path $env:USERPROFILE 'Downloads\prod-ca-2021.crt'
$pg   = Join-Path $repo 'packages\db\node_modules\postgres\src\index.js'

$s = Read-Host 'Paste the dev database password from your password manager (typing stays hidden)' -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)

$env:TEST_DB_URL = "postgresql://postgres.pgjwtygifnwxdkzdjsup:$([uri]::EscapeDataString($pw))@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
$env:TEST_DB_CA = Get-Content -Raw $cert
$env:TEST_PG = ([uri]$pg).AbsoluteUri
$pw = $null

$js = @'
const { default: postgres } = await import(process.env.TEST_PG);
const sql = postgres(process.env.TEST_DB_URL, { ssl: { ca: process.env.TEST_DB_CA }, max: 1, connect_timeout: 15 });
try { await sql`select 1`; console.log('RESULT: Supabase ACCEPTS this password'); }
catch (e) { console.log('RESULT: refused (' + (e.code || e.message) + ')'); }
finally { await sql.end({ timeout: 2 }); }
'@
& $node --input-type=module -e $js
Remove-Item Env:TEST_DB_URL, Env:TEST_DB_CA, Env:TEST_PG -ErrorAction SilentlyContinue
Read-Host 'Press Enter to close'
