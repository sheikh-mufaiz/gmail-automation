# Gmail Bulk Sender — Web UI (Cloudflare Worker)

A hosted version of the bulk sender: a web page where you enter your Gmail
credentials, upload an Excel file of recipients, write your message, and
watch a live per-recipient send status. Runs entirely on your own Cloudflare
Worker — nothing is sent to any third-party server.

How it works:
- The static page (`public/`) is served directly by Cloudflare's Workers Assets.
- Submitting the form calls `POST /api/send` on the same Worker.
- The Worker parses the Excel file with SheetJS, then connects **directly to
  Gmail's SMTP server** from inside the Worker (using Cloudflare's TCP Sockets
  API + STARTTLS) via the [`worker-mailer`](https://github.com/zou-yu/worker-mailer)
  library — the same approach as the local Python script, just running at the edge.
- Send progress streams back to the browser live (NDJSON), so you see each
  recipient's status (`SENT`/`FAILED`) as it happens.

Your Gmail address/app password/message/file are only ever held in memory for
the duration of that one request — nothing is persisted anywhere.

## 1. Set up a Gmail App Password

Same as the CLI version:
1. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification
2. Create an app password: https://myaccount.google.com/apppasswords
3. Use that 16-character password in the web form, not your normal Gmail password.

## 2. Install dependencies

```bash
npm install
```

## 3. Run locally

```bash
npm run dev
```

This starts `wrangler dev`. Open the printed local URL (e.g. `http://127.0.0.1:8787`)
in your browser to use the app locally before deploying.

## 4. (Recommended) Restrict who can use it

By default, anyone who finds your deployed URL can submit the form with
*their own* Gmail credentials and use your Worker to send mail — not a risk
to your Gmail account, but it does let strangers spend your Cloudflare quota
as a free relay. To lock it down, set a shared passphrase:

```bash
npx wrangler secret put ACCESS_PASSPHRASE
# paste a passphrase when prompted
```

Once set, every request to `/api/send` must include the matching passphrase
(there's a field for it at the top of the page), or it's rejected with 401.
Leave this secret unset if you only ever run it locally for yourself.

For local `wrangler dev` testing with the gate enabled, create a `.dev.vars`
file (already gitignored) with:

```
ACCESS_PASSPHRASE=whatever-you-want-locally
```

## 5. Deploy to Cloudflare

You'll need a (free) Cloudflare account. Then:

```bash
npx wrangler login
npm run deploy
```

Wrangler will print your live URL, e.g. `https://gmail-bulk-sender.<your-subdomain>.workers.dev`.
That's it — the page, and the sending logic, are now hosted on Cloudflare's edge.

## Notes / limits

- Cloudflare Workers cannot open outbound connections on port 25, so this
  uses port 587 (STARTTLS) to `smtp.gmail.com`, exactly like the CLI script.
- There's a 2-second delay between sends and a safety cap of 500 recipients
  per run (Gmail's standard daily sending limit for personal accounts).
- Each recipient gets their own individual email — nobody sees the other
  addresses.
- If you want to change the SMTP delay, recipient cap, or add HTML emails /
  attachments, see `src/index.ts` and the `worker-mailer` docs.
