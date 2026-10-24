param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -eq 'Core'){throw 'Run this installer in Windows PowerShell 5.1 (powershell.exe), which includes the .NET Framework compiler.'}
$installRoot=Join-Path $env:LOCALAPPDATA 'IABTMasterControl'
$vaultPath=Join-Path $installRoot 'Vault'
$currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$answer=Read-Host "Install IABT Master Control for extension $ExtensionId? It can request computer input and store encrypted history under $installRoot. Every computer input requires a separate Windows confirmation. Type INSTALL to continue"
if($answer -cne 'INSTALL'){Write-Host 'Installation cancelled.';exit 0}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner($currentSid)
foreach($sid in @($currentSid,(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))){
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $installRoot -AclObject $acl
New-Item -ItemType Directory -Path $vaultPath -Force | Out-Null
Set-Acl -LiteralPath $vaultPath -AclObject $acl
$temporaryExe=Join-Path $installRoot ('host-'+[guid]::NewGuid().ToString('N')+'.exe')
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'NativeHost.cs')) -ReferencedAssemblies @('System.dll','System.Core.dll','System.Security.dll','System.Web.Extensions.dll') -OutputAssembly $temporaryExe -OutputType ConsoleApplication
& $temporaryExe --self-test
if($LASTEXITCODE -ne 0){throw 'Companion self-test failed; registration was not changed.'}
$hostExe=Join-Path $installRoot 'IABTMasterControlHost.exe'
Move-Item -LiteralPath $temporaryExe -Destination $hostExe -Force
$origin="chrome-extension://$ExtensionId/"
$manifest=@{name='com.iabt.master_control';description='IABT Master Control permission broker and encrypted local history';path=$hostExe;type='stdio';allowed_origins=@($origin)}
$manifestPath=Join-Path $installRoot 'host.json'
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
foreach($browser in @('Google\Chrome','Microsoft\Edge')){
 $key="HKCU:\Software\$browser\NativeMessagingHosts\com.iabt.master_control"
 New-Item -Path $key -Force|Out-Null
 Set-Item -Path $key -Value $manifestPath
}
Write-Host "Installed. Reopen the IABT Master Control panel and click Connect folder. Vault: $vaultPath"
Write-Host 'The vault is encrypted for this Windows account. Keep a Windows account recovery/backup plan; copying encrypted files to a different account is not a portable restore.'
