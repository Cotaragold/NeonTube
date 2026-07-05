# Скачивает ffmpeg (сборка gyan.dev, essentials) в папку bin/ рядом со скриптом.
$ErrorActionPreference = "Stop"
$bin = Join-Path $PSScriptRoot "bin"
New-Item -ItemType Directory -Force $bin | Out-Null

$zip = Join-Path $bin "ffmpeg.zip"
$tmp = Join-Path $bin "tmp"

Write-Host "Скачиваю ffmpeg (~100 МБ)..."
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip -UseBasicParsing

Write-Host "Распаковываю..."
Expand-Archive $zip -DestinationPath $tmp -Force
foreach ($name in "ffmpeg.exe", "ffprobe.exe") {
    $exe = Get-ChildItem $tmp -Recurse -Filter $name | Select-Object -First 1
    Copy-Item $exe.FullName (Join-Path $bin $name) -Force
}
Remove-Item $tmp -Recurse -Force
Remove-Item $zip -Force
Write-Host "Готово: bin\ffmpeg.exe, bin\ffprobe.exe"
