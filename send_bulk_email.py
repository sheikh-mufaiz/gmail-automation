"""
Bulk Gmail sender.

Reads a list of email addresses from an Excel file and sends the same
subject/body to each address individually (one recipient per email, so
nobody sees the rest of the list) using Gmail SMTP + an App Password.

Usage:
    python send_bulk_email.py
"""

import csv
import re
import smtplib
import sys
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import pandas as pd

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
DELAY_BETWEEN_EMAILS_SECONDS = 2

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def prompt_nonempty(label):
    while True:
        value = input(label).strip()
        if value:
            return value
        print("This can't be empty, try again.")


def load_excel_path():
    while True:
        path_str = prompt_nonempty("Path to Excel file (.xlsx/.xls): ")
        # Strip surrounding quotes, e.g. from Windows "Copy as path"
        path_str = path_str.strip().strip('"').strip("'")
        path = Path(path_str).expanduser()
        if path.exists():
            return path
        print(f"File not found: {path}")


def load_recipients(path):
    # Read with no header assumption: a sheet with just a bare list of emails
    # (no "email" title row) would otherwise lose its first row to pandas
    # treating it as a column name.
    df = pd.read_excel(path, header=None, dtype=str)
    if df.empty:
        print("The Excel file has no rows.")
        sys.exit(1)

    raw_values = []
    for row in df.itertuples(index=False):
        for value in row:
            if pd.notna(value):
                raw_values.append(str(value).strip())

    seen = set()
    recipients = []
    invalid = []
    duplicates = []
    for email in raw_values:
        if not email:
            continue
        if not EMAIL_REGEX.match(email):
            invalid.append(email)
            continue
        if email.lower() in seen:
            duplicates.append(email)
            continue
        seen.add(email.lower())
        recipients.append(email)

    print(f"\nScanned {len(raw_values)} cell(s) across the sheet.")

    if invalid:
        print(f"Ignored {len(invalid)} cell(s) that don't look like valid emails (e.g. headers/notes):")
        for bad in invalid[:10]:
            print(f"  - {bad}")
        if len(invalid) > 10:
            print(f"  ... and {len(invalid) - 10} more")

    if duplicates:
        print(f"Skipping {len(duplicates)} duplicate email(s):")
        for dup in duplicates[:10]:
            print(f"  - {dup}")
        if len(duplicates) > 10:
            print(f"  ... and {len(duplicates) - 10} more")

    return recipients


def read_body():
    raw = prompt_nonempty(
        "Message body (one line; type \\n where you want a line break): "
    )
    return raw.replace("\\n", "\n")


def build_message(from_addr, to_addr, subject, body):
    msg = MIMEMultipart()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    return msg


def main():
    print("=== Bulk Gmail Sender ===\n")

    gmail_address = prompt_nonempty("Your Gmail address: ")
    app_password = prompt_nonempty(
        "Gmail App Password (visible as you type, not your normal password): "
    )

    excel_path = load_excel_path()
    recipients = load_recipients(excel_path)

    if not recipients:
        print("No valid email addresses found in the file. Exiting.")
        sys.exit(1)

    print(f"\nFound {len(recipients)} valid recipient(s).")

    subject = prompt_nonempty("\nSubject: ")
    body = read_body()

    print("\n--- Preview ---")
    print(f"From:    {gmail_address}")
    print(f"To:      {len(recipients)} recipient(s) (sent individually)")
    print(f"Subject: {subject}")
    print("Body:")
    print(body)
    print("---------------")

    confirm = input(f"\nSend this to all {len(recipients)} recipient(s)? [y/N]: ").strip().lower()
    if confirm != "y":
        print("Aborted, nothing was sent.")
        return

    results = []  # list of (email, status, detail)

    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(gmail_address, app_password)
    except smtplib.SMTPAuthenticationError:
        print(
            "\nLogin failed. Make sure you're using a Gmail App Password, not your "
            "account password. See README.md for setup steps."
        )
        sys.exit(1)

    print()
    try:
        for i, recipient in enumerate(recipients, start=1):
            msg = build_message(gmail_address, recipient, subject, body)
            try:
                server.sendmail(gmail_address, recipient, msg.as_string())
                print(f"[{i}/{len(recipients)}] ACCEPTED -> {recipient}")
                results.append((recipient, "ACCEPTED", ""))
            except smtplib.SMTPException as exc:
                print(f"[{i}/{len(recipients)}] FAILED   -> {recipient} ({exc})")
                results.append((recipient, "FAILED", str(exc)))

            if i < len(recipients):
                time.sleep(DELAY_BETWEEN_EMAILS_SECONDS)
    finally:
        server.quit()

    accepted = [r for r in results if r[1] == "ACCEPTED"]
    failed = [r for r in results if r[1] == "FAILED"]

    print("\n--- Status per email ---")
    for email, status, detail in results:
        line = f"{status:8s} - {email}"
        if detail:
            line += f" ({detail})"
        print(line)

    print(f"\nDone. Accepted by Gmail: {len(accepted)}  Failed immediately: {len(failed)}")
    print(
        "Note: ACCEPTED means Gmail's server agreed to deliver the message, not that it "
        "was confirmed delivered. Addresses that don't actually exist usually bounce back "
        "to your own inbox a little later, rather than failing here immediately."
    )

    report_path = Path("email_status_report.csv")
    with report_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["email", "status", "detail"])
        writer.writerows(results)
    print(f"Full status report saved to {report_path.resolve()}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted, exiting.")
