' KERNEL desktop launcher - zero-console bootstrap (ASCII only, on purpose).
' Derives the sibling PowerShell script from this file's own name, so the repo
' (and any packaged copy) can be renamed without editing this file. Launches
' hidden and non-blocking: no console window ever flashes.
Option Explicit
Dim fso, sh, scriptPath, folder, baseName, ps1Path, psExe, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

scriptPath = WScript.ScriptFullName
folder = fso.GetParentFolderName(scriptPath)
baseName = fso.GetBaseName(scriptPath)
ps1Path = fso.BuildPath(folder, baseName & ".ps1")

psExe = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"

sh.CurrentDirectory = folder
cmd = """" & psExe & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """"
sh.Run cmd, 0, False
