# Touchline

[Open the app](https://jsturtevant.github.io/soccersub/)

A private soccer game planner for the touchline. Manage teams, build fair rotations,
and follow the game with a clear field view and substitution alerts.

## Use it

1. Create a team and add its players. Shirt numbers and preferred roles are optional.
2. Create a plan. Choose 7v7, 9v9, or 11v11, a formation, total game length, and rotation interval.
3. Generate lineups, then adjust each block by tapping players on the field.
4. Use the plan for a game. Select the available squad and review today's lineups.
5. Start the game and keep the app open for sound alerts. Acknowledge changes or correct the actual lineup.

The clock stops at halftime. Review the goalkeeper and lineup, then start the
second half manually. At full time, confirm the result to save the match in history.

Plans are reusable. A game is an independent copy, so changes during a game do not
change the plan or earlier matches.

Generated substitutions keep retained players in their field positions, except
for the goalkeeper change at halftime. Each generated change brings on at most
three bench players. Field pickers offer only the current
player and bench players. Regenerate existing plans to use the new rotations;
saved plans and active games are not changed automatically.

## Your data

All data stays in this browser. There is no account, server, analytics, or sync.
**Export a backup from Your data regularly:** clearing browser data removes teams,
plans, and history. Backups do not include an unfinished game.

The app saves one unfinished game locally. On reopening, choose resume or discard.
Its clock keeps running while the app is closed, but stops at halftime and full
time. Missed scheduled changes are assumed and marked in the log; correct the
current lineup if they did not happen. The app cannot send background alerts.

Import validates a backup and shows a preview before replacing saved data. End or
discard an active game before importing. Use one editing tab at a time; other tabs
stop editing when saved data changes.

Your data also has a confirmed **Delete all data** action. It removes all saved
records, including an unfinished game, but keeps the app installed and usable
offline.

## Development

Requires Node.js 24 and [just](https://github.com/casey/just).

```sh
just web install
npm run dev
```

```sh
just web browser-install
just test
```

`just test` runs unit tests, lint, formatting, a production build, and browser flows.
Browser tests use Chromium and WebKit to cover mobile and desktop layouts. WebKit
needs system libraries; `browser-install` may require administrator access.

```sh
BASE_PATH=/soccersub/ just build
```

The `BASE_PATH` setting supports GitHub Pages project paths. The default `/` is for
local development or a custom-domain root.

The Pages workflow deploys `main`. Configure the repository's Pages source as
**GitHub Actions**. To install on iPhone or iPad, use Safari's Share menu and choose
Add to Home Screen. Other supported browsers show an Install app option.
When the browser offers installation, **Your data → Install for the touchline**
shows an **Install app** button. Browsers without this prompt still use their own
installation menus.

Manual in-app updates are blocked while a game is active. Browsers may activate
an update after all app tabs close; the saved game remains available on reopening.
Available updates appear in a pale-red banner at the top of every screen.
