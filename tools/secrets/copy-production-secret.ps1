# Copies one value from your production vault to the clipboard, to save it in your password
# manager, and clears the clipboard when you press Enter. Shows no value on screen.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\copy-production-secret.ps1"
. (Join-Path $PSScriptRoot 'production-lib.ps1')
$vault = Get-Vault
if ($vault.Count -eq 0) { Fail 'the vault is empty: run set-production-secrets.ps1 first.' }
$names = @($vault.Keys | Sort-Object)
for ($i = 0; $i -lt $names.Count; $i++) { Write-Host ("{0,2}. {1}" -f ($i + 1), $names[$i]) }
while ($true) {
  $pick = (Read-Host 'Number to copy (Enter alone to finish)').Trim()
  if ($pick -eq '') { break }
  $n = 0
  if (-not [int]::TryParse($pick, [ref]$n) -or $n -lt 1 -or $n -gt $names.Count) { Write-Host 'Type one of the numbers above.'; continue }
  Set-Clipboard -Value (Get-VaultValue $vault $names[$n - 1])
  Read-Host "$($names[$n - 1]) is on the clipboard. Paste it into your password manager, then press Enter to clear the clipboard"
  Set-Clipboard -Value ' '
}
Write-Host 'RESULT: done; the clipboard is cleared.' -ForegroundColor Green
