param()
# Le em voz alta (voz do Windows, pt-BR se instalada) o texto recebido pelo STDIN.
# O texto nunca vira comando: so e passado ao sintetizador de voz.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

$text = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$portuguese = $synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
if ($null -ne $portuguese) { $synthesizer.SelectVoice($portuguese.VoiceInfo.Name) }
$synthesizer.Rate = 1
$synthesizer.Speak($text)
$synthesizer.Dispose()
