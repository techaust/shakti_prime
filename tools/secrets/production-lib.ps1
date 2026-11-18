# Shared helpers for the production secret scripts in this folder (docs/runbooks/deploy.md). Nothing here holds a secret.
# The vault is a file in your Documents folder that only your Windows account can open (Windows
# DPAPI): the generated passwords and keys are kept there so the later scripts (schedules, first
# Executive) and rotations can reuse them without anyone seeing them.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Global:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Global:Node = 'C:\Program Files\nodejs\node.exe'
$Global:Gh = 'C:\Program Files\GitHub CLI\gh.exe'
$Global:VaultPath = Join-Path $env:USERPROFILE 'Documents\shakti-production.vault.xml'
$Global:TeamId = 'team_WNM0TJNbuFp0UhG7dPDf6YAR'
$Global:ProjectId = 'prj_J0wD6i440swDiBdLjwdq6W3TIuk7'
$Global:ProjectRef = 'ifnoytyhnedgiyhxxhhu'
$Global:GhRepo = 'techaust/shakti_prime'

function Read-Hidden([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

function Get-Vault {
  if (Test-Path -LiteralPath $Global:VaultPath) { return Import-Clixml -LiteralPath $Global:VaultPath }
  return @{}
}

function Save-Vault($vault) { $vault | Export-Clixml -LiteralPath $Global:VaultPath }

function Set-VaultValue($vault, [string]$name, [string]$value) {
  $vault[$name] = ConvertTo-SecureString -String $value -AsPlainText -Force
  Save-Vault $vault
}

function Get-VaultValue($vault, [string]$name) {
  if (-not $vault.ContainsKey($name)) { return $null }
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($vault[$name])
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

function New-RandomSecret([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Fail([string]$message) {
  Write-Host "RESULT: $message" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

function Ok([string]$message) { Write-Host "  done: $message" -ForegroundColor Green }

function Ask-Section([string]$title) {
  Write-Host ''
  Write-Host "== $title ==" -ForegroundColor Cyan
  $answer = Read-Host 'Press Enter to do this part now, or type s and Enter to skip it'
  return ($answer.Trim().ToLower() -ne 's')
}

# One Vercel variable on the production project, Production target, replacing any earlier value.
function Set-VercelVar([string]$token, [string]$key, [string]$value, [bool]$sensitive = $true) {
  $type = 'plain'
  if ($sensitive) { $type = 'sensitive' }
  $body = @{ key = $key; value = $value; type = $type; target = @('production') } | ConvertTo-Json -Compress
  $uri = "https://api.vercel.com/v10/projects/$($Global:ProjectId)/env?upsert=true&teamId=$($Global:TeamId)"
  try {
    Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $token" } `
      -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  } catch {
    Fail "Vercel refused $key ($($_.Exception.Message)). Nothing else in this part was changed after it."
  }
  Ok "Vercel $key"
}

function Get-VercelVarNames([string]$token) {
  $uri = "https://api.vercel.com/v10/projects/$($Global:ProjectId)/env?teamId=$($Global:TeamId)"
  $r = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Authorization = "Bearer $token" }
  return @($r.envs | Where-Object { $_.target -contains 'production' } | ForEach-Object { $_.key })
}

# One secret of the GitHub environment `production`. gh reads GH_TOKEN when it is set.
function Set-GhEnvSecret([string]$name, [string]$value) {
  & $Global:Gh secret set $name --env production --repo $Global:GhRepo "--body=$value" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "GitHub refused the secret $name. Check the token can write environment secrets." }
  Ok "GitHub production secret $name"
}

# Signs in to a database through the pooler with the certificate checked; returns the user name.
function Test-Database([string]$url, [string]$caText) {
  $env:SIGN_IN_URL = $url
  $env:SIGN_IN_CA = $caText
  try {
    $out = & $Global:Node (Join-Path $Global:Repo 'packages\db\src\sign-in-check.ts')
  } finally {
    Remove-Item Env:SIGN_IN_URL, Env:SIGN_IN_CA -ErrorAction SilentlyContinue
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out | ConvertFrom-Json)
}
