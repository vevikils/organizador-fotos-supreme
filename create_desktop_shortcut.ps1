$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path -Path $DesktopPath -ChildPath "Organizador Supremo de Fotos.lnk"
$ExePath = Join-Path -Path $PSScriptRoot -ChildPath "Organizador_Fotos.exe"
$IconPath = Join-Path -Path $PSScriptRoot -ChildPath "public\icons\icon.ico"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.Arguments = ""
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "Organizador Supremo de Fotos - Google Fotos Desktop"
$Shortcut.IconLocation = "$IconPath,0"
$Shortcut.Save()

Write-Host "Acceso directo actualizado exitosamente hacia Organizador_Fotos.exe en: $ShortcutPath"
