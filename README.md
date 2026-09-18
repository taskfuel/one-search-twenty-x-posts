# One search, twenty X posts, in full

[![Run on Replit](https://replit.com/badge/github/taskfuel/one-search-twenty-x-posts)](https://replit.com/github.com/taskfuel/one-search-twenty-x-posts)

Open it in Replit with one click, add your own key, and search X.

Type a search once. It comes back with twenty posts, newest first, each with its
full text, its likes, reposts, replies and quotes, and a link to the original.
Half a cent a search.

| what | price |
|---|---|
| one search, twenty posts | $0.005 |

Quoted 2026-09-18. The price is per search, not per post, and it does not change
with how much text comes back. Prices are set by the provider and can change,
so the app shows what each call actually cost, which is the only number that is
ever authoritative.

Long posts arrive whole. Most cheap scrapers hand you a truncated `text` field,
which is the half that drops the argument, and an agent summarizing that sounds
sure of itself and gets it wrong. Posts past the old character limit are tagged
in the results with their length.

## Run it

1. **[Open it in Replit](https://replit.com/github.com/taskfuel/one-search-twenty-x-posts).**
   That imports this repo into your own account as a runnable copy.
2. **Get a key** at [app.taskfuel.ai](https://app.taskfuel.ai/?utm_source=replit&utm_medium=referral&utm_campaign=2026-09-replit-templates&utm_content=one-search-twenty-x-posts).
   The first $5 is on the house, which is a thousand searches.
3. **Open the Secrets tab** in the left sidebar. Add a secret named
   `TASKFUEL_API_KEY` and paste your key as the value.
4. **Hit Run.**

That is the whole setup. No X developer account, no API keys from X, no
integration code to keep working.

## What you can search

The query is X's own search syntax, so it takes more than a name:

| query | finds |
|---|---|
| `from:karpathy` | one person's timeline |
| `"my agent bought" OR "agent paid for it itself"` | either phrase, from anyone |
| `@taskfuel_ai` | posts mentioning an account |
| `$BTC` | posts about a ticker |

Results are newest first rather than ranked by relevance, so a broad keyword
gets you the last twenty matching posts and not the twenty best ones. On a busy
topic that can be a few minutes of posts. Narrow the query instead.

## How it works

Every paid call goes to one endpoint:

```js
await fetch("https://app.taskfuel.ai/v1/call", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TASKFUEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://x402.ottoai.services/tweet-search?query=from%3Akarpathy",
    method: "GET",
    maxAmountUsd: 0.02,
  }),
});
```

TaskFuel pays the provider's HTTP-402 charge from your prepaid balance and
passes the response straight back. The response headers tell you what it cost
(`x-taskfuel-cost`) and what is left (`x-taskfuel-balance`).

The search itself comes from [Otto](https://useotto.xyz/), one of the providers
in the catalog. There is no polling: the response carries the posts.

## Spending safely

The key can spend your whole balance, and nothing is watching at call time, so
the limits live in the code:

| Setting | Default | What it does |
|---|---|---|
| `MAX_USD_PER_SEARCH` | `0.02` | Hard ceiling on any single search. The gateway rejects anything above it. |
| `DAILY_BUDGET_USD` | `1.00` | Stops searching once the day's spend hits this. |

Both are optional secrets you can change without touching the code.

If you make this public and let strangers use it, they are spending *your*
balance. Keep the budget low, or make each visitor bring their own key.

## Make it yours

- **Change what comes back.** `server.js` keeps the author, text, timestamp and
  engagement counts. The raw response has more in it, so log it once and see.
- **Feed it to a model.** Twenty full posts is a small enough payload to hand
  straight to an LLM, which is the point: ask what people keep bringing up, and
  have it cite the posts.
- **Find something else entirely.** `GET https://app.taskfuel.ai/v1/discover?q=...`
  searches every provider in the catalog. There are around 90 of them, covering
  search, market data, email, phone calls and images.

The write-up behind this template:
[Let your agent analyze X for you](https://taskfuel.ai/blog/x-search-for-ai-agents/?utm_source=replit&utm_medium=referral&utm_campaign=2026-09-replit-templates&utm_content=one-search-twenty-x-posts).

Full guide for wiring an app to the gateway:
[app.taskfuel.ai/building-apps.md](https://app.taskfuel.ai/building-apps.md)

## Running outside Replit

```bash
cp .env.example .env   # then put your real key in it
node --env-file=.env server.js
```

Needs Node 20 or newer. There are no dependencies to install.
