#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Port = '',
    [int]$Baud = 921600,
    [string]$Profile = '',
    [string]$FlashMode = 'dio',
    [string]$FlashFreq = '80m',
    [string]$FlashSize = '',
    [switch]$Erase,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$Script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:Port = $Port
$Script:Baud = $Baud
$Script:Profile = $Profile
$Script:AutoYes = [bool]$Yes
$Script:Esptool = $null
$Script:EsptoolStyle = ''
$Script:Profiles = [ordered]@{
    n16r8 = [pscustomobject]@{ Label = 'N16R8'; Flash = '16MB'; Psram = '8MB Octal' }
    n8r2  = [pscustomobject]@{ Label = 'N8R2';  Flash = '8MB';  Psram = '2MB Quad' }
    n4r2  = [pscustomobject]@{ Label = 'N4R2';  Flash = '4MB';  Psram = '2MB Quad' }
}

function Write-Title([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 56) -ForegroundColor DarkCyan
    Write-Host ('  ' + $Text) -ForegroundColor Cyan
    Write-Host ('=' * 56) -ForegroundColor DarkCyan
}
function Write-Info([string]$Text) { Write-Host ('[*] ' + $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host ('[+] ' + $Text) -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host ('[!] ' + $Text) -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host ('[x] ' + $Text) -ForegroundColor Red }

function Find-Esptool {
    if ($Script:Esptool) { return $Script:Esptool }

    $local = Join-Path $Script:Root 'esptool.exe'
    if (Test-Path $local) {
        $Script:Esptool = [pscustomobject]@{ File = $local; Prefix = @() }
        return $Script:Esptool
    }
    $c = Get-Command esptool.exe -ErrorAction SilentlyContinue
    if ($c) {
        $Script:Esptool = [pscustomobject]@{ File = $c.Source; Prefix = @() }
        return $Script:Esptool
    }

    $roots = @()
    if ($env:IDF_PYTHON_ENV_PATH) { $roots += $env:IDF_PYTHON_ENV_PATH }
    if ($env:IDF_TOOLS_PATH) { $roots += (Join-Path $env:IDF_TOOLS_PATH 'python') }
    $roots += 'C:\Espressif\tools\python'
    foreach ($r in ($roots | Select-Object -Unique)) {
        if (-not (Test-Path $r)) { continue }
        if (Test-Path (Join-Path $r 'Scripts\esptool.exe')) {
            $Script:Esptool = [pscustomobject]@{ File = (Join-Path $r 'Scripts\esptool.exe'); Prefix = @() }
            return $Script:Esptool
        }
        $hit = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'venv\Scripts\esptool.exe' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($hit) {
            $Script:Esptool = [pscustomobject]@{ File = $hit; Prefix = @() }
            return $Script:Esptool
        }
    }

    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        $Script:Esptool = [pscustomobject]@{ File = $py.Source; Prefix = @('-m', 'esptool') }
        return $Script:Esptool
    }
    return $null
}

function Get-EsptoolStyle {
    if ($Script:EsptoolStyle) { return $Script:EsptoolStyle }
    $tool = Find-Esptool
    if (-not $tool) { throw '未找到 esptool，请确认 esptool.exe 与本脚本在同一目录。' }
    $help = ''
    try { $help = (& $tool.File @($tool.Prefix) '--help' 2>&1 | Out-String) } catch { }
    if ($help -match 'write-flash') { $Script:EsptoolStyle = 'new' } else { $Script:EsptoolStyle = 'old' }
    return $Script:EsptoolStyle
}

function Find-Firmwares {
    $result = [ordered]@{}
    foreach ($prof in $Script:Profiles.Keys) {
        $p = Join-Path $Script:Root ('firmware\merged-flash-' + $prof + '.bin')
        if (Test-Path $p) { $result[$prof] = $p }
    }
    if ($result.Count -eq 0) {
        $legacy = Join-Path $Script:Root 'firmware\merged-flash.bin'
        if (Test-Path $legacy) { $result['n16r8'] = $legacy }
    }
    return $result
}

