# Downloads ffmpeg (gyan.dev essentials build) into bin/ next to this script.
$ErrorActionPreference = "Stop"
$bin = Join-Path $PSScriptRoot "bin"
New-Item -ItemType Directory -Force $bin | Out-Null

$zip = Join-Path $bin "ffmpeg.zip"
$tmp = Join-Path $bin "tmp"

Write-Host "Downloading ffmpeg (~100 MB)..."
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip -UseBasicParsing

Write-Host "Extracting..."
Expand-Archive $zip -DestinationPath $tmp -Force
foreach ($name in "ffmpeg.exe", "ffprobe.exe") {
    $exe = Get-ChildItem $tmp -Recurse -Filter $name | Select-Object -First 1
    Copy-Item $exe.FullName (Join-Path $bin $name) -Force
}
Remove-Item $tmp -Recurse -Force
Remove-Item $zip -Force
Write-Host "Done: bin\ffmpeg.exe, bin\ffprobe.exe"
