# Creates the first Executive on the DEV site (DEPLOY.md section 4), without pnpm.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\invite-dev-executive.ps1"
# It asks for the passwords with hidden typing, prints no password, and clears them at the end.

$ErrorActionPreference = 'Stop'
$repo  = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$node  = 'C:\Program Files\nodejs\node.exe'
$tsx   = Join-Path $repo 'apps\web\node_modules\tsx\dist\cli.mjs'
$cert  = Join-Path $env:USERPROFILE 'Downloads\prod-ca-2021.crt'
$ref   = 'pgjwtygifnwxdkzdjsup'
$pool  = 'aws-0-ap-south-1.pooler.supabase.com'

function Fail($msg) { Write-Host ''; Write-Host "STOPPED: $msg" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function Plain($secure) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Write-Host '== Checking this PC' -ForegroundColor Cyan
if (-not (Test-Path $node)) { Fail "Node is not at $node" }
if (-not (Test-Path $tsx))  { Fail 'The project tools are missing (apps\web\node_modules\tsx)' }
if (-not (Test-Path $cert)) { Fail "The certificate is not at $cert" }
Write-Host 'Node, project tools and certificate: found' -ForegroundColor Green

Write-Host ''
Write-Host '== Step 1 of 3: a new dev auth secret' -ForegroundColor Cyan
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$authSecret = ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
Set-Clipboard -Value $authSecret
Write-Host 'A new secret is now on your clipboard (not shown here). Do this now:'
Write-Host '  a. Paste it into your password manager as the new DEV auth secret.'
Write-Host '  b. vercel.com > project shakti-prime-dev > Settings > Environment Variables'
Write-Host '     > BETTER_AUTH_SECRET > Edit > paste over the old value > Save.'
Write-Host '  c. Deployments > the top one > the three dots > Redeploy. Wait until it says Ready.'
Read-Host 'Press Enter when the redeploy says Ready'

Write-Host ''
Write-Host '== Step 2 of 3: the two dev database passwords (typing stays hidden)' -ForegroundColor Cyan
$dbPass   = Plain (Read-Host 'Dev database password (the postgres one)' -AsSecureString)
$authPass = Plain (Read-Host 'Dev auth_service password' -AsSecureString)
if (-not $dbPass -or -not $authPass) { Fail 'A password was empty' }
$email = Read-Host 'Your email for the dev Executive'
$name = Read-Host 'Your name as it should appear'
if (-not $email -or -not $name) { Fail 'The email or the name was empty' }

$env:DATABASE_URL_MIGRATOR = "postgresql://postgres.${ref}:$([uri]::EscapeDataString($dbPass))@${pool}:5432/postgres"
$env:DATABASE_URL_AUTH     = "postgresql://auth_service.${ref}:$([uri]::EscapeDataString($authPass))@${pool}:6543/postgres"
$env:BETTER_AUTH_URL       = 'https://shakti-prime-dev.vercel.app'
$env:BETTER_AUTH_SECRET    = $authSecret
$env:DATABASE_CA_CERT      = Get-Content -Raw $cert

Write-Host ''
Write-Host '== Step 3 of 3: creating the Executive on dev' -ForegroundColor Cyan
Set-Location (Join-Path $repo 'apps\web')
$ErrorActionPreference = 'Continue'
& $node $tsx scripts\invite-executive.ts --email $email --name $name
$code = $LASTEXITCODE

foreach ($v in 'DATABASE_URL_MIGRATOR','DATABASE_URL_AUTH','BETTER_AUTH_SECRET','DATABASE_CA_CERT','BETTER_AUTH_URL') { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
$dbPass = $null; $authPass = $null; $authSecret = $null
Set-Clipboard -Value ' '

Write-Host ''
if ($code -eq 0) {
  Write-Host 'DONE. Open the link printed above (it lasts 24 hours), set your password, then add the dev site to your authenticator app.' -ForegroundColor Green
} else {
  Write-Host 'It did not finish. Copy only the red error lines above to Claude (they contain no passwords).' -ForegroundColor Red
}
Read-Host 'Press Enter to close'
