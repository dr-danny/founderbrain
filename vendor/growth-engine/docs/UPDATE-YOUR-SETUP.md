# Update your setup

You already downloaded your work and opened it in Claude. This is how to take the newest toolkit, and it takes about two minutes.

> **From Session 3, Launchhouse runs on [launchhouse-v3](https://github.com/Philm-moxywolf/launchhouse-v3).** You take a private copy of it, open that copy in Claude, and say "bring my work across". It loads the same snapshots and writes the same words as this toolkit. Its own update page is the one to follow. This page stays for anyone who installed the older toolkit. If that is you, your work is safe in your own folder: bring it across to the new copy, then remove this toolkit from the Plugins panel so only one set of commands answers.

## First, the thing founders worry about

**The toolkit is the instructions. Your folder is your work. They are two different things.**

Updating cannot lose your Brain, your posts or your files, because they live in your own folder on your computer, not inside the toolkit. Nothing in your folder is touched, renamed or rewritten. Nothing is regenerated, and you are never asked about your business again.

## Why update at all

The step that writes your snapshot's words arrived in a later version. You run it in the week before the clinic, not on the day. Without it, Claude does not know your value names, how many there are, or which of them have to be filled before you publish.

Updates are never automatic. You take them when we say, so that a room of 130 people is running the same thing.

## Update it

**In the desktop app, or in Cowork:**

1. Open the Claude desktop app on your Launchhouse folder.
2. Press the **+** button next to the message box and open **Plugins**.
3. Find **growth-engine** and update it. You want version **0.2.0** or later.
4. If it still shows the old version, quit the app and open it again.

**In Claude Code, the terminal:**

```
/plugin marketplace update launchhouse
```

Then reinstall the plugin if you are asked to.

**If you never installed it at all:**

```
/plugin marketplace add Philm-moxywolf/Atlanta
/plugin install growth-engine@launchhouse
```

## Check it worked

Open your folder in Claude and say **"fill my custom values"**.

If Claude knows what you mean, you are on the new version. That is the only check that proves anything, so do it rather than reading the version number.

## If the command is still not there

Three causes, in this order.

1. **The prefix.** Every command is `/growth-engine:values`, never a bare command on its own. Plain language works too, and is easier: "fill my custom values".
2. **It has not loaded yet.** Quit the app and open it again. In Claude Code, run `/reload-plugins`.
3. **The wrong account.** Check you are signed in to the Claude account you installed it on.

## Does anything in your own folder need changing?

No. Nothing. The new step reads two files you already have, `growth-engine/founder-brain.md` and `growth-engine/ops-workflow.md`, and writes one new file next to them. There is no setting to change and nothing to move.

If `ops-workflow.md` is missing, say **"build my ops engine"** first. It names the snapshot you chose, and your words cannot be written without it.

## If you copied the toolkit into your folder instead of installing it

Some founders took the downloadable folder, which put the toolkit inside `.claude/` in their own folder. That copy does not update itself and it does not have the new step.

The simplest fix is to install the plugin properly, using the steps above, and stop using the copied one. Ask in Slack if you are not sure which you have.

## If you have two of them

If you also installed the `launchhouse-v3` toolkit at some point, you now have two sets of the same commands, and Claude will answer with whichever wins.

Keep one. If you work in a folder you downloaded from the app, keep `growth-engine@launchhouse`. Remove the other from the Plugins panel, then quit and reopen the app.

## Checking nothing was lost

Say **"where am I up to"**. Claude reads your folder and tells you what is there.

If something looks missing, it is almost always the folder rather than the file. Claude was opened one level up or one level down. Say **"check my setup"** and it will look in the folder above and in your home folder before concluding anything is gone.

Your real safety net is the app. Your download is a copy, so if a file really has gone, open **Files** in the app and download everything again.

## What happens if you never update

Everything you have keeps working. No file is touched and every engine you have already run still runs.

You would only lose the values step. That means arriving at the clinic with nothing written, and spending the day writing instead of pasting. If you get to the clinic without updating, the rule is simple: **load your snapshot, publish nothing, update, then write and paste.** A published workflow with empty words sends blank emails to real people.

## Stuck

Post in the Slack channel. Do not wait for the session.
