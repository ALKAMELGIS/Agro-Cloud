Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(Wscript.ScriptFullName) & "\start_system.bat"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & strPath & chr(34), 0
Set WshShell = Nothing