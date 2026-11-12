# Production first Executive (after the first release): invites production's first Executive and
# prints the set-password link here, in this window only (deploy.md section 4). Uses the addresses,
# certificate and sign-in secret set-production-secrets.ps1 kept in your vault. Close this window afterwards.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\invite-production-executive.ps1"
. (Join-Path $PSScriptRoot 'production-lib.ps1')
$vault = Get-Vault
foreach ($name in 'DATABASE_URL_MIGRATOR', 'DATABASE_URL_AUTH', 'BETTER_AUTH_SECRET', 'CA_CERT_FILE') {
  if ($null -eq (Get-VaultValue $vault $name)) { Fail "$name is not in the vault: run set-production-secrets.ps1 (database and sign-in secret) first." }
}
$cert = Get-VaultValue $vault 'CA_CERT_FILE'
if (-not (Test-Path -LiteralPath $cert)) { Fail "the certificate file $cert is no longer there." }
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = Join-Path $env:APPDATA 'npm\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $pnpm)) { Fail 'pnpm is not installed in your own PowerShell (tools/pc-setup/README.md step 2).' }

$email = (Read-Host 'Email address of the first Executive').Trim()
$name = (Read-Host 'Full name of the first Executive').Trim()
if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$' -or $name -eq '') { Fail 'type an email address and a name.' }

$env:DATABASE_URL_MIGRATOR = Get-VaultValue $vault 'DATABASE_URL_MIGRATOR'
$env:DATABASE_URL_AUTH = Get-VaultValue $vault 'DATABASE_URL_AUTH'
$env:BETTER_AUTH_SECRET = Get-VaultValue $vault 'BETTER_AUTH_SECRET'
$env:BETTER_AUTH_URL = 'https://shaktiprime.com'
$env:DATABASE_CA_CERT = [IO.File]::ReadAllText($cert)
Push-Location $Repo
try {
  & $pnpm --filter web invite-executive -- --email $email --name $name
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item Env:DATABASE_URL_MIGRATOR, Env:DATABASE_URL_AUTH, Env:BETTER_AUTH_SECRET, Env:BETTER_AUTH_URL, Env:DATABASE_CA_CERT -ErrorAction SilentlyContinue
}
if ($code -ne 0) { Fail 'no Executive was invited; copy the error line (not the link) into the chat.' }
Write-Host ''
Write-Host 'RESULT: the Executive is invited. Open the set-password link above (it lasts 24 hours), set a password, then enrol an authenticator app. Do not paste the link into the chat.' -ForegroundColor Green
Read-Host 'Press Enter to close'
