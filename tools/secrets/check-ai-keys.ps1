# Checks one environment's Anthropic and Voyage keys against each vendor before they go into Vercel.
# Shows no key. Run once per environment:
#   powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\check-ai-keys.ps1"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Read-Hidden($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$envName = Read-Host 'Which environment are these keys for (dev, staging or production)'

# Anthropic: read the one model the BOS uses; costs nothing.
$key = Read-Hidden "Paste the $envName Anthropic key (typing stays hidden)"
try {
  $m = Invoke-RestMethod -Method Get -Uri 'https://api.anthropic.com/v1/models/claude-haiku-4-5-20251001' `
    -Headers @{ 'x-api-key' = $key; 'anthropic-version' = '2023-06-01' } -TimeoutSec 20
  $anthropic = "accepted (model $($m.id) reachable)"
  $aOk = $true
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  $anthropic = "refused (HTTP $code)"
  $aOk = $false
}
$key = $null

# Voyage: one embedding of one word with the BOS's model; a tiny fraction of a cent.
$key = Read-Hidden "Paste the $envName Voyage key (typing stays hidden)"
try {
  $body = '{"input":["check"],"model":"voyage-3.5"}'
  $v = Invoke-RestMethod -Method Post -Uri 'https://api.voyageai.com/v1/embeddings' `
    -Headers @{ 'Authorization' = "Bearer $key" } -ContentType 'application/json' -Body $body -TimeoutSec 20
  $voyage = "accepted (voyage-3.5, $($v.data[0].embedding.Count) dimensions)"
  $vOk = $true
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  $voyage = "refused (HTTP $code)"
  $vOk = $false
}
$key = $null

$colour = if ($aOk -and $vOk) { 'Green' } else { 'Red' }
Write-Host "RESULT ($envName): Anthropic $anthropic; Voyage $voyage" -ForegroundColor $colour
Read-Host 'Press Enter to close'
