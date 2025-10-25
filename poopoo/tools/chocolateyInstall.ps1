$ErrorActionPreference = 'Stop'

$packageName = 'poopoo'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$url = 'https://himsafiles.com/Noah4downloads/Noah_System_4.16.3.6646.exe'

$packageArgs = @{
  packageName   = $packageName
  fileType      = 'EXE'
  url           = $url
  softwareName  = 'Poopoo*'
  checksum      = ''
  checksumType  = 'sha256'
  silentArgs    = '/S'
  validExitCodes= @(0)
}

Install-ChocolateyPackage @packageArgs
