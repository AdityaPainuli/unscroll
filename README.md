# Unscroll

Instagram content ideas without opening Instagram. A Telegram bot watches creators in your niche, finds their breakout posts (3x or more of their usual views), has Claude break each one down, and sends you a weekly brief of 5 ideas, one at a time.

## Run it

```bash
npm install
cp .env.example .env   # fill in the values below
npm start
```

Without Instagram credentials it runs on demo data, so you can try the bot first.

To print a brief in the terminal without Telegram:

```bash
npm run brief -- @creator1 @creator2
```

### Keep it running on your Mac

```bash
scripts/agent.sh install
```

This runs Unscroll in the background, starts it on login, and restarts it if it crashes. `scripts/agent.sh status`, `logs` and `uninstall` do what they say.

## Setup

### 1. Telegram bot (2 min)

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. Run `npm start`, open your bot, and send `/whoami`.
3. Put that number in `TELEGRAM_OWNER_ID` and restart. The bot ignores everyone else.

### 2. Claude

Set `ANTHROPIC_API_KEY`. Without it the brief still goes out, but with no AI breakdown.

### 3. Instagram (about 15 min, done once)

Reading other creators' posts uses Business Discovery, which needs the Facebook Login flavour of the Instagram API.

1. Link your Instagram creator account to a Facebook Page (Page settings, then Linked accounts).
2. At [developers.facebook.com](https://developers.facebook.com), create an app (type Business) and add the Instagram product with Facebook Login.
3. In the Graph API Explorer, pick your app and generate a user token with `instagram_basic`, `pages_show_list`, `pages_read_engagement` and `business_management`.
4. Call `me/accounts?fields=instagram_business_account` and copy the id into `IG_USER_ID`.
5. Extend the token to long-lived (Access Token Debugger, then Extend) and put it in `IG_ACCESS_TOKEN`. It lasts about 60 days.

The app can stay in development mode since you're its only user, so no Meta app review is needed.

## Bot commands

| Command | What it does |
|---|---|
| `/watch @a @b` | Add creators (creator or business accounts only) |
| `/unwatch @a` | Remove a creator |
| `/watchlist` | Show who's tracked |
| `/niche`, `/pillars a; b; c` | Tell Claude what you post about |
| `/brief` | Build this week's brief now |
| `/inbox` | Ideas you've kept |
| any message | Saved to your inbox as an idea |

The brief also runs on its own every Sunday at 9am (`BRIEF_CRON`), and the watchlist syncs nightly (`SYNC_CRON`). If the laptop was asleep or off at that time, the brief goes out as soon as it's back on.

## How outliers are picked

Each post is compared with the median of that creator's other recent posts, so a small creator's breakout counts as much as a big one's. Views are used when available, otherwise likes plus 3x comments. Posts under 48 hours old are skipped (still growing), at most 2 ideas come from one creator, and a post is never shown twice. You can tune this with `OUTLIER_MIN_RATIO`, `OUTLIER_WINDOW_DAYS` and `BRIEF_SIZE`.
