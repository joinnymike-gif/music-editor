-- Compile this source with osacompile to create “AI Music IDE Launcher.app”.
-- The app is a Finder-friendly macOS launcher for the local Tauri development build.

on run
	set launcherBundle to POSIX path of (path to me)
	set launcherDirectory to do shell script "/usr/bin/dirname " & quoted form of launcherBundle
	set startupScript to launcherDirectory & "/start-mac.command"

	set scriptExists to do shell script "if [ -x " & quoted form of startupScript & " ]; then echo yes; else echo no; fi"
	if scriptExists is not "yes" then
		display alert "AI Music IDE Launcher" message "The start-mac.command file was not found beside this launcher. Keep the entire scripts folder together." as critical
		return
	end if

	set choice to button returned of (display dialog "Open the local AI Music IDE desktop app.\n\nOn the first launch, required JavaScript dependencies may be installed. A Terminal window stays open while the development app is running." with title "AI Music IDE Launcher" buttons {"Cancel", "Launch AI Music IDE"} default button "Launch AI Music IDE" cancel button "Cancel")

	if choice is "Launch AI Music IDE" then
		tell application "Terminal"
			activate
			do script "exec " & quoted form of startupScript
		end tell
	end if
end run
