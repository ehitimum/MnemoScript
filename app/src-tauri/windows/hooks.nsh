; MnemoScript installer hooks (Tauri NSIS, see tauri.conf.json -> bundle.windows.nsis.installerHooks).
;
; Updating an older MnemoScript:
;  - Installed with this setup.exe (per user): Tauri's own "Reinstall" page finds it and offers
;    to update it in place.
;  - Installed with the .msi package (for all users, in Program Files): the setup cannot see it,
;    so both copies stayed installed side by side. This hook finds such a copy and offers to
;    remove it, so this version replaces it. Removing it asks for administrator approval.
;
; Projects and settings live in the user's home folder (~/.mnemoscript) and are never touched.
; Nothing older found: the install runs normally.

!macro MNEMO_REMOVE_OLD_MSI VIEW
  SetRegView ${VIEW}
  StrCpy $R0 0
  mnemo_msi_next_${VIEW}:
    EnumRegKey $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R0
    StrCmp $R1 "" mnemo_msi_done_${VIEW}
    IntOp $R0 $R0 + 1
    ReadRegStr $R2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R1" "DisplayName"
    StrCmp $R2 "${PRODUCTNAME}" 0 mnemo_msi_next_${VIEW}
    ReadRegDWORD $R2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R1" "WindowsInstaller"
    StrCmp $R2 "1" 0 mnemo_msi_next_${VIEW}
    ReadRegStr $R3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R1" "DisplayVersion"
    IfSilent mnemo_msi_remove_${VIEW}
    MessageBox MB_YESNO|MB_ICONQUESTION "Another MnemoScript ($R3) is installed for all users on this PC.$\r$\n$\r$\nRemove it so this version (${VERSION}) replaces it?$\r$\nYour projects and settings are kept." /SD IDYES IDNO mnemo_msi_next_${VIEW}
    mnemo_msi_remove_${VIEW}:
    DetailPrint "Removing MnemoScript $R3 (all users)"
    ExecWait '"$SYSDIR\msiexec.exe" /x $R1 /passive /norestart' $R2
    ; Removed: its key is gone, so the next key now has this index.
    StrCmp $R2 "0" 0 mnemo_msi_next_${VIEW}
    IntOp $R0 $R0 - 1
    Goto mnemo_msi_next_${VIEW}
  mnemo_msi_done_${VIEW}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  !insertmacro MNEMO_REMOVE_OLD_MSI 64
  !insertmacro MNEMO_REMOVE_OLD_MSI 32
  SetRegView default
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
