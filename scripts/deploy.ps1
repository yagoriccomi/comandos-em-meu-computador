param(
    [switch]$SemTestes,      # pula os testes (nao recomendado)
    [switch]$SoSkill,        # publica so a skill (Lambda + modelo de voz)
    [switch]$SoAgente,       # gera so o instalador do agente
    [switch]$SemInstalar     # gera o instalador, mas nao abre
)
# Deploy do O Monstro. Manual completo em docs/DEPLOY.md.
#   1. testes (lambda e agente) e conferencia do catalogo
#   2. skill: copia o codigo + modelo de voz (com seu nome de chamada e verbos) para o repositorio da
#      Alexa-hosted e faz git push -> a Amazon compila e publica no estagio de desenvolvimento
#   3. agente: gera dist\O Monstro e abre o instalador (pede administrador)
# Configuracao privada (fora do Git): %LOCALAPPDATA%\OMonstro\deploy.json  { "skillId": "amzn1.ask.skill...." }
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoDir = Split-Path -Parent $PSScriptRoot
$UserDir = Join-Path $env:LOCALAPPDATA 'OMonstro'
$DeployConfigFile = Join-Path $UserDir 'deploy.json'
$CloneParent = Join-Path $UserDir 'deploy'
$CloneDir = Join-Path $CloneParent 'skill'
$PreferencesFile = Join-Path $UserDir 'preferencias.json'
$ProgramsFile = Join-Path $UserDir 'programas.json'
$AskCli = @('--yes', 'ask-cli@2')
$StatusPollSeconds = 10
$StatusTimeoutMinutes = 10
$SkillIdPattern = '^amzn1\.ask\.skill\.[0-9a-f-]{36}$'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Fail([string]$Text) { Write-Host ''; Write-Host "ERRO: $Text" -ForegroundColor Red; exit 1 }

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory = $RepoDir) {
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) { Fail "'$File $($Arguments -join ' ')' terminou com erro ($LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

function Invoke-Ask([string[]]$Arguments, [string]$WorkingDirectory = $RepoDir) {
    Invoke-Checked 'npx' ($AskCli + $Arguments) $WorkingDirectory
}

function Get-SkillId {
    if (Test-Path -LiteralPath $DeployConfigFile) {
        $config = Get-Content -LiteralPath $DeployConfigFile -Raw | ConvertFrom-Json
        if ($config.skillId -match $SkillIdPattern) { return $config.skillId }
    }
    Write-Host 'Primeira vez: cole o Skill ID (console da Alexa -> sua skill -> "Copy Skill ID").'
    $skillId = (Read-Host 'Skill ID').Trim()
    if ($skillId -notmatch $SkillIdPattern) { Fail 'Skill ID invalido. Ele comeca com amzn1.ask.skill.' }
    New-Item -ItemType Directory -Force -Path $UserDir | Out-Null
    @{ skillId = $skillId } | ConvertTo-Json | Set-Content -LiteralPath $DeployConfigFile -Encoding UTF8
    return $skillId
}

function Assert-Tools {
    foreach ($tool in @('node', 'npm', 'npx', 'git')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool nao encontrado. Instale o Node.js (que traz npm/npx) e o Git." }
    }
}

function Assert-AskLogin {
    $askConfig = Join-Path $env:USERPROFILE '.ask\cli_config'
    if (-not (Test-Path -LiteralPath $askConfig)) {
        Fail "ASK CLI ainda sem login. Rode uma vez:  npx ask-cli@2 configure   (abre o navegador para entrar na sua conta Amazon Developer)."
    }
}

function Invoke-Tests {
    Write-Step 'Testes da skill e do agente'
    Invoke-Checked 'npm' @('test') (Join-Path $RepoDir 'lambda')
    Invoke-Checked 'npm' @('run', 'catalog:check') (Join-Path $RepoDir 'lambda')
    Invoke-Checked 'npm' @('test') (Join-Path $RepoDir 'agent')
}

function Update-SkillClone([string]$SkillId) {
    if (Test-Path -LiteralPath (Join-Path $CloneDir '.git')) {
        Write-Step 'Atualizando a copia local da skill (git pull)'
        Invoke-Checked 'git' @('pull', '--ff-only') $CloneDir
        return
    }
    Write-Step 'Baixando a skill da Amazon pela primeira vez (ask init)'
    Write-Host 'Quando o ASK CLI perguntar o nome da pasta, digite:  skill' -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $CloneParent | Out-Null
    Invoke-Ask @('init', '--hosted-skill-id', $SkillId) $CloneParent
    if (-not (Test-Path -LiteralPath (Join-Path $CloneDir '.git'))) { Fail "A pasta '$CloneDir' nao foi criada. Rode de novo e use o nome 'skill'." }
}

function Wait-SkillBuild([string]$SkillId) {
    Write-Step 'Esperando a Amazon compilar (modelo de voz e codigo)'
    $deadline = (Get-Date).AddMinutes($StatusTimeoutMinutes)
    Start-Sleep -Seconds $StatusPollSeconds
    while ((Get-Date) -lt $deadline) {
        $raw = & npx @AskCli smapi get-skill-status --skill-id $SkillId 2>$null
        if ($LASTEXITCODE -eq 0 -and $raw) {
            $status = ($raw -join "`n") | ConvertFrom-Json
            $model = $status.interactionModel.'pt-BR'.lastUpdateRequest.status
            $code = $status.hostedSkillDeployment.lastUpdateRequest.status
            Write-Host "  modelo de voz: $model | codigo: $code"
            if ($model -eq 'FAILED' -or $code -eq 'FAILED') {
                Fail 'A Amazon recusou o deploy. Veja o motivo no console (Build -> Interaction Model, ou Code -> Deployment logs). docs/DEPLOY.md explica.'
            }
            if ($model -eq 'SUCCEEDED' -and $code -eq 'SUCCEEDED') { return }
        }
        Start-Sleep -Seconds $StatusPollSeconds
    }
    Fail "Passaram $StatusTimeoutMinutes minutos e a compilacao nao terminou. Confira no console da Alexa."
}

function Publish-Skill {
    Assert-AskLogin
    $skillId = Get-SkillId
    Update-SkillClone $skillId
    Write-Step 'Copiando codigo e modelo de voz (com seu nome de chamada e verbos)'
    Invoke-Checked 'node' @((Join-Path $RepoDir 'scripts\prepare-deploy.js'), '--clone', $CloneDir, '--preferences', $PreferencesFile, '--programs', $ProgramsFile)
    Write-Step 'Enviando para a Amazon (git push)'
    Invoke-Checked 'git' @('add', '-A') $CloneDir
    & git -C $CloneDir diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Nada mudou desde o ultimo deploy da skill.'
        return
    }
    Invoke-Checked 'git' @('commit', '-m', "deploy: O Monstro $(Get-Date -Format 'yyyy-MM-dd HH:mm')") $CloneDir
    Invoke-Checked 'git' @('push', 'origin', 'HEAD:master') $CloneDir
    Wait-SkillBuild $skillId
}

function Publish-Agent {
    Write-Step 'Gerando o instalador do agente'
    Invoke-Checked 'npm' @('run', 'build:pacote') (Join-Path $RepoDir 'agent')
    $installer = Join-Path $RepoDir 'agent\dist\O Monstro\Instalar O Monstro.cmd'
    if ($SemInstalar) {
        Write-Host "Instalador pronto: $installer"
        return
    }
    Write-Host 'Abrindo o instalador (vai pedir permissao de administrador)...' -ForegroundColor Yellow
    Start-Process -FilePath $installer
}

Write-Host 'O Monstro - deploy' -ForegroundColor Green
Assert-Tools
if (-not $SemTestes) { Invoke-Tests }
if (-not $SoAgente) { Publish-Skill }
if (-not $SoSkill) { Publish-Agent }
Write-Host ''
Write-Host 'Pronto. Teste: "Alexa, pede para <seu nome de chamada> pausar".' -ForegroundColor Green
