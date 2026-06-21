!macro customHeader
  ManifestDPIAware true
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    StrCpy $0 "$PROFILE\.cache\superting\models"
    IfFileExists "$0\*.*" 0 +3
      RMDir /r "$0"
      DetailPrint "Removed SuperTing cached models"
    StrCpy $1 "$PROFILE\.cache\superting"
    RMDir "$1"
  ${endIf}
!macroend
