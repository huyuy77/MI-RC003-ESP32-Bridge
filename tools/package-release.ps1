#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$EsptoolVersion = '5.4.0',
    [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

function New-WindowsPackage([string]$Ver, [string]$MergedBin, [string]$EsptoolZip) {
    $pkgName = 'MI-RC003-Bridge-' + $Ver + '-win64'
    $pkgDir = Join-Path $Script:DistDir $pkgName
    if (Test-Path $pkgDir) { Remove-Item $pkgDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Join-Path $pkgDir 'firmware') | Out-Null

    Copy-Item (Join-Path $PSScriptRoot 'standalone\flash.ps1') $pkgDir -Force
    Copy-Item (Join-Path $PSScriptRoot 'standalone\flash.bat') $pkgDir -Force
    Expand-Esptool $EsptoolZip $pkgDir
    Copy-Item $MergedBin (Join-Path $pkgDir 'firmware\merged-flash.bin') -Force

    $readme = @"
MI-RC003 Bridge 固件烧录工具 (Windows)
========================================
版本: $Ver
芯片: ESP32-S3
烧录地址: 0x0 (merged-flash.bin)

使用方法
--------
1. 用 USB 数据线将 ESP32-S3 开发板连接到电脑（推荐使用原生 USB/OTG 口）。
2. 双击 flash.bat，工具会自动探测串口并烧录，无需安装 Python 或 ESP-IDF。
3. 若设备正在运行固件，请按住 BOOT 键 -> 点按 RST -> 松开 BOOT 进入下载模式，
   工具会自动等待串口出现（最长 90 秒）。
4. 等待提示 “烧录完成”，设备会自动重启。

命令行参数（可选）
------------------
flash.bat -Port COM5          指定串口
flash.bat -Erase              烧录前擦除整片 Flash
flash.bat -Baud 460800        指定波特率

浏览器在线烧录
--------------
https://ncmro7.github.io/MI-RC003-ESP32-Bridge/flash/

本包内 esptool.exe 来自 https://github.com/espressif/esptool (v$EsptoolVersion)，
遵循其原始许可证，详见 LICENSE-esptool.txt。
"@
    Write-TextFile (Join-Path $pkgDir '使用说明.txt') $readme

    return [pscustomobject]@{ Name = $pkgName; Dir = $pkgDir }
}

try {
    Write-Title '打包 Windows 免安装烧录工具'

    if (-not $Version) { $Version = Get-FirmwareVersion }
    Write-Info ('版本: ' + $Version)

    $merged = Join-Path $Script:BuildDir 'merged-flash.bin'
    if (-not (Test-Path $merged)) {
        throw '未找到 build\merged-flash.bin，请先运行 build-firmware.bat 生成固件。'
    }

    New-Item -ItemType Directory -Force -Path $Script:DistDir | Out-Null
    $esptoolZip = Get-EsptoolZip $EsptoolVersion

    $pkg = New-WindowsPackage $Version $merged $esptoolZip
    Write-Ok ('Windows 包: ' + $pkg.Dir)

    if (-not $SkipZip) {
        $zipPath = Join-Path $Script:DistDir ($pkg.Name + '.zip')
        Write-Info '压缩 Windows 包 ...'
        New-ZipFromDirectory $pkg.Dir $zipPath
        $hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
        $sumFile = Join-Path $Script:DistDir 'SHA256SUMS.txt'
        ($hash + '  ' + (Split-Path $zipPath -Leaf)) | Out-File -FilePath $sumFile -Encoding ascii
        Write-Ok ('发布压缩包: ' + $zipPath)
        Write-Ok ('SHA256: ' + $hash)
    }

    Write-Title '完成'
    Write-Host '产物目录: ' -NoNewline; Write-Host $Script:DistDir -ForegroundColor Green
    Get-ChildItem $Script:DistDir | ForEach-Object { Write-Host ('  - ' + $_.Name) -ForegroundColor DarkGray }
    Write-Host ''
    Write-Host '将 dist 中的 zip 上传到 GitHub Release 即可。' -ForegroundColor Cyan
} catch {
    Write-Fail $_.Exception.Message
    exit 1
}