function Resolve-Firmware {
    $firmwares = Find-Firmwares
    if ($firmwares.Count -eq 0) { throw '未找到固件 firmware\merged-flash-<板型>.bin。' }

    if ($Script:Profile) {
        $key = $Script:Profile.ToLower()
        if (-not $firmwares.Contains($key)) { throw ('未找到硬件版本固件: ' + $Script:Profile) }
        return [pscustomobject]@{ Profile = $key; Path = $firmwares[$key] }
    }

    $keys = @($firmwares.Keys)
    if ($keys.Count -eq 1 -or $Script:AutoYes) {
        $key = $keys[0]
        return [pscustomobject]@{ Profile = $key; Path = $firmwares[$key] }
    }

    Write-Host ''
    Write-Host '检测到多个硬件版本固件，请选择你的开发板：' -ForegroundColor Yellow
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $info = $Script:Profiles[$keys[$i]]
        Write-Host ('  [{0}] {1}  ({2} Flash / {3} PSRAM)' -f ($i + 1), $info.Label, $info.Flash, $info.Psram)
    }
    while ($true) {
        $sel = Read-Host '请输入序号 (直接回车选择 1)'
        if ([string]::IsNullOrWhiteSpace($sel)) { $sel = '1' }
        if ($sel -match '^\d+$' -and [int]$sel -ge 1 -and [int]$sel -le $keys.Count) {
            $key = $keys[[int]$sel - 1]
            return [pscustomobject]@{ Profile = $key; Path = $firmwares[$key] }
        }
        Write-Warn '输入无效，请重新输入。'
    }
}

function Get-SerialPorts {
    $list = @()

    try {
        $devs = Get-CimInstance Win32_PnPEntity -ErrorAction Stop |
            Where-Object { $_.Name -match '\(COM\d+\)' -or $_.Name -match '^COM\d+' }
        foreach ($d in $devs) {
            $p = $null
            if ($d.Name -match '\((COM\d+)\)') { $p = $Matches[1] }
            elseif ($d.Name -match '^(COM\d+)') { $p = $Matches[1] }
            if (-not $p) { continue }
            $vid = $null
            $prodId = $null
            if ($d.DeviceID -match 'VID_([0-9A-Fa-f]{4})') { $vid = $Matches[1].ToUpper() }
            if ($d.DeviceID -match 'PID_([0-9A-Fa-f]{4})') { $prodId = $Matches[1].ToUpper() }
            $prio = 3
            if ($vid -eq '303A' -and $prodId -eq '1001') { $prio = 0 }
            elseif ($vid -eq '303A') { $prio = 1 }
            elseif ($vid -in @('10C4', '1A86', '0403', '067B', '7523')) { $prio = 2 }
            $list += [pscustomobject]@{ Port = $p; Name = $d.Name; Priority = $prio }
        }
    } catch { }

    try {
        $reg = Get-ItemProperty -Path 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM' -ErrorAction Stop
        foreach ($prop in $reg.PSObject.Properties) {
            if ($prop.Name -like 'PS*') { continue }
            $p = [string]$prop.Value
            if ($p -notmatch '^COM\d+$') { continue }
            if ($list | Where-Object { $_.Port -eq $p }) { continue }
            $list += [pscustomobject]@{ Port = $p; Name = $p; Priority = 50 }
        }
    } catch { }

    if ($list.Count -eq 0) {
        try {
            foreach ($p in [System.IO.Ports.SerialPort]::GetPortNames()) {
                $list += [pscustomobject]@{ Port = $p; Name = $p; Priority = 60 }
            }
        } catch { }
    }

    $list |
        Group-Object Port |
        ForEach-Object { $_.Group | Sort-Object Priority | Select-Object -First 1 } |
        Sort-Object Priority, Port
}

function Get-EspressifDevices {
    try {
        Get-CimInstance Win32_PnPEntity -ErrorAction Stop |
            Where-Object { $_.DeviceID -match 'VID_303A' } |
            ForEach-Object {
                $prodId = $null
                if ($_.DeviceID -match 'PID_([0-9A-Fa-f]{4})') { $prodId = $Matches[1].ToUpper() }
                [pscustomobject]@{ Name = $_.Name; Pid = $prodId }
            }
    } catch { }
}

function Write-NoPortHelp {
    Write-Warn '未检测到可用串口。'
    $esp = @(Get-EspressifDevices)
    if ($esp | Where-Object { $_.Pid -eq '8304' }) {
        Write-Host '  检测到 ESP32-S3 正在运行固件（原生 USB 复合设备，不提供串口）。' -ForegroundColor Yellow
        Write-Host '  请让芯片进入下载模式后再烧录：' -ForegroundColor Yellow
        Write-Host '    1) 按住开发板 BOOT 键；' -ForegroundColor Yellow
        Write-Host '    2) 点按一下 RST 键；' -ForegroundColor Yellow
        Write-Host '    3) 松开 BOOT 键，此时会出现 USB 串行/JTAG 串口。' -ForegroundColor Yellow
    } elseif ($esp.Count -gt 0) {
        Write-Host '  检测到 Espressif 设备但未出现串口，请检查/重装 USB 驱动。' -ForegroundColor Yellow
    } else {
        Write-Host '  请连接开发板并安装驱动（CH34x / CP210x），或用 -Port COMx 指定。' -ForegroundColor Yellow
    }
}

