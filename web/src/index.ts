import { WorkerMailer } from "worker-mailer";
import { extractRecipients } from "./excel";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const DELAY_BETWEEN_EMAILS_MS = 2000;
const MAX_RECIPIENTS = 500; // roughly Gmail's daily send limit for regular accounts
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB is generous for an email-list spreadsheet

type ProgressEvent =
  | { type: "info"; message: string }
  | { type: "result"; email: string; status: "ACCEPTED" | "FAILED"; detail?: string }
  | { type: "done"; accepted: number; failed: number };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/send" && request.method === "POST") {
      return handleSend(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleSend(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Could not read the submitted form.", 400);
  }

  const gmailAddress = String(form.get("gmailAddress") ?? "").trim();
  const appPassword = String(form.get("appPassword") ?? "");
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "");
  const accessPassphrase = String(form.get("accessPassphrase") ?? "");
  const file = form.get("file");

  if (env.ACCESS_PASSPHRASE) {
    const ok = await timingSafeStringsEqual(accessPassphrase, env.ACCESS_PASSPHRASE);
    if (!ok) {
      return jsonError("Incorrect (or missing) access passphrase.", 401);
    }
  }

  if (!gmailAddress || !appPassword || !subject || !body || !(file instanceof File)) {
    return jsonError("Missing required fields: Gmail address, app password, subject, body, and Excel file are all required.", 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return jsonError(`That file is too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`, 400);
  }

  let parsed: ReturnType<typeof extractRecipients>;
  try {
    const buffer = await file.arrayBuffer();
    parsed = extractRecipients(buffer);
  } catch (err) {
    return jsonError(`Could not read the Excel file: ${errorMessage(err)}`, 400);
  }

  if (parsed.recipients.length === 0) {
    return jsonError("No valid email addresses were found in that file.", 400);
  }

  if (parsed.recipients.length > MAX_RECIPIENTS) {
    return jsonError(
      `Found ${parsed.recipients.length} recipients, which is above the safety limit of ${MAX_RECIPIENTS} per run (close to Gmail's daily sending limit).`,
      400,
    );
  }

  const stream = buildProgressStream(parsed, { gmailAddress, appPassword, subject, body });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function buildProgressStream(
  parsed: ReturnType<typeof extractRecipients>,
  creds: { gmailAddress: string; appPassword: string; subject: string; body: string },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      emit({
        type: "info",
        message:
          `Scanned ${parsed.scannedCells} cell(s) across the sheet. ` +
          `Ignored ${parsed.invalidCount} invalid and ${parsed.duplicateCount} duplicate ` +
          `entr${parsed.duplicateCount === 1 ? "y" : "ies"}. ${parsed.recipients.length} recipient(s) to send to.`,
      });

      let mailer: WorkerMailer;
      try {
        mailer = await WorkerMailer.connect({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: false,
          startTls: true,
          credentials: { username: creds.gmailAddress, password: creds.appPassword },
          authType: "plain",
        });
      } catch (err) {
        emit({
          type: "result",
          email: "(login)",
          status: "FAILED",
          detail: `Login failed - make sure you're using a Gmail App Password: ${errorMessage(err)}`,
        });
        emit({ type: "done", accepted: 0, failed: parsed.recipients.length });
        controller.close();
        return;
      }

      let accepted = 0;
      let failed = 0;

      for (let i = 0; i < parsed.recipients.length; i++) {
        const recipient = parsed.recipients[i];
        try {
          await mailer.send({
            from: creds.gmailAddress,
            to: recipient,
            subject: creds.subject,
            text: creds.body,
          });
          accepted++;
          emit({ type: "result", email: recipient, status: "ACCEPTED" });
        } catch (err) {
          failed++;
          emit({ type: "result", email: recipient, status: "FAILED", detail: errorMessage(err) });
        }

        if (i < parsed.recipients.length - 1) {
          await sleep(DELAY_BETWEEN_EMAILS_MS);
        }
      }

      await mailer.close().catch(() => {
        // Connection may already be closed by the server; nothing actionable here.
      });

      emit({ type: "done", accepted, failed });
      controller.close();
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Constant-time comparison for secret values. Both inputs are hashed to a
 * fixed size first so the comparison never leaks the expected value's length
 * via timing, then compared with the platform's timing-safe primitive.
 */
async function timingSafeStringsEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ type: "error", message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
