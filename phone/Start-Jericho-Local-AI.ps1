param([Parameter(Mandatory=$true)][string]$BindAddress)
$ErrorActionPreference = 'Stop'
$ip = $null
if (-not [System.Net.IPAddress]::TryParse($BindAddress,[ref]$ip) -or $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Choose this computer''s private IPv4 Wi-Fi address.' }
$b = $ip.GetAddressBytes()
if (-not ($b[0] -eq 10 -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168))) { throw 'Only a private LAN address is allowed; wildcard/public listeners are not configured.' }
$interface = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $BindAddress } | Select-Object -First 1
if (-not $interface) { throw 'That address is not assigned to this computer.' }
$profile = Get-NetConnectionProfile -InterfaceIndex $interface.InterfaceIndex
if ($profile.NetworkCategory -ne 'Private') { throw 'Use a trusted Private home network. No network-profile or firewall change was made.' }
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) { throw 'Ollama is not installed. Install it from https://ollama.com/download/windows and obtain a local model first. This script installs or purchases nothing.' }
$listener = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw 'An existing process uses port 11434. Quit the Ollama tray app yourself if appropriate, then rerun. No process was stopped.' }
$previousHost = $env:OLLAMA_HOST
$previousCloud = $env:OLLAMA_NO_CLOUD
try {
  $env:OLLAMA_HOST = $BindAddress + ':11434'
  $env:OLLAMA_NO_CLOUD = '1'
  Write-Host ('Phone model address: http://' + $BindAddress + ':11434')
  Write-Host 'Keep this window and the computer on. This local API has no password: use only your trusted private LAN.'
  Write-Host 'No router forwarding, public tunnel, firewall exception, persistent environment change or paid API is configured.'
  Write-Host 'Connect from Jericho Personal 1.1, check installed models, choose a local model, and describe your app.'
  & $ollama.Source serve
  if ($LASTEXITCODE -ne 0) { throw 'Local model server stopped with an error. No automatic restart or model download was attempted.' }
} finally {
  $env:OLLAMA_HOST = $previousHost
  $env:OLLAMA_NO_CLOUD = $previousCloud
}
