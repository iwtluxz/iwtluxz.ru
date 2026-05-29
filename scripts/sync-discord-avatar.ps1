param(
  [ValidateSet("iwtlu", "strelokk", "shakzy", "shakzyy", "all")]
  [string]$Profile = "iwtlu",
  [string]$UserId = "1105558423359205489",
  [string[]]$Output = @("img/avatar.jpg", "img/discordimg.png"),
  [int]$WatchSeconds = 0
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"
$profiles = @{
  iwtlu = @{
    UserId = "1105558423359205489"
    Output = @("img/avatar.jpg", "img/discordimg.png")
  }
  strelokk = @{
    UserId = "958595335037542450"
    Output = @("img/avatar1.jpg")
  }
  shakzyy = @{
    UserId = "788045714571132928"
    Output = @("img/avatar_shakzy.jpg")
  }
  shakzy = @{
    UserId = "788045714571132928"
    Output = @("img/avatar_shakzy.jpg")
  }
}

function Read-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()

    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed -split "=", 2

    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }

  return $null
}

$token = $env:DISCORD_BOT_TOKEN

if (-not $token) {
  $token = Read-DotEnvValue -Path $envPath -Name "DISCORD_BOT_TOKEN"
}

if (-not $token) {
  throw "Add DISCORD_BOT_TOKEN to .env first."
}

$token = $token.Trim()
if ($token.StartsWith("Bot ")) {
  $token = $token.Substring(4).Trim()
}

$tlsProtocols = [Net.SecurityProtocolType]::Tls12
try {
  $tlsProtocols = $tlsProtocols -bor [Net.SecurityProtocolType]::Tls13
} catch {}
[Net.ServicePointManager]::SecurityProtocol = $tlsProtocols

$headers = @{
  Authorization = "Bot $token"
}

function Get-DiscordErrorBody {
  param($ErrorRecord)

  try {
    $responseStream = $ErrorRecord.Exception.Response.GetResponseStream()
    if (-not $responseStream) {
      return $null
    }

    $reader = New-Object System.IO.StreamReader($responseStream)
    return $reader.ReadToEnd()
  } catch {
    return $null
  }
}

function Assert-ImageFile {
  param([string]$Path)

  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
    $image = [System.Drawing.Image]::FromFile($Path)
    $image.Dispose()
  } catch {
    $preview = ""
    try {
      $preview = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
    } catch {}

    if ($preview) {
      Write-Host "Downloaded response preview: $($preview.Substring(0, [Math]::Min(160, $preview.Length)))"
    }

    throw "Downloaded avatar is not a valid image. Existing files were not overwritten."
  }
}

function Sync-DiscordAvatar {
  param(
    [string]$TargetUserId,
    [string[]]$TargetOutput
  )

  $userApiUrl = "https://discord.com/api/v10/users/$TargetUserId"

  try {
    $user = Invoke-RestMethod `
      -Uri $userApiUrl `
      -Headers $headers `
      -Method Get
  } catch {
    $body = Get-DiscordErrorBody -ErrorRecord $_

    Write-Host "Discord API request failed through PowerShell. Trying curl.exe fallback..."
    if ($body) {
      Write-Host "Discord response: $body"
    }

    if ($body -like "*40333*") {
      Write-Host "Code 40333 usually means Discord rejected the request from this network/IP."
      Write-Host "Try running this command with VPN/WARP enabled, or test it after deploy on Netlify."
    }

    $curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curlPath) {
      throw
    }

    $userJson = & curl.exe -sS -L --http1.1 --tlsv1.2 -4 `
      -H "Authorization: Bot $token" `
      -H "User-Agent: iwtlu-local-avatar-sync" `
      $userApiUrl

    if ($LASTEXITCODE -ne 0 -or -not $userJson) {
      throw "curl.exe also failed to reach Discord API. Try VPN/WARP or another network."
    }

    $user = $userJson | ConvertFrom-Json

    if ($user.message -and $user.code) {
      throw "Discord API error: $userJson"
    }
  }

  if ($user.avatar) {
    $extension = if ($user.avatar.StartsWith("a_")) { "gif" } else { "png" }
    $avatarUrl = "https://cdn.discordapp.com/avatars/$($user.id)/$($user.avatar).${extension}?size=256"
  } else {
    $defaultIndex = ([int64]::Parse($user.id) -shr 22) % 6
    $avatarUrl = "https://cdn.discordapp.com/embed/avatars/$defaultIndex.png"
  }

  $tempFile = Join-Path $env:TEMP "discord-avatar-$TargetUserId"
  try {
    Invoke-WebRequest -Uri $avatarUrl -OutFile $tempFile
  } catch {
    Write-Host "Avatar download failed through PowerShell. Trying curl.exe fallback..."
    $curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curlPath) {
      throw
    }

    & curl.exe -sS -L --http1.1 --tlsv1.2 -4 -o $tempFile $avatarUrl
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempFile)) {
      throw "curl.exe also failed to download the Discord avatar. Try VPN/WARP or another network."
    }
  }

  Assert-ImageFile -Path $tempFile

  foreach ($relativeOutput in $TargetOutput) {
    $targetPath = Join-Path $root $relativeOutput
    $targetDirectory = Split-Path -Parent $targetPath

    if (-not (Test-Path -LiteralPath $targetDirectory)) {
      New-Item -ItemType Directory -Path $targetDirectory | Out-Null
    }

    Copy-Item -LiteralPath $tempFile -Destination $targetPath -Force
  }

  Remove-Item -LiteralPath $tempFile -Force

  Write-Host "Updated Discord avatar for $($user.username) ($TargetUserId)"
  Write-Host "Avatar URL: $avatarUrl"
  Write-Host "Files:"
  foreach ($relativeOutput in $TargetOutput) {
    Write-Host " - $relativeOutput"
  }
}

function Sync-SelectedProfiles {
  if ($Profile -eq "all") {
    foreach ($profileName in @("iwtlu", "strelokk", "shakzyy")) {
      $target = $profiles[$profileName]
      Write-Host ""
      Write-Host "Syncing $profileName..."
      Sync-DiscordAvatar -TargetUserId $target.UserId -TargetOutput $target.Output
    }

    return
  }

  if ($PSBoundParameters.ContainsKey("UserId") -or $PSBoundParameters.ContainsKey("Output")) {
    Sync-DiscordAvatar -TargetUserId $UserId -TargetOutput $Output
    return
  }

  $selectedProfile = $profiles[$Profile]
  Sync-DiscordAvatar -TargetUserId $selectedProfile.UserId -TargetOutput $selectedProfile.Output
}

if ($WatchSeconds -gt 0) {
  while ($true) {
    Sync-SelectedProfiles
    Start-Sleep -Seconds $WatchSeconds
  }
}

Sync-SelectedProfiles
