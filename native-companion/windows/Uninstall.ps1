$ErrorActionPreference='Stop'
$installRoot=Join-Path $env:LOCALAPPDATA 'IABTMasterControl'
$answer=Read-Host 'Disconnect IABT Master Control from Chrome and Edge? Your encrypted Vault folder will be kept. Type DISCONNECT to continue'
if($answer -cne 'DISCONNECT'){Write-Host 'Cancelled.';exit 0}
foreach($browser in @('Google\Chrome','Microsoft\Edge')){
 $key="HKCU:\Software\$browser\NativeMessagingHosts\com.iabt.master_control"
 if(Test-Path $key){Remove-Item -LiteralPath $key -Recurse}
}
Write-Host "Disconnected. Remove the browser extension separately. Encrypted history is preserved at $installRoot\Vault."
