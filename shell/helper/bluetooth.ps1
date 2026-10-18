# Bluetooth controller pairing for PC5 Shell (Windows PowerShell 5.1, WinRT APIs).
#   bluetooth.ps1 scan          -> JSON list of nearby unpaired Bluetooth devices
#   bluetooth.ps1 pair <id>     -> JSON { status }
param([string] $Action = 'scan', [string] $Id = '')
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type] $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$DI = [Windows.Devices.Enumeration.DeviceInformation]

if ($Action -eq 'scan') {
    $selector = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($false)
    $found = Await ($DI::FindAllAsync($selector)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
    $list = @($found | Where-Object { $_.Name } | ForEach-Object {
        [pscustomobject]@{
            id         = $_.Id
            name       = $_.Name
            controller = [bool]($_.Name -match 'Wireless Controller|DualSense|DualShock|Xbox|Controller|Gamepad')
        }
    })
    ConvertTo-Json -InputObject $list -Compress
} elseif ($Action -eq 'pair') {
    $device = Await ($DI::CreateFromIdAsync($Id)) ([Windows.Devices.Enumeration.DeviceInformation])
    $result = Await ($device.Pairing.PairAsync()) ([Windows.Devices.Enumeration.DevicePairingResult])
    ConvertTo-Json -InputObject @{ status = $result.Status.ToString() } -Compress
}
