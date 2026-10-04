param()
# Ajudante de entrada do O Monstro (sessao do usuario, processo persistente).
# Le do stdin UMA linha por comando, de uma lista FECHADA de verbos, e responde "ok" ou "erro <codigo>".
# Nenhum texto recebido e executado: os argumentos sao so inteiros ou "pasta|executavel.exe" validados por regex.
#   ping | playpause | mute | volup <n> | voldown <n> | fullscreen | exitfullscreen | seek <+-segundos>
#   skip | close <pasta|exe> | forcewindowless <pasta|exe> | kill <pasta|exe>
# Processos sao achados pela PASTA + nome do exe (o claude.exe do app e o do Claude Code tem o mesmo nome).
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OMonstroInput {
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    const uint KEYUP = 0x2;
    const uint EXTENDED = 0x1;
    public static void Press(byte vk, bool extended) {
        uint flags = extended ? EXTENDED : 0;
        keybd_event(vk, 0, flags, UIntPtr.Zero);
        keybd_event(vk, 0, flags | KEYUP, UIntPtr.Zero);
    }
    public static uint ForegroundProcessId() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }
    public static string ForegroundTitle() {
        var text = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), text, text.Capacity);
        return text.ToString();
    }
}
'@

$Key = @{
    MediaPlayPause = 0xB3; VolumeMute = 0xAD; VolumeDown = 0xAE; VolumeUp = 0xAF
    F = 0x46; K = 0x4B; J = 0x4A; L = 0x4C; Escape = 0x1B; F11 = 0x7A; Left = 0x25; Right = 0x27
}
$ExtendedKeys = @(0xB3, 0xAD, 0xAE, 0xAF, 0x25, 0x27)
$Browsers = @('chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi')
$ProcessTargetPattern = '^(?<folder>[A-Za-z]:\\[^<>"|?*]{0,240})\|(?<exe>[A-Za-z0-9][A-Za-z0-9 ._()-]{0,63}\.exe)$'
$IntegerPattern = '^-?\d{1,5}$'
# Botoes de pular em varios sites (anuncio, abertura, introducao, creditos, recapitulacao, proximo episodio).
$SkipButtonPattern = '^\s*(pular|skip|ignorar|avancar abertura|pr.ximo epis.dio|next episode)'
$KeyDelayMs = 25
$MaxPresses = 600
$WinRtTimeoutMs = 2000
$KillWaitMs = 3000
$YouTubeLongStepSeconds = 10   # J / L
$YouTubeShortStepSeconds = 5   # setas
$DefaultStepSeconds = 10       # setas na Netflix, Prime Video e na maioria dos players

function Send-Key([int]$VirtualKey, [int]$Times = 1) {
    $count = [Math]::Min([Math]::Max($Times, 0), $MaxPresses)
    for ($i = 0; $i -lt $count; $i++) {
        [OMonstroInput]::Press([byte]$VirtualKey, $ExtendedKeys -contains $VirtualKey)
        Start-Sleep -Milliseconds $KeyDelayMs
    }
}

function Get-ForegroundProcessName {
    try { return (Get-Process -Id ([OMonstroInput]::ForegroundProcessId())).ProcessName.ToLowerInvariant() } catch { return '' }
}

function Test-BrowserInFront { return $Browsers -contains (Get-ForegroundProcessName) }
function Test-YouTubeInFront { return (Test-BrowserInFront) -and ([OMonstroInput]::ForegroundTitle() -match 'YouTube') }

# ---- Menu de midia do Windows (SMTC): usado quando ha algo tocando nele ----
$script:MediaManager = $null
$script:AsTaskMethod = $null

function Wait-WinRt($Operation, [Type]$ResultType) {
    $task = $script:AsTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait($WinRtTimeoutMs)) { throw 'winrt_timeout' }
    return $task.Result
}

function Initialize-MediaManager {
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $script:AsTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        } | Select-Object -First 1
        $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
        $script:MediaManager = Wait-WinRt ($managerType::RequestAsync()) $managerType
    } catch {
        $script:MediaManager = $null
    }
}

function Get-MediaSession {
    if ($null -eq $script:MediaManager) { return $null }
    try { return $script:MediaManager.GetCurrentSession() } catch { return $null }
}

function Invoke-PlayPause {
    $session = Get-MediaSession
    if ($null -ne $session) {
        try { if (Wait-WinRt ($session.TryTogglePlayPauseAsync()) ([bool])) { return 'ok' } } catch { }
    }
    if (Test-YouTubeInFront) { Send-Key $Key.K } else { Send-Key $Key.MediaPlayPause }
    return 'ok'
}

function Get-CurrentPosition($Session) {
    $timeline = $Session.GetTimelineProperties()
    $position = $timeline.Position
    $isPlaying = [string]$Session.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
    $elapsed = [DateTimeOffset]::Now - $timeline.LastUpdatedTime
    # A posicao informada e a do ultimo update; tocando, soma o tempo desde entao (se for plausivel).
    if ($isPlaying -and $elapsed.TotalSeconds -ge 0 -and $elapsed.TotalHours -lt 24) { $position = $position + $elapsed }
    return @{ Position = $position; Start = $timeline.StartTime; End = $timeline.EndTime }
}

