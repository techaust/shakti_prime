# Production secrets: every secret production needs, in GitHub's `production` environment
# and in the Vercel project shakti-prime-production (docs/runbooks/deploy.md section 1 steps 4 d,
# 10 and 11). Every secret is typed into a hidden prompt or made here, checked where it can be,
# and never shown. Each part can be skipped, and running the script again is safe: passwords made
# on an earlier run are taken from your vault, not made again.
#
# Before running: the files stack and its access key (AWS), the deploy hook `release` (Vercel), a
# Vercel access token for the team shakti-prime, the CA certificate of the production project
# (Supabase, Project Settings, Database, SSL Configuration), and the production database password.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\set-production-secrets.ps1"
. (Join-Path $PSScriptRoot 'production-lib.ps1')
$vault = Get-Vault
Write-Host 'Production secrets: the secrets. Copy only RESULT or error lines into the chat.' -ForegroundColor Cyan

# --- Sign-ins for this run only ---------------------------------------------------------------
$vercelToken = Read-Hidden 'Paste the Vercel access token (vercel.com, Account Settings, Tokens; typing stays hidden)'
try {
  $p = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/$ProjectId`?teamId=$TeamId" -Headers @{ Authorization = "Bearer $vercelToken" }
} catch { Fail 'the Vercel token cannot open the project shakti-prime-production (choose the team shakti-prime when making it).' }
if ($p.name -ne 'shakti-prime-production') { Fail "the Vercel token opened $($p.name), not shakti-prime-production." }
Ok 'Vercel token opens shakti-prime-production'

$ghToken = Read-Hidden 'Paste your own GitHub token for this run, or just press Enter to use the GitHub sign-in already on this PC'
if ($ghToken -match '^(ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}$') { $env:GH_TOKEN = $ghToken }
elseif ($ghToken -ne '') { Write-Host '  (that is not a GitHub token, so the sign-in already on this PC is used)' }
& $Gh api "repos/$GhRepo/environments/production" --jq .name | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'GitHub: the environment production cannot be read with this sign-in.' }
Ok 'GitHub sign-in reads the environment production'

# --- 1. The database ----------------------------------------------------------------------------
if (Ask-Section '1. Database: GitHub secrets and the four Vercel addresses') {
  $defaultCert = Join-Path $env:USERPROFILE 'Downloads\prod-ca-2021.crt'
  $cert = Read-Host "Path of the production CA certificate (Enter for $defaultCert)"
  if ([string]::IsNullOrWhiteSpace($cert)) { $cert = $defaultCert }
  $cert = $cert.Trim('"', ' ')
  if (-not (Test-Path -LiteralPath $cert)) { Fail "no file at $cert - nothing was changed." }
  $caText = [IO.File]::ReadAllText($cert).Trim()
  if (-not $caText.StartsWith('-----BEGIN CERTIFICATE-----')) { Fail 'that file is not a PEM certificate - nothing was changed.' }

  $poolerHost = (Read-Host 'Session pooler host (Supabase, Connect, Session pooler; the part after @ and before :5432)').Trim()
  if ($poolerHost -notmatch '^aws-[0-9]+-ap-south-1\.pooler\.supabase\.com$') { Fail 'that is not a Mumbai pooler host like aws-1-ap-south-1.pooler.supabase.com - nothing was changed.' }

  $dbPassword = Read-Hidden 'Paste the production database password (typing stays hidden)'
  $migrator = "postgresql://postgres.$($ProjectRef):$([Uri]::EscapeDataString($dbPassword))@$($poolerHost):5432/postgres"
  $check = Test-Database $migrator $caText
  if ($null -eq $check) { Fail 'the database refused the sign-in (wrong password or host?) - nothing was changed.' }
  Ok "signed in to production as $($check.user); its public schema holds $($check.tables) tables"

  $roles = [ordered]@{ APP_USER_PASSWORD = 'app_user'; AUTH_SERVICE_PASSWORD = 'auth_service'; OUTBOX_PUBLISHER_PASSWORD = 'outbox_publisher'; APP_READER_PASSWORD = 'app_reader' }
  foreach ($name in $roles.Keys) {
    if ($null -eq (Get-VaultValue $vault $name)) { Set-VaultValue $vault $name (New-RandomSecret 32) }
  }
  Set-VaultValue $vault 'DATABASE_URL_MIGRATOR' $migrator
  Set-VaultValue $vault 'POOLER_HOST' $poolerHost
  Set-VaultValue $vault 'CA_CERT_FILE' $cert
  Ok "the four login passwords are made and kept in $VaultPath"

  Set-GhEnvSecret 'DATABASE_URL_MIGRATOR' $migrator
  Set-GhEnvSecret 'DATABASE_CA_CERT' $caText
  foreach ($name in $roles.Keys) { Set-GhEnvSecret $name (Get-VaultValue $vault $name) }

  # The app's pools use the transaction pooler (port 6543), each login with its own password.
  $urls = [ordered]@{ DATABASE_URL = 'APP_USER_PASSWORD'; DATABASE_URL_AUTH = 'AUTH_SERVICE_PASSWORD'; DATABASE_URL_OUTBOX = 'OUTBOX_PUBLISHER_PASSWORD'; DATABASE_URL_READER = 'APP_READER_PASSWORD' }
  foreach ($key in $urls.Keys) {
    $role = $roles[$urls[$key]]
    $url = "postgresql://$role.$($ProjectRef):$(Get-VaultValue $vault $urls[$key])@$($poolerHost):6543/postgres"
    Set-VaultValue $vault $key $url
    Set-VercelVar $vercelToken $key $url
  }
  Set-VercelVar $vercelToken 'DATABASE_CA_CERT' $caText
  $dbPassword = $null; $migrator = $null
}

# --- 2. The deploy hook ---------------------------------------------------------------------------
if (Ask-Section '2. The deploy hook (Vercel, shakti-prime-production, Settings, Git, Deploy Hooks, release)') {
  $hook = Read-Hidden 'Paste the deploy hook address (typing stays hidden)'
  if ($hook -notmatch "^https://api\.vercel\.com/v1/integrations/deploy/$ProjectId/[A-Za-z0-9]+(\?.*)?$") { Fail 'that is not a deploy hook of shakti-prime-production - nothing was changed.' }
  Set-GhEnvSecret 'VERCEL_DEPLOY_HOOK_PRODUCTION' $hook
  $hook = $null
}

# --- 3. The sign-in secret --------------------------------------------------------------------------
if (Ask-Section '3. The sign-in secret (made here)') {
  if ($null -eq (Get-VaultValue $vault 'BETTER_AUTH_SECRET')) { Set-VaultValue $vault 'BETTER_AUTH_SECRET' (New-RandomSecret 48) }
  Set-VercelVar $vercelToken 'BETTER_AUTH_SECRET' (Get-VaultValue $vault 'BETTER_AUTH_SECRET')
}

# --- 4. Turnstile -----------------------------------------------------------------------------------
if (Ask-Section '4. Turnstile (Cloudflare, Turnstile, the widget for shaktiprime.com)') {
  $site = Read-Hidden 'Paste the widget SITE key'
  $secret = Read-Hidden 'Paste the widget SECRET key'
  if ($site -notmatch '^0x[0-9A-Za-z_-]{10,}$' -or $secret -notmatch '^0x[0-9A-Za-z_-]{10,}$') { Fail 'those are not real Turnstile keys (they start with 0x; the 1x, 2x and 3x test keys are refused) - nothing was changed.' }
  Set-VercelVar $vercelToken 'TURNSTILE_SITE_KEY' $site $false
  Set-VercelVar $vercelToken 'TURNSTILE_SECRET_KEY' $secret
  $secret = $null
}

# --- 5. Redis -------------------------------------------------------------------------------------
if (Ask-Section '5. Redis (Upstash, Redis, shakti-prime-production, REST API section)') {
  $redisUrl = (Read-Host 'Paste UPSTASH_REDIS_REST_URL (the https address)').Trim()
  $redisToken = Read-Hidden 'Paste UPSTASH_REDIS_REST_TOKEN (the read-write one, not the read-only one)'
  if ($redisUrl -notmatch '^https://[a-z0-9-]+\.upstash\.io/?$') { Fail 'that is not an Upstash REST address - nothing was changed.' }
  $redisUrl = $redisUrl.TrimEnd('/')
  try { $pong = Invoke-RestMethod -Uri "$redisUrl/ping" -Headers @{ Authorization = "Bearer $redisToken" } } catch { Fail 'Redis refused the token - nothing was changed.' }
  if ($pong.result -ne 'PONG') { Fail 'Redis did not answer PONG - nothing was changed.' }
  try { $null = Invoke-RestMethod -Method Post -Uri "$redisUrl/set/secrets-check/1/EX/60" -Headers @{ Authorization = "Bearer $redisToken" } } catch { Fail 'that is the read-only token: paste the read-write one.' }
  Ok 'Redis answered and accepted a write'
  Set-VercelVar $vercelToken 'UPSTASH_REDIS_REST_URL' $redisUrl $false
  Set-VercelVar $vercelToken 'UPSTASH_REDIS_REST_TOKEN' $redisToken
  $redisToken = $null
}

# --- 6. QStash ------------------------------------------------------------------------------------
if (Ask-Section '6. QStash (Upstash, QStash, the same account as dev and staging)') {
  $qToken = Read-Hidden 'Paste QSTASH_TOKEN'
  $qCurrent = Read-Hidden 'Paste QSTASH_CURRENT_SIGNING_KEY'
  $qNext = Read-Hidden 'Paste QSTASH_NEXT_SIGNING_KEY'
  if ($qCurrent -notmatch '^sig_' -or $qNext -notmatch '^sig_') { Fail 'the signing keys start with sig_ - nothing was changed.' }
  # Dev and staging run on the account's EU (Frankfurt) region, which QStash's default address serves.
  $s = $null
  try { $s = Invoke-RestMethod -Uri 'https://qstash-eu-central-1.upstash.io/v2/schedules' -Headers @{ Authorization = "Bearer $qToken" } } catch { $s = $null }
  if ($null -eq $s) {
    $us = $false
    try { $null = Invoke-RestMethod -Uri 'https://qstash-us-east-1.upstash.io/v2/schedules' -Headers @{ Authorization = "Bearer $qToken" }; $us = $true } catch { $us = $false }
    if ($us) { Fail 'that is the token of the US East region. In the QStash page switch the region to EU Central (Frankfurt) and copy its token and both signing keys - nothing was changed.' }
    Fail 'QStash refused the token (check for a missing character or a space; copy it with the copy button) - nothing was changed.'
  }
  $ids = @($s | ForEach-Object { $_.scheduleId })
  if (-not ($ids | Where-Object { $_ -like '*-staging' })) { Fail 'that token opens a QStash account without the staging schedules: take the EU Central (Frankfurt) token of the account dev and staging use - nothing was changed.' }
  Ok "QStash token is the EU region's ($($ids.Count) schedules there)"
  Set-VaultValue $vault 'QSTASH_TOKEN' $qToken
  Set-VaultValue $vault 'QSTASH_CURRENT_SIGNING_KEY' $qCurrent
  Set-VaultValue $vault 'QSTASH_NEXT_SIGNING_KEY' $qNext
  Set-VercelVar $vercelToken 'QSTASH_TOKEN' $qToken
  Set-VercelVar $vercelToken 'QSTASH_CURRENT_SIGNING_KEY' $qCurrent
  Set-VercelVar $vercelToken 'QSTASH_NEXT_SIGNING_KEY' $qNext
  $qToken = $null; $qCurrent = $null; $qNext = $null
}

# --- 7. The files stack's access key ------------------------------------------------------------
if (Ask-Section '7. Files: the access key of the AWS user shakti-prime-production-app') {
  $keyId = Read-Hidden 'Paste the Access key ID'
  $keySecret = Read-Hidden 'Paste the Secret access key'
  if ($keyId -notmatch '^AKIA[0-9A-Z]{16}$' -or $keySecret.Length -ne 40) { Fail 'that is not an AWS access key pair - nothing was changed.' }
  if (Get-Command aws -ErrorAction SilentlyContinue) {
    $env:AWS_ACCESS_KEY_ID = $keyId; $env:AWS_SECRET_ACCESS_KEY = $keySecret
    $arn = ''
    try { $arn = (& aws sts get-caller-identity --query Arn --output text 2>&1 | Out-String).Trim() } catch { $arn = 'an unknown user (AWS refused the key)' }
    finally { Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue }
    if ($arn -notmatch ':user/shakti-prime-production-app$') { Fail "that key belongs to $arn, not the user shakti-prime-production-app - nothing was changed." }
    Ok 'the key belongs to shakti-prime-production-app'
  }
  Set-VercelVar $vercelToken 'AWS_ACCESS_KEY_ID' $keyId
  Set-VercelVar $vercelToken 'AWS_SECRET_ACCESS_KEY' $keySecret
  $keySecret = $null
}

# --- 8. Browser alerts --------------------------------------------------------------------------
if (Ask-Section '8. Browser alerts (a key pair made here)') {
  $subject = (Read-Host 'An email address the push services may write to about the alerts (for example your own)').Trim()
  if ($subject -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Fail 'that is not an email address - nothing was changed.' }
  $env:WP_PATH = Join-Path $Repo 'apps\web\node_modules\web-push'
  try { $json = & $Node -e "const w=require(process.env.WP_PATH);process.stdout.write(JSON.stringify(w.generateVAPIDKeys()))" }
  finally { Remove-Item Env:WP_PATH -ErrorAction SilentlyContinue }
  $keys = $json | ConvertFrom-Json
  if (-not $keys.publicKey -or -not $keys.privateKey) { Fail 'the alert keys could not be made - nothing was changed.' }
  Set-VercelVar $vercelToken 'VAPID_PUBLIC_KEY' $keys.publicKey $false
  Set-VercelVar $vercelToken 'VAPID_PRIVATE_KEY' $keys.privateKey
  Set-VercelVar $vercelToken 'VAPID_SUBJECT' "mailto:$subject" $false
  $keys = $null
}

# --- Read back ------------------------------------------------------------------------------------
Write-Host ''
Write-Host '== Read back ==' -ForegroundColor Cyan
$needed = 'BOS_ENVIRONMENT','BETTER_AUTH_SECRET','BETTER_AUTH_URL','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','MAILER','SES_FROM','DATABASE_URL','DATABASE_URL_AUTH','DATABASE_URL_OUTBOX','DATABASE_URL_READER','DATABASE_CA_CERT','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY','SENTRY_DSN','NEXT_PUBLIC_SENTRY_DSN','BACKUP_BUCKET','FILES_BUCKET','FILES_KMS_KEY_ID','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'
$have = Get-VercelVarNames $vercelToken
$missingVercel = @($needed | Where-Object { $have -notcontains $_ })
$ghHave = @(& $Gh secret list --env production --repo $GhRepo --json name --jq '.[].name')
$ghNeeded = 'DATABASE_URL_MIGRATOR','APP_USER_PASSWORD','AUTH_SERVICE_PASSWORD','OUTBOX_PUBLISHER_PASSWORD','DATABASE_CA_CERT','APP_READER_PASSWORD','VERCEL_DEPLOY_HOOK_PRODUCTION'
$missingGh = @($ghNeeded | Where-Object { $ghHave -notcontains $_ })
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
$vercelToken = $null

if ($missingVercel.Count -eq 0 -and $missingGh.Count -eq 0) {
  Write-Host 'RESULT: all 7 GitHub secrets and all 27 Vercel variables of production are set.' -ForegroundColor Green
} else {
  Write-Host "RESULT: still missing - GitHub: $($missingGh -join ', '); Vercel: $($missingVercel -join ', ')" -ForegroundColor Yellow
}
Read-Host 'Press Enter to close'
