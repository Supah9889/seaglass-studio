!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  GetFullPathName $0 "$LOCALAPPDATA\${PRODUCTNAME}"
  GetFullPathName $1 "$INSTDIR"
  StrCmp $0 $1 0 private_beta_wrong_directory
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
  IntOp $0 $0 & 0x400
  IntCmp $0 0 0 private_beta_wrong_directory private_beta_wrong_directory
  IfFileExists "$INSTDIR\seaglass-studio.exe" private_beta_wrong_directory
  IfFileExists "$INSTDIR\uninstall.exe" 0 private_beta_directory_ok
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" private_beta_directory_ok

private_beta_wrong_directory:
  IfSilent +2
  MessageBox MB_ICONSTOP "Install the beta in its own folder under Local AppData. Choose the default ${PRODUCTNAME} folder."
  SetErrorLevel 2
  Quit

private_beta_directory_ok:
  Pop $1
  Pop $0
!macroend
