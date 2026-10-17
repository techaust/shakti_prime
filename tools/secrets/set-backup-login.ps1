# Gives production's backup login, app_backup, a new password and puts its address in AWS Secrets
# Manager as shakti-prime-production-backup-database, which only the backup's CodeBuild project
# reads (docs/runbooks/deploy.md section 1 step 4, section 5). The password is made by the script
# and never shown; the database receives only its verifier. Shows no password and writes none
# to a file: the script signs its one call to Secrets Manager itself, with the credentials of
# the AWS command line (aws configure export-credentials), and no other program it starts
# receives the database password.
#
# Before running: the stack shakti-prime-production-backups exists, the first release has run (it
# makes app_backup), the AWS command line (version 2) is installed and signed in with
# `aws login` as the account's administrator, and Supabase's CA certificate is downloaded.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\set-backup-login.ps1"
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$script = Join-Path $repo 'packages\db\src\backup-login.ts'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Host 'RESULT: the AWS command line is not installed (docs/runbooks/deploy.md section 1 step 4).' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$defaultCert = Join-Path $env:USERPROFILE 'Downloads\prod-ca-2021.crt'
$cert = Read-Host "Path of the production project's CA certificate (Enter for $defaultCert)"
if ([string]::IsNullOrWhiteSpace($cert)) { $cert = $defaultCert }
if (-not (Test-Path -LiteralPath $cert)) {
  Write-Host "RESULT: no file at $cert - nothing was changed." -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
$poolerHost = Read-Host 'Session pooler host of the production project (Supabase, Connect, Session pooler; for example aws-1-ap-south-1.pooler.supabase.com)'

$s = Read-Host 'Paste the production database password from your password manager (typing stays hidden)' -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$env:PRODUCTION_DATABASE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
$env:POOLER_HOST = $poolerHost.Trim()
$env:CA_CERT_FILE = $cert

try {
  & $node $script
} finally {
  Remove-Item Env:PRODUCTION_DATABASE_PASSWORD, Env:POOLER_HOST, Env:CA_CERT_FILE -ErrorAction SilentlyContinue
}
Read-Host 'Press Enter to close'
