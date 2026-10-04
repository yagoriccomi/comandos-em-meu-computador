param(
    [Parameter(Mandatory = $true)][string]$StatusFile,
    [Parameter(Mandatory = $true)][int]$ParentPid
)
# Icone da bandeja do O Monstro.
# So LE o arquivo de status escrito pela sessao de desktop e ESCREVE comandos fixos no stdout
# (pause | resume | openlog | shutdown | quit | programs_refresh | programs_edit | routines | deploy | rename <nome>).
# Nenhum texto externo e executado aqui; o nome digitado em "Trocar nome" e validado pelo agente.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

# ---- Tokens de tema (barra de tarefas clara / escura) ----
$Palette = @{
    Light = @{ ready = '#1A7F37'; paused = '#9A6700'; offline = '#57606A'; core_down = '#CF222E'; outline = '#1F2328' }
    Dark  = @{ ready = '#3FB950'; paused = '#D29922'; offline = '#8B949E'; core_down = '#F85149'; outline = '#F0F6FC' }
}
$Labels = @{
    ready     = 'pronto'
    paused    = 'pausado (ações recusadas)'
    offline   = 'sem conexão, tentando de novo'
    core_down = 'núcleo parado'
}
$AppName = 'O Monstro'
$PollIntervalMs = 1000
$OfflineNoticeAfterSeconds = 60
$BalloonTimeoutMs = 5000

$script:IconCache = @{}
$script:State = 'core_down'
$script:LastNoticeId = 0
$script:OfflineSince = $null
$script:OfflineNoticeShown = $false

function Get-ThemeName {
    try {
        $value = Get-ItemPropertyValue -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name 'SystemUsesLightTheme'
        if ($value -eq 1) { return 'Light' }
    } catch { }
    return 'Dark'
}

function Get-StateIcon([string]$State) {
    $theme = Get-ThemeName
    $key = "$theme-$State"
    if ($script:IconCache.ContainsKey($key)) { return $script:IconCache[$key] }
    $colors = $Palette[$theme]
    $bitmap = New-Object System.Drawing.Bitmap 16, 16
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($colors[$State]))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($colors.outline)), 1
    $graphics.FillEllipse($fill, 1, 1, 13, 13)
    $graphics.DrawEllipse($pen, 1, 1, 13, 13)
    $graphics.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    $script:IconCache[$key] = $icon
    return $icon
}

function Send-Command([string]$Name) {
    [Console]::Out.WriteLine($Name)
    [Console]::Out.Flush()
}

