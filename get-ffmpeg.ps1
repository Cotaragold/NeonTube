# Downloads ffmpeg (gyan.dev essentials build) into bin/ next to this script.
$ErrorActionPreference = "Stop"
$bin = Join-Path $PSScriptRoot "bin"
New-Item -ItemType Directory -Force $bin | Out-Null

$zip = Join-Path $bin "ffmpeg.zip"
$tmp = Join-Path $bin "tmp"

$sources = @(
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"
)
$ok = $false
foreach ($url in $sources) {
    Write-Host "Downloading ffmpeg (~100-170 MB): $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        $ok = $true
        break
    } catch {
        Write-Host "Failed: $($_.Exception.Message). Trying next mirror..."
    }
}
if (-not $ok) { throw "All ffmpeg download sources failed." }

Write-Host "Extracting..."
Expand-Archive $zip -DestinationPath $tmp -Force
foreach ($name in "ffmpeg.exe", "ffprobe.exe") {
    $exe = Get-ChildItem $tmp -Recurse -Filter $name | Select-Object -First 1
    Copy-Item $exe.FullName (Join-Path $bin $name) -Force
}
Remove-Item $tmp -Recurse -Force
Remove-Item $zip -Force
Write-Host "Done: bin\ffmpeg.exe, bin\ffprobe.exe"
