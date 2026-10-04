param()
# Detector de programas do O Monstro (so LEITURA). Escreve no stdout um JSON com os programas do menu Iniciar:
#   [{ name, appId, folder, exes: [..] }]
# appId: id do menu Iniciar (abre com explorer.exe shell:AppsFolder\<appId>), igual ao clique no menu.
# folder + exes: onde ficam os executaveis do programa (para fechar/destravar pelo CAMINHO, nunca so pelo nome).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$StartMenuFolders = @(
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)
# Pastas conhecidas que aparecem como {GUID}\caminho no AppID de programas classicos.
$KnownFolders = @{
    '{6D809377-6AF0-444B-8957-A3773F02200E}' = $env:ProgramW6432
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}' = ${env:ProgramFiles(x86)}
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' = (Join-Path $env:SystemRoot 'System32')
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}' = $env:SystemRoot
}
# Nunca listar "todos os processos" destas pastas: ha centenas de processos do sistema nelas.
$SharedFolders = @($env:SystemRoot, $env:ProgramW6432, ${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA, $env:APPDATA) |
    Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }

$shell = New-Object -ComObject WScript.Shell
$shortcuts = @{}
foreach ($folder in $StartMenuFolders) {
    if (-not (Test-Path -LiteralPath $folder)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $folder -Recurse -Filter *.lnk -ErrorAction SilentlyContinue) {
        try {
            $link = $shell.CreateShortcut($file.FullName)
            $existing = $shortcuts[$file.BaseName]
            # Dois atalhos com o mesmo nome: vale o que tem argumentos (ex.: Discord com --processStart).
            if ($null -ne $existing -and ($existing.Arguments -or -not $link.Arguments)) { continue }
            $shortcuts[$file.BaseName] = @{ Target = [string]$link.TargetPath; Arguments = [string]$link.Arguments }
        } catch { }
    }
}

$packages = @{}
foreach ($package in Get-AppxPackage -ErrorAction SilentlyContinue) { $packages[$package.PackageFamilyName] = $package }

$runningPaths = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Path } catch { $null } } | Where-Object { $_ } | Sort-Object -Unique)

function Test-SharedFolder([string]$Folder) {
    $trimmed = $Folder.TrimEnd('\')
    return ($SharedFolders -contains $trimmed) -or ($trimmed -like "$($env:SystemRoot)\*")
}

function Get-ProgramLocation($App) {
    $appId = [string]$App.AppID
    if ($appId -match '^(?<family>[^!\\]+)!') {
        $package = $packages[$Matches.family]
        if ($null -eq $package -or -not $package.InstallLocation) { return $null }
        $exes = @()
        try {
            [xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
            $exes = @($manifest.Package.Applications.Application | ForEach-Object { $_.Executable } | Where-Object { $_ -like '*.exe' } |
                ForEach-Object { Split-Path $_ -Leaf })
        } catch { }
        return @{ Folder = $package.InstallLocation; Exes = $exes }
    }
    $shortcut = $shortcuts[[string]$App.Name]
    if ($null -ne $shortcut -and $shortcut.Target -like '*.exe') {
        $target = $shortcut.Target
        # Apps "Squirrel" (Discord, Slack...): o atalho abre Update.exe (ou um intermediario) com --processStart X.exe;
        # o programa roda em app-<versao>\X.exe e o atualizador Update.exe fica na mesma pasta raiz.
        if ($shortcut.Arguments -match '--processStart\s+"?(?<exe>[^"\s]+\.exe)') {
            return @{ Folder = (Split-Path $target -Parent); Exes = @('Update.exe', $Matches.exe) }
        }
        return @{ Folder = (Split-Path $target -Parent); Exes = @(Split-Path $target -Leaf) }
    }
    if ($appId -match '^(?<guid>\{[0-9A-Fa-f-]{36}\})\\(?<rest>.+\.exe)$' -and $KnownFolders.ContainsKey($Matches.guid.ToUpperInvariant())) {
        $full = Join-Path $KnownFolders[$Matches.guid.ToUpperInvariant()] $Matches.rest
        return @{ Folder = (Split-Path $full -Parent); Exes = @(Split-Path $full -Leaf) }
    }
    if ($appId -match '^[A-Za-z]:\\.+\.exe$') {
        return @{ Folder = (Split-Path $appId -Parent); Exes = @(Split-Path $appId -Leaf) }
    }
    return $null
}

$result = foreach ($app in Get-StartApps) {
    $location = Get-ProgramLocation $app
    $folder = ''
    $exes = @()
    if ($null -ne $location -and $location.Folder) {
        $folder = [string]$location.Folder
        $exes = @($location.Exes)
        # Processos extras do mesmo programa que estao rodando agora (ex.: Claude: app, Cowork, Code).
        if (-not (Test-SharedFolder $folder)) {
            $prefix = $folder.TrimEnd('\') + '\'
            $exes += @($runningPaths | Where-Object { $_.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } |
                ForEach-Object { Split-Path $_ -Leaf })
        }
    }
    [pscustomobject]@{
        name = [string]$app.Name
        appId = [string]$app.AppID
        folder = $folder
        exes = @($exes | Where-Object { $_ } | Sort-Object -Unique)
    }
}

[Console]::Out.Write((ConvertTo-Json -InputObject @($result) -Depth 4 -Compress))
