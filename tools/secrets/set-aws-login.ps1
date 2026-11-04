# Saves the read-only AWS login of the IAM user claude-shakti for the AWS CLI and the aws-mcp server
# (docs/runbooks/tooling.md, Connection notes, AWS), tests it with AWS and prints one RESULT line.
# The secret is typed hidden and never shown. Run after making a new access key for claude-shakti:
#   powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\set-aws-login.ps1"
$ErrorActionPreference = 'Stop'
$aws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
if (-not (Test-Path $aws)) { Write-Host 'RESULT: failed - the AWS CLI is not installed'; exit 1 }

$keyId = (Read-Host 'Access key ID (starts with AKIA)').Trim()
if ($keyId -notmatch '^AKIA[A-Z0-9]{16}$') { Write-Host 'RESULT: failed - that does not look like an access key ID'; exit 1 }
$secure = Read-Host 'Secret access key (hidden)' -AsSecureString
$secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($secret.Length -ne 40) { Write-Host 'RESULT: failed - the secret should be 40 characters'; exit 1 }

& $aws configure set aws_access_key_id $keyId
& $aws configure set aws_secret_access_key $secret
& $aws configure set region ap-south-1
& $aws configure set output json
$secret = $null

$arn = & $aws sts get-caller-identity --query Arn --output text 2>$null
if ($LASTEXITCODE -ne 0 -or -not $arn) { Write-Host 'RESULT: failed - AWS refused the key; check you copied both parts of the new key'; exit 1 }
if ($arn -notmatch ':user/claude-shakti$') { Write-Host "RESULT: saved, but this key belongs to $arn, not claude-shakti; create the key on claude-shakti instead"; exit 1 }
Write-Host "RESULT: ok - signed in as $arn, region ap-south-1"