function Resolve-Port {
    if ($Script:Port) {
        if ($Script:Port -notmatch '^COM\d+$') {
            $n = ($Script:Port -replace '\D', '')
            if ($n) { $Script:Port = 'COM' + $n }
        }
        return $Script:Port
    }

    $ports = @(Get-SerialPorts)
    if ($ports.Count -eq 0 -and -not $Script:AutoYes) {
        Write-NoPortHelp
        Write-Host ''
        Write-Host '正在等待串口出现（最长 90 秒），请现在进入下载模式...' -ForegroundColor Cyan
        $deadline = (Get-Date).AddSeconds(90)
        while ($ports.Count -eq 0 -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 800
            Write-Host '.' -NoNewline
            $ports = @(Get-SerialPorts)
        }
        Write-Host ''
    }
    if ($ports.Count -eq 0) { throw '未检测到串口。' }

    if ($ports.Count -eq 1 -or $Script:AutoYes) {
        Write-Info ('检测到串口 ' + $ports[0].Port + '  (' + $ports[0].Name + ')')
        $Script:Port = $ports[0].Port
        return $Script:Port
    }
    Write-Host ''
    Write-Host '检测到多个串口，请选择：' -ForegroundColor Yellow
    for ($i = 0; $i -lt $ports.Count; $i++) {
        Write-Host ('  [{0}] {1}  {2}' -f ($i + 1), $ports[$i].Port, $ports[$i].Name)
    }
    while ($true) {
        $sel = Read-Host '请输入序号 (直接回车选择 1)'
        if ([string]::IsNullOrWhiteSpace($sel)) { $sel = '1' }
        if ($sel -match '^\d+$' -and [int]$sel -ge 1 -and [int]$sel -le $ports.Count) {
            $Script:Port = $ports[[int]$sel - 1].Port
            return $Script:Port
        }
        Write-Warn '输入无效，请重新输入。'
    }
}

try {
    Write-Title 'MI-RC003 Bridge 固件烧录'

    $sel = Resolve-Firmware
    $fw = $sel.Path
    if (-not $FlashSize) { $FlashSize = $Script:Profiles[$sel.Profile].Flash }

    $tool = Find-Esptool
    if (-not $tool) { throw '未找到 esptool，请确认 esptool.exe 与本脚本在同一目录。' }
    $style = Get-EsptoolStyle

    $port = Resolve-Port
    Write-Info ('硬件版本: ' + $Script:Profiles[$sel.Profile].Label)
    Write-Info ('固件: ' + $fw)
    Write-Info ('串口: ' + $port + '    波特率: ' + $Script:Baud)

    $a = @()
    if ($style -eq 'new') {
        $a += 'write-flash'; $a += '--flash-mode'; $a += $FlashMode
        $a += '--flash-freq'; $a += $FlashFreq; $a += '--flash-size'; $a += $FlashSize
    } else {
        $a += 'write_flash'; $a += '--flash_mode'; $a += $FlashMode
        $a += '--flash_freq'; $a += $FlashFreq; $a += '--flash_size'; $a += $FlashSize
    }
    if ($Erase) { $a += '-e' }
    $a += '0x0'; $a += $fw

    $callArgs = @($tool.Prefix)
    $callArgs += '--chip'; $callArgs += 'esp32s3'
    $callArgs += '--port'; $callArgs += $port
    $callArgs += '--baud'; $callArgs += $Script:Baud
    $callArgs += $a

    Write-Host ''
    Write-Host ('> ' + $tool.File + ' ' + ($callArgs -join ' ')) -ForegroundColor DarkGray
    Write-Host ''
    & $tool.File @callArgs
    if ($LASTEXITCODE -ne 0) { throw ('烧录失败 (退出码 ' + $LASTEXITCODE + ')') }

    Write-Host ''
    Write-Ok '烧录完成！设备将自动重启。'
    exit 0
} catch {
    Write-Fail $_.Exception.Message
    Write-Host ''
    Write-Host '提示：若无法进入下载模式，请按住 BOOT 键 -> 点按 RST -> 松开 BOOT，然后重试。' -ForegroundColor DarkGray
    exit 1
}
