# Gmail Bulk Sender

Send the same email to a list of recipients read from an Excel file, using
your Gmail account. Each recipient gets their own individual email (nobody
sees the other addresses).

There are two ways to use this:
- **[CLI script](#1-set-up-a-gmail-app-password)** (below) — run locally with Python.
- **[Web UI](./web/)** — a hosted version with a proper form (drag-and-drop file upload, a real multi-line textarea, live send progress) that you deploy to your own Cloudflare Worker with `wrangler`. See `web/README.md`.

## 1. Set up a Gmail App Password

Gmail won't let scripts log in with your normal password. You need an
**App Password**:

1. Turn on 2-Step Verification on your Google account: https://myaccount.google.com/signinoptions/two-step-verification
2. Go to https://myaccount.google.com/apppasswords
3. Create a new app password (name it e.g. "bulk sender"), copy the 16-character password shown.

You'll enter this app password when the script asks for your password, not your real Gmail password.

## 2. Install dependencies

```bash
pip install -r requirements.txt
```

## 3. Prepare your Excel file

A simple `.xlsx` file with a column of email addresses, e.g.:

| email              |
|--------------------|
| alice@example.com  |
| bob@example.com    |
| carol@example.com  |

A header row (e.g. `email`) is optional — the script scans every cell in the
sheet for anything that looks like an email address, wherever it is.
Invalid-looking cells and duplicates are skipped automatically (and reported
when you run it).

## 4. Run it

```bash
python send_bulk_email.py
```

You'll be asked for:
- Your Gmail address
- Your App Password (visible as you type)
- The path to your Excel file
- The subject
- The body (typed as one line; type `\n` anywhere you want a line break)

The script then shows a preview and asks you to confirm before sending
anything. As it sends, it prints a live SENT/FAILED line per recipient, and
at the end it writes a full per-email report to `email_status_report.csv`
(columns: `email`, `status`, `detail`).

## Notes

- There's a small delay (2s) between sends to avoid tripping Gmail's spam/rate limits.
- Gmail's standard accounts have a sending limit of ~500 emails/day. Google Workspace accounts have higher limits.
- Nothing is sent until you type `y` at the confirmation prompt.
