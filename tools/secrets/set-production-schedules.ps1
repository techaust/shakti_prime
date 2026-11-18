# Production schedules (after the first release): the eight QStash schedules of production,
# each named <id>-production and calling https://shaktiprime.com/api/v1/workers/... (deploy.md
# section 2 step 6). Uses the QStash token and signing keys set-production-secrets.ps1 kept in your vault.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\set-production-schedules.ps1"
. (Join-Path $PSScriptRoot 'production-lib.ps1')
$vault = Get-Vault
foreach ($name in 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY') {
  if ($null -eq (Get-VaultValue $vault $name)) { Fail "$name is not in the vault: run set-production-secrets.ps1 (QStash) first." }
}
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = Join-Path $env:APPDATA 'npm\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $pnpm)) { Fail 'pnpm is not installed in your own PowerShell (tools/pc-setup/README.md step 2).' }

$env:QSTASH_TOKEN = Get-VaultValue $vault 'QSTASH_TOKEN'
$env:QSTASH_CURRENT_SIGNING_KEY = Get-VaultValue $vault 'QSTASH_CURRENT_SIGNING_KEY'
$env:QSTASH_NEXT_SIGNING_KEY = Get-VaultValue $vault 'QSTASH_NEXT_SIGNING_KEY'
# The account's EU region, where dev's and staging's schedules live. Set explicitly: the local .env
# holds an empty QSTASH_URL, which the QStash library would otherwise take as its address.
$env:QSTASH_URL = 'https://qstash-eu-central-1.upstash.io'
$env:BOS_ENVIRONMENT = 'production'
$env:BETTER_AUTH_URL = 'https://shaktiprime.com'
Push-Location $Repo
try {
  & $pnpm --filter web qstash-schedule
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item Env:QSTASH_TOKEN, Env:QSTASH_CURRENT_SIGNING_KEY, Env:QSTASH_NEXT_SIGNING_KEY, Env:QSTASH_URL, Env:BOS_ENVIRONMENT, Env:BETTER_AUTH_URL -ErrorAction SilentlyContinue
}
if ($code -ne 0) { Fail 'the schedules were not all made; copy the lines above (they hold no secret) into the chat.' }
Write-Host 'RESULT: the production schedules are made (the lines above list them).' -ForegroundColor Green
Read-Host 'Press Enter to close'
