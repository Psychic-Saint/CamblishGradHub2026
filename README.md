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
