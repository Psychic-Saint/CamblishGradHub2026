; Camblish Alumni Hub installer
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APP      "Camblish Alumni Hub"
!define VER      "1.2.0"
!define EXE      "Camblish Alumni Hub.exe"
!define UNKEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\CamblishAlumniHub"

Name "${APP}"
OutFile "Camblish Alumni Hub Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\CamblishAlumniHub" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "designed and developed by Eddie Bila"

VIProductVersion "${VER}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "CompanyName" "Camblish Training Institute"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "FileVersion" "${VER}"
VIAddVersionKey "ProductVersion" "${VER}"
VIAddVersionKey "LegalCopyright" "Camblish Training Institute"
VIAddVersionKey "Comments" "Designed and developed by Eddie Bila"

!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to the Camblish Alumni Hub"
!define MUI_WELCOMEPAGE_TEXT "This will install the Alumni Hub on this laptop: live check-in, stage order, name tag printing, team tasks and announcements.$\r$\n$\r$\nNo administrator rights are needed. Sign in afterwards with your @camblish.co.za email and the password you were sent.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open the Camblish Alumni Hub now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; The app window runs on Microsoft Edge WebView2 (built into Windows 11 and most Windows 10 PCs)
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    MessageBox MB_YESNO|MB_ICONINFORMATION "This laptop needs Microsoft Edge WebView2 (a free Microsoft component) for the Alumni Hub window.$\r$\n$\r$\nOpen the Microsoft download page now? Install the 'Evergreen Bootstrapper', then run this setup again." IDNO +2
    ExecShell "open" "https://developer.microsoft.com/microsoft-edge/webview2/"
  ${EndIf}
FunctionEnd

Section "Install"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\_internal"
  File /r "app\*.*"
  File "app.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\app.ico" 0
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortCut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\app.ico" 0
  CreateShortCut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\CamblishAlumniHub" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Camblish Training Institute"
  WriteRegStr HKCU "${UNKEY}" "Comments" "Designed and developed by Eddie Bila"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\CamblishAlumniHub"
SectionEnd
