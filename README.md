# Touchline

[Open the app](https://www.jamessturtevant.com/touchline/)

A private soccer game planner for the touchline. Manage teams, build fair rotations,
and follow the game with a clear field view and substitution alerts.

## Use it

1. Create a team and add its players. Shirt numbers and preferred roles are optional.
2. Create a plan. Choose 7v7, 9v9, or 11v11, a formation, total game length, and rotation interval.
3. Generate lineups, then adjust each block by tapping players on the field.
4. Use the plan for a game. Select the available squad and review today's lineups.
   If players are absent, regenerate with the saved plan's settings.
5. Start the game and keep the app open for sound alerts. Acknowledge changes or correct the actual lineup.

The clock stops at halftime. Review the goalkeeper and lineup, then start the
second half manually. At full time, confirm the result to save the match in history.

Plans are reusable. A game is an independent copy, so changes during a game do not
change the plan or earlier matches.

Generated substitutions keep retained players in their field positions, except
for the goalkeeper change at halftime. Generation prioritizes a turn for every
player in each half and no more than one consecutive block on the bench.
Choose a **Rotation strategy** in the plan editor:

- **Fair participation** (default): prioritize each half and short bench waits.
- **Small changes**: bring on at most three players per block and balance minutes.
- **Longer shifts**: keep players on for at least two blocks, with at most three
  entrants. The halftime goalkeeper change is an exception.

The last two strategies can mean longer bench waits or no turn in a short half.
Large squads or short
halves can make these goals impossible; the block editor names players who miss
a half or sit consecutive blocks, including after manual edits. Field pickers
offer only the current player and bench players. Regenerate existing plans to use
the new rotations;
saved plans and active games are not changed automatically.

Choose **Advanced manual plan** to plan substitutions yourself. Use a repeating
interval or tap times for each half. Tap a selected time again to remove it,
or use **Clear times**. Use **Add exact time** for other times; `12.5` means
12 minutes and 30 seconds. Kickoff and halftime are included. Select no extra
times for a half with no extra blocks.
Times must increase and stay at least 30 seconds apart, away from each half's
start and end.

Generate the blocks, then select your starting players. Every block starts with
the same lineup; there is no automatic substitution or goalkeeper change.
An edit continues through untouched blocks until the next block you edited.
Use **Keep this lineup from here** to protect an unchanged block before editing
an earlier one. This also applies across halftime. Regeneration resets manual
edits; review the plan before saving or starting a game.
During a manual game, next-block and halftime edits affect that block only.
Actual-lineup corrections do not replace later manual assignments.

Game setup uses the saved formation, game length, strategy and schedule.
Change these settings in the plan editor, not in game setup.

In the block editor, green **Just on** labels mark arrivals from the previous
block. Yellow **Next** labels show entrants in the next block. These markers
update as you edit a saved plan or prepare a game.

During a game, use **Edit next substitutions** to adjust the next lineup or
keep a player who was due to come off. Change either name directly in its OFF-to-ON
row; choose **Keep on** to cancel, or **Add substitution** to add another row.
The live lineup changes only when applied. Goalkeeper edits carry through the rest
of that half. The preview skips unchanged blocks to show the next real changes.
Players who just came on have a soft-green **Just on** badge until the next
substitution, including after reload.

**Estimated playing time** shows expected totals at full time from actual play
and the remaining lineups. It updates after plan edits and assumes pending
changes happen now. **Playing time so far** remains the actual recorded time.

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
BASE_PATH=/touchline/ just build
```

The `BASE_PATH` setting supports GitHub Pages project paths. The default `/` is for
local development or a custom-domain root.

The Pages workflow deploys `main`. Configure the repository's Pages source as
**GitHub Actions**. To install on iPhone or iPad, use Safari's Share menu and choose
Add to Home Screen. Other supported browsers show an Install app option.
When the browser offers installation, **Your data → Install for the touchline**
shows an **Install app** button. Browsers without this prompt still use their own
installation menus.
If you installed the app at the old `/soccersub/` URL, export a backup before
reinstalling from the new URL.

Manual in-app updates are blocked while a game is active. Browsers may activate
an update after all app tabs close; the saved game remains available on reopening.
Available updates appear in a pale-red banner at the top of every screen.
