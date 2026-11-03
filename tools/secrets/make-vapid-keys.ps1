# Makes one browser-alert (VAPID) key pair for one site and hands you the values for Vercel one at
# a time through the clipboard. The private key is never shown on screen.
# Run:  powershell -ExecutionPolicy Bypass -File "<repository>\tools\secrets\make-vapid-keys.ps1"
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$node = 'C:\Program Files\nodejs\node.exe'
$wp   = Join-Path $repo 'apps\web\node_modules\web-push'

$site = Read-Host 'Which site is this for? Type dev or staging'
if ($site -ne 'dev' -and $site -ne 'staging') { Write-Host 'Type dev or staging only.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit }

$env:WP_PATH = $wp
$json = & $node -e "const w=require(process.env.WP_PATH);process.stdout.write(JSON.stringify(w.generateVAPIDKeys()))"
Remove-Item Env:WP_PATH -ErrorAction SilentlyContinue
$keys = $json | ConvertFrom-Json
if (-not $keys.publicKey -or -not $keys.privateKey) { Write-Host 'RESULT: the keys could not be made - nothing was copied.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit }

Write-Host ''
Write-Host "Vercel > project shakti-prime-$site > Settings > Environment Variables > Add (environment: Production)." -ForegroundColor Cyan
Write-Host ''
Set-Clipboard -Value $keys.publicKey
Read-Host 'Step 1: the PUBLIC key is on your clipboard. Add VAPID_PUBLIC_KEY, paste it as the value, save. Then press Enter'
Set-Clipboard -Value $keys.privateKey
Read-Host 'Step 2: the PRIVATE key is on your clipboard. Add VAPID_PRIVATE_KEY, paste it, tick Sensitive, save. Then press Enter'
Set-Clipboard -Value ' '
$keys = $null; $json = $null
Write-Host 'Step 3: add VAPID_SUBJECT yourself with the value mailto: followed by the email the push services may write to (for example mailto:you@yourdomain).'
Write-Host ''
Write-Host "RESULT: the $site key pair is made and the clipboard is cleared. Redeploy the $site site (Deployments > latest > Redeploy) so it reads the new values." -ForegroundColor Green
Read-Host 'Press Enter to close'
