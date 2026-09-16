# Oneday Launchhouse: The AI Growth Engine

Claude plugin for Launchhouse Atlanta, 25 to 27 September 2026.

> **In use by founders who already installed it.** This is version 0.2.0. The words are written the evening after Session 3, and the clinic is Wednesday 23 September. [docs/AFTER-THE-ENGINES.md](docs/AFTER-THE-ENGINES.md) is both. Fixes only from here.

> **From Session 3, Launchhouse runs on [launchhouse-v3](https://github.com/Philm-moxywolf/launchhouse-v3).** Founders take a private copy of it, open that copy in Claude, and say "bring my work across". It loads the same three snapshots and writes the same words as this toolkit, so nothing made in the app is wasted. This repository stays for founders who already installed it, and it is still where the app's engine text comes from.

## Two halves

Founders use two things, in this order, and knowing which is which saves a lot of confusion.

**The Launchhouse app, for Sessions 1 and 2.** Each founder takes their own copy of it. It asks them the questions, writes their Founder Brain, their 30 pieces, their openers and their workflow copy, and holds all of it for them. There is nothing to install and no folder to choose. That is where the work gets made, and [docs/PRE-WORK.md](docs/PRE-WORK.md) is how to set it up.

**The Claude plugin, from Session 3 onwards.** Session 3 is the handover. A founder downloads their work from the app, takes a private copy of [launchhouse-v3](https://github.com/Philm-moxywolf/launchhouse-v3), opens it in Claude on their own machine and says "bring my work across". The plugin in that copy teaches Claude their track, their voice and the rules. They connect HighLevel and, for B2B, Apollo, which are what actually publish and send. The plugin in this repository is the older one, kept for founders who already installed it, and [docs/WORKING-IN-CLAUDE.md](docs/WORKING-IN-CLAUDE.md) is its setup.

So the app makes the work and Claude runs it. Neither half replaces the other.

[docs/SESSIONS.md](docs/SESSIONS.md) is what happens in each session and what the homework is.

[docs/ROAD-TO-ATLANTA.md](docs/ROAD-TO-ATLANTA.md) is the whole arc on one page: where a founder is, what is left, and what has to be true before they travel.

[docs/UPDATE-YOUR-SETUP.md](docs/UPDATE-YOUR-SETUP.md) is how a founder who has already downloaded their work takes the newest toolkit, and what to say to one who is afraid of losing it.

[docs/AFTER-THE-ENGINES.md](docs/AFTER-THE-ENGINES.md) is what a founder does once their engines are written: update the toolkit, write the words their snapshot will arrive without, then load it, paste them in, publish, and test it for real.

## Install the plugin

Only if you already use this toolkit. Everyone else takes a private copy of [launchhouse-v3](https://github.com/Philm-moxywolf/launchhouse-v3) instead.

You install once. Cowork and Claude Code share the same plugin, so it is available in both.

**In the Claude desktop app:** click the + button next to the message box, choose Plugins, and add the marketplace `Philm-moxywolf/Atlanta`. Then install `growth-engine` from it.

**In Claude Code (the terminal):**

```
/plugin marketplace add Philm-moxywolf/Atlanta
/plugin install growth-engine@launchhouse
```

If the commands do not appear straight after installing, run `/reload-plugins` or restart the app, then check again.

**Then open the right folder.** The plugin reads a folder called `growth-engine`, the one that comes out of the app's download. Put it inside another folder and open that outer folder in Claude, not `growth-engine` itself. This is the step people get wrong, and [docs/WORKING-IN-CLAUDE.md](docs/WORKING-IN-CLAUDE.md) says why.

## Commands

Every command starts with `/growth-engine:` because that is how installed plugins are addressed. If you would rather not type commands, say the plain-language version instead. Both do the same thing.

| Command | Or just say | What it does |
|---|---|---|
| `/growth-engine:setup` | "check my setup" | Checks your install and finds your working folder. Run this first |
| `/growth-engine:brain` | "build my founder brain" | Your Founder Brain. Start here |
| `/growth-engine:content` | "build my content engine" | Pillars and your 30 posts or scripts |
| `/growth-engine:engine2` | "build my outreach engine" or "build my audience engine" | Outreach (B2B) or audience (B2C), picked automatically from your track |
| `/growth-engine:ops` | "build my ops engine" | Your bottleneck, the pack of your snapshot to publish first, and its copy |
| `/growth-engine:values` | "fill my custom values" | Writes every message your snapshot will arrive without. Run it before the snapshot is loaded, then paste the words in |
| `/growth-engine:plan` | "build my 90 day plan" | Your 90-day plan |
| `/growth-engine:playbook` | "generate my playbook insert" | Your personalised playbook insert, delivered as a PDF |
| `/growth-engine:status` | "where am I up to" | Where you are up to |
| `/growth-engine:gate` | "build my gate submission" | Your gate submission summary, ready to paste into the gate form |
| `/growth-engine:doctor` | "something is broken" | Diagnoses and fixes problems |

Start with the Brain: `/growth-engine:brain`, or just say "build my founder brain". Everything else follows from that.

## What it does

| Skill | What it builds | Track |
|---|---|---|
| setup | Checks your install, finds your working folder, fixes the common problems | Both |
| founder-brain | Your business, audience, offer, proof and voice, in one locked file | Both |
| content-engine | 30 posts or scripts, ready to load into GHL | Both |
| outreach-b2b | List criteria, sequence copy, personalised first lines | B2B |
| audience-b2c | Targeting, 25 DM openers, hook bank, inbound scripts | B2C |
| ghl-workflows | Bottleneck diagnostic, the pack to publish first, and its workflow copy | Both |
| ghl-values | The words your snapshot will arrive without, written before it loads and pasted in after | Both |
| growth-plan | Your 90-day plan with kill criteria | Both |
| playbook-export | Your personalised playbook insert, as a PDF | Both |
| status | Where you are up to and what is outstanding | Both |

## The two tracks

You choose B2B or B2C once, in the Founder Brain. Every skill after that adapts automatically. You never choose again.

If you genuinely do both, pick the one that makes more money today.

## Cowork or Claude Code

Both work. They share the same plugin, so you install once and it is available in both.

**Use Cowork** unless you have a reason not to. Pick a folder, type what you want, no terminal.

**Use Claude Code** if you want to see and edit the files directly.

Nothing in this programme requires Claude Code.

## Everything lands in one folder

All output goes to `./growth-engine/` in whatever folder you are working in. Keep it. It is the input to the printed playbook and to the weekend.

Updating or reinstalling the plugin never touches that folder. Your work lives on your computer, not inside the plugin.

## What finished looks like

Two worked example founders live in [plugins/growth-engine/assets/examples/](plugins/growth-engine/assets/examples/), one per track. Read them to calibrate depth and tone before building your own.

## Support

Slack channel, or the drop-in clinics.
