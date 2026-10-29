param(
  [ValidateRange(1, 65535)][int]$Port = 4173,
  [switch]$SetupOwner
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$runtimePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
$previousOwnerUsername = $env:BUILDER_OWNER_USERNAME
$previousOwnerPassword = $env:BUILDER_OWNER_PASSWORD

try {
  if (-not $runtimePath) {
    $runtimeCandidates = @(
      (Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'),
      'C:/Program Files/Microsoft VS Code/Code.exe'
    )
    $runtimePath = $runtimeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $runtimePath) { throw 'Установите Node.js 20 или новее, затем снова запустите этот файл.' }
    $env:ELECTRON_RUN_AS_NODE = '1'
  }
  $runtimeVersion = & $runtimePath -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0 -or ([version]$runtimeVersion).Major -lt 20) {
    throw 'Для локального сервера нужен Node.js 20 или новее.'
  }

  if ($SetupOwner) {
    $ownerUsername = Read-Host 'Логин владельца существующей страницы (например, iwtlu)'
    if ($ownerUsername -notmatch '^[a-zA-Z0-9_-]{3,32}$') { throw 'Логин: 3-32 латинские буквы, цифры, _ или -.' }
    $secureOwnerPassword = Read-Host 'Пароль владельца (минимум 8 символов)' -AsSecureString
    $credential = New-Object System.Management.Automation.PSCredential('owner', $secureOwnerPassword)
    $ownerPassword = $credential.GetNetworkCredential().Password
    if ($ownerPassword.Length -lt 8 -or $ownerPassword.Length -gt 128) { throw 'Пароль должен содержать от 8 до 128 символов.' }
    $env:BUILDER_OWNER_USERNAME = $ownerUsername.Trim().ToLowerInvariant()
    $env:BUILDER_OWNER_PASSWORD = $ownerPassword
    $ownerPassword = $null
    Write-Host 'Войдите в браузере с этим логином и паролем, чтобы создать аккаунт владельца.'
  }

  & $runtimePath (Join-Path $PSScriptRoot 'dev-server.mjs') --port $Port | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Сервер завершился с кодом $LASTEXITCODE." }
}
finally {
  $env:ELECTRON_RUN_AS_NODE = $previousElectronMode
  $env:BUILDER_OWNER_USERNAME = $previousOwnerUsername
  $env:BUILDER_OWNER_PASSWORD = $previousOwnerPassword
}