function Show-Notice([string]$Text) {
    $notifyIcon.ShowBalloonTip($BalloonTimeoutMs, $AppName, $Text, [System.Windows.Forms.ToolTipIcon]::Info)
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$headerItem = $menu.Items.Add("${AppName}: iniciando")
$headerItem.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$pauseItem = $menu.Items.Add('Pausar ações')
$logItem = $menu.Items.Add('Abrir log')
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$programsMenu = New-Object System.Windows.Forms.ToolStripMenuItem 'Programas'
$refreshItem = $programsMenu.DropDownItems.Add('Atualizar lista de programas')
$editItem = $programsMenu.DropDownItems.Add('Editar lista de programas')
$routinesItem = $programsMenu.DropDownItems.Add('Gerar rotinas sugeridas do app Alexa')
[void]$menu.Items.Add($programsMenu)
$claudeMenu = New-Object System.Windows.Forms.ToolStripMenuItem 'Claude Code'
$claudeAnswerItem = $claudeMenu.DropDownItems.Add('Abrir última resposta do Claude')
$claudeFolderItem = $claudeMenu.DropDownItems.Add('Escolher pasta das ordens…')
$claudePinItem = $claudeMenu.DropDownItems.Add('Definir PIN…')
$claudeLockItem = $claudeMenu.DropDownItems.Add('Encerrar sessão (pede o PIN de novo)')
[void]$menu.Items.Add($claudeMenu)
$renameItem = $menu.Items.Add('Trocar nome de chamada…')
$deployItem = $menu.Items.Add('Publicar atualização…')
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$shutdownItem = $menu.Items.Add('Desligar o agente…')
$quitItem = $menu.Items.Add('Fechar ícone')

$pauseItem.add_Click({
    if ($script:State -eq 'paused') { Send-Command 'resume' } else { Send-Command 'pause' }
})
$logItem.add_Click({ Send-Command 'openlog' })
$refreshItem.add_Click({ Send-Command 'programs_refresh' })
$editItem.add_Click({ Send-Command 'programs_edit' })
$routinesItem.add_Click({ Send-Command 'routines' })
$renameItem.add_Click({
    $name = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Como a Alexa deve chamar este PC? Com artigo, só letras.`nExemplos: o monstro, a morgana.`n`nO novo nome vale depois de 'Publicar atualização'.",
        $AppName, '')
    $clean = ($name -replace '[\r\n]', ' ').Trim()
    if ($clean) { Send-Command "rename $clean" }
})
$claudeAnswerItem.add_Click({ Send-Command 'claude_answer' })
$claudeLockItem.add_Click({ Send-Command 'claude_lock' })
$claudeFolderItem.add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Pasta do projeto onde o Claude Code vai receber as ordens por voz'
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Send-Command "claude_folder $($dialog.SelectedPath)" }
})
$claudePinItem.add_Click({
    $pin = [Microsoft.VisualBasic.Interaction]::InputBox(
        "PIN de 6 digitos para o Claude Code (nao pode comecar com 0).`nA Alexa vai pedir este PIN a cada 3 horas.",
        $AppName, '')
    $digits = ($pin -replace '[^0-9]', '')
    if ($digits) { Send-Command "claude_pin $digits" }
})
$deployItem.add_Click({
    $answer = [System.Windows.Forms.MessageBox]::Show(
        'Publicar a skill na Amazon e gerar o instalador do agente? Uma janela vai mostrar o andamento.',
        $AppName, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Send-Command 'deploy' }
})
$shutdownItem.add_Click({
    $answer = [System.Windows.Forms.MessageBox]::Show(
        'Desligar o agente? A Alexa não conseguirá executar ações até o próximo reinício do Windows.',
        $AppName, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Send-Command 'shutdown' }
})
$quitItem.add_Click({
    Send-Command 'quit'
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

function Update-View {
    $label = $Labels[$script:State]
    $notifyIcon.Icon = Get-StateIcon $script:State
    $notifyIcon.Text = "${AppName}: $label"
    $headerItem.Text = "${AppName}: $label"
    $pauseItem.Text = $(if ($script:State -eq 'paused') { 'Retomar ações' } else { 'Pausar ações' })
    $pauseItem.Enabled = $script:State -ne 'core_down'
}

function Read-Status {
    try {
        $status = Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return
    }
    if ($Labels.ContainsKey([string]$status.state)) { $script:State = [string]$status.state }
    if ($null -ne $status.notice -and [int]$status.notice.id -gt $script:LastNoticeId) {
        $script:LastNoticeId = [int]$status.notice.id
        Show-Notice ([string]$status.notice.text)
    }
}

function Test-OfflineTooLong {
    if ($script:State -ne 'offline') {
        $script:OfflineSince = $null
        $script:OfflineNoticeShown = $false
        return
    }
    if ($null -eq $script:OfflineSince) { $script:OfflineSince = Get-Date }
    $elapsed = ((Get-Date) - $script:OfflineSince).TotalSeconds
    if (-not $script:OfflineNoticeShown -and $elapsed -ge $OfflineNoticeAfterSeconds) {
        $script:OfflineNoticeShown = $true
        Show-Notice 'Sem conexão com o servidor de mensagens há mais de 1 minuto. Verifique a internet.'
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $PollIntervalMs
$timer.add_Tick({
    if ($null -eq (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
        $notifyIcon.Visible = $false
        [System.Windows.Forms.Application]::Exit()
        return
    }
    Read-Status
    Test-OfflineTooLong
    Update-View
})

$notifyIcon.ContextMenuStrip = $menu
Read-Status
Update-View
$notifyIcon.Visible = $true
$timer.Start()
[System.Windows.Forms.Application]::Run()
$timer.Stop()
$notifyIcon.Dispose()