function Invoke-SeekWithMediaSession([int]$Seconds) {
    $session = Get-MediaSession
    if ($null -eq $session) { return $false }
    try {
        if (-not $session.GetPlaybackInfo().Controls.IsPlaybackPositionEnabled) { return $false }
        $now = Get-CurrentPosition $session
        $target = $now.Position + [TimeSpan]::FromSeconds($Seconds)
        if ($target -lt $now.Start) { $target = $now.Start }
        if ($now.End -gt [TimeSpan]::Zero -and $target -gt $now.End) { $target = $now.End }
        return [bool](Wait-WinRt ($session.TryChangePlaybackPositionAsync($target.Ticks)) ([bool]))
    } catch {
        return $false
    }
}

function Invoke-SeekWithKeys([int]$Seconds) {
    $forward = $Seconds -gt 0
    $amount = [Math]::Abs($Seconds)
    if (Test-YouTubeInFront) {
        $long = [Math]::Floor($amount / $YouTubeLongStepSeconds)
        $short = [Math]::Round(($amount % $YouTubeLongStepSeconds) / $YouTubeShortStepSeconds)
        Send-Key $(if ($forward) { $Key.L } else { $Key.J }) $long
        Send-Key $(if ($forward) { $Key.Right } else { $Key.Left }) $short
    } else {
        $steps = [Math]::Max(1, [Math]::Round($amount / $DefaultStepSeconds))
        Send-Key $(if ($forward) { $Key.Right } else { $Key.Left }) $steps
    }
    return 'ok'
}

function Invoke-Seek([int]$Seconds) {
    if ($Seconds -eq 0) { return 'erro invalid_argument' }
    if (Invoke-SeekWithMediaSession $Seconds) { return 'ok' }
    return Invoke-SeekWithKeys $Seconds
}

function Invoke-Fullscreen([bool]$Enter) {
    if (Test-BrowserInFront) { Send-Key $(if ($Enter) { $Key.F } else { $Key.Escape }) } else { Send-Key $Key.F11 }
    return 'ok'
}

# ---- Botao "Pular" generico: acessibilidade do Windows, EXPERIMENTAL ----
$script:UiAutomationLoaded = $false

function Invoke-Skip {
    if (-not $script:UiAutomationLoaded) {
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        $script:UiAutomationLoaded = $true
    }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([OMonstroInput]::GetForegroundWindow())
    $isButton = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    foreach ($button in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton)) {
        $name = ([string]$button.Current.Name).Normalize([System.Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
        if ($name -match $SkipButtonPattern) {
            $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            return 'ok'
        }
    }
    return 'erro not_found'
}

# ---- Programas (sempre pasta + exe) ----
function Get-TargetProcesses([string]$Target) {
    if ($Target -notmatch $ProcessTargetPattern) { return @() }
    $prefix = $Matches.folder.TrimEnd('\') + '\'
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($Matches.exe)
    return @(Get-Process -Name $baseName -ErrorAction SilentlyContinue | Where-Object {
        $processPath = $null
        try { $processPath = $_.Path } catch { }
        $processPath -and $processPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

function Invoke-Close([string]$Target) {
    $processes = Get-TargetProcesses $Target
    if ($processes.Count -eq 0) { return 'erro not_running' }
    foreach ($process in $processes) {
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) { [void]$process.CloseMainWindow() }
    }
    return 'ok'
}

# Encerra so se NENHUM processo tiver janela visivel (ficou escondido na bandeja). Janela aberta = pode ter algo por salvar.
function Invoke-ForceWindowless([string]$Target) {
    $processes = Get-TargetProcesses $Target
    if ($processes.Count -eq 0) { return 'ok' }
    if (@($processes | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }).Count -gt 0) { return 'ok kept' }
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    return 'ok'
}

function Invoke-Kill([string]$Target) {
    Get-TargetProcesses $Target | Stop-Process -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddMilliseconds($KillWaitMs)
    while ((Get-TargetProcesses $Target).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if ((Get-TargetProcesses $Target).Count -gt 0) { return 'erro still_running' }
    return 'ok'
}

function Invoke-Line([string]$Line) {
    if ($Line -notmatch '^(?<verb>[a-z]+)(?: (?<arg>.+))?$') { return 'erro malformed' }
    $verb = $Matches.verb
    $arg = $Matches.arg
    $needsInteger = @('volup', 'voldown', 'seek') -contains $verb
    $needsTarget = @('close', 'forcewindowless', 'kill') -contains $verb
    if ($needsInteger -and ($arg -notmatch $IntegerPattern)) { return 'erro invalid_argument' }
    if ($needsTarget -and ($arg -notmatch $ProcessTargetPattern)) { return 'erro invalid_argument' }
    if (-not $needsInteger -and -not $needsTarget -and $null -ne $arg) { return 'erro invalid_argument' }
    switch ($verb) {
        'ping' { return 'ok' }
        'playpause' { return Invoke-PlayPause }
        'mute' { Send-Key $Key.VolumeMute; return 'ok' }
        'volup' { Send-Key $Key.VolumeUp ([int]$arg); return 'ok' }
        'voldown' { Send-Key $Key.VolumeDown ([int]$arg); return 'ok' }
        'fullscreen' { return Invoke-Fullscreen $true }
        'exitfullscreen' { return Invoke-Fullscreen $false }
        'seek' { return Invoke-Seek ([int]$arg) }
        'skip' { return Invoke-Skip }
        'close' { return Invoke-Close $arg }
        'forcewindowless' { return Invoke-ForceWindowless $arg }
        'kill' { return Invoke-Kill $arg }
        default { return 'erro unknown_verb' }
    }
}

Initialize-MediaManager
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
    try { $reply = Invoke-Line $line.Trim() } catch { $reply = 'erro exception' }
    [Console]::Out.WriteLine($reply)
    [Console]::Out.Flush()
}
