; PC5 OS Setup: extra steps on top of electron-builder's assisted installer.

!macro customInstall
  ; The exe keeps Electron's icon (we skip rcedit so the build needs no
  ; extra privileges), so point the shortcuts at the PC5 icon instead.
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "Install PC5 OS on this PC, a USB drive or an ISO"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ; The console itself, for trying PC5 on this Windows.
  CreateShortCut "$SMPROGRAMS\PC5 OS Console.lnk" "$appExe" "--console" "$INSTDIR\resources\icon.ico" 0 "" "" "Open the PC5 console on this Windows"
  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "Install PC5 OS on this PC, a USB drive or an ISO"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
!macroend

!macro customUnInstall
  ; Never leave Windows pointing at a shell that no longer exists:
  ; if console mode is on, give the user their normal desktop back.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows NT\CurrentVersion\Winlogon" "Shell"
  ${if} $0 == '"$INSTDIR\PC5Shell.exe"'
  ${orIf} $0 == "$INSTDIR\PC5Shell.exe"
    DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\Winlogon" "Shell"
  ${endIf}
  Delete "$SMPROGRAMS\PC5 OS Console.lnk"
  Delete "$DESKTOP\Return to PC5.lnk"
  Delete "$DESKTOP\Return to PC5.cmd"
!macroend
