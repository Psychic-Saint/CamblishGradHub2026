# Camblish Alumni Hub V1.0

Author: Eddie Bila · Camblish Training Institute · *Taking the Lead, Shaping the Future*

One interface for graduations and alumni events: live check-in, stage order with first come, first on stage, name tags, team tasks with roadblocks, announcements, user accounts for @camblish.co.za staff and Excel learner uploads.

## Open it
- **Web / phones:** https://psychic-saint.github.io/CamblishGradHub2026/
- **Windows desktop:** run `desktop/run.bat` (needs Python 3.12 with `pip install pywebview pillow pywin32`) or build a standalone app with `desktop/build.bat`. The desktop app opens the same GitHub page, adds silent name-tag printing to label printers and sends login emails through Outlook. It falls back to a bundled copy when offline.

## How it fits together
- `index.html` is the whole app (served by GitHub Pages). Edit it here and every browser and desktop app gets the change on next open.
- Data lives in Supabase (project "Camblish e-Register"). The page only uses the public key; every action goes through database functions that check the signed-in user.
- No passwords, admin keys or learner data are stored in this repository.

## Working on it
1. Clone the repo, edit `index.html`, open it in a browser to test.
2. Commit and push to `main`. GitHub Pages republishes in about a minute.

## Latest update
- **Colour name tags** in the Caps Off design with name, programme and NQF, client, year and the stage number. Sized for colour card printers (86 x 54 mm CR80 by default) and colour label printers. Tags print automatically at check-in on the desktop app.
- **Access list** on the Users tab shows exactly what each person can and can't do, plus a role table.
- **Show password** button on every password box.
- **Stay live:** requests retry automatically if the connection drops, and a daily GitHub Action (`.github/workflows/keepalive.yml`) keeps the database awake.
- **New app icon** (graduation cap) for the desktop app, taskbar and browser tab.

## Installing on other laptops
1. Run `desktop\build.bat` on a PC with Python to build the app folder.
2. Compile `desktop\setup.nsi` with NSIS (makensis) to get `Camblish Alumni Hub Setup.exe`.
3. Give managers the setup file. It installs for the signed-in user without admin rights, adds desktop and Start menu shortcuts, and appears in Windows Apps for uninstalling.
The installed app loads this GitHub page, so changes to index.html reach every laptop without reinstalling. Only changes to the desktop code need a new installer.

## Graduation day flow (v1.3)
Check-in → Robes → Stage → Certificates. Each tab shows only the graduates at that step, and every learner tab can be filtered by programme, NQF level, project manager and client, with live search by name, ID number or seat.

- **Seating:** Manage → Seating plan assigns seats for the Great Hall: lower section rows AA–LL first (left block rows AA–CC kept for clients), programmes kept together in stage order, overflow continues upstairs from row A. Seats print on the name tags.
- **Overview:** charts for present, robes, crossed and certificates, the journey funnel, arrivals every 15 minutes and progress per programme.
- **Graduation report:** Overview → Graduation report downloads a visual report of the day (print or save as PDF).
- **Live sync:** devices tell each other instantly when something changes, with a 2.5 second check as a back-up. Only changes are downloaded, so 20+ people can work at once.
- **Alerts:** sound, pop-up, a shaking Updates tab and Windows notifications in the desktop app.
