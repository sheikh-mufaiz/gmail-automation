const form = document.getElementById("send-form");
const submitBtn = document.getElementById("submit-btn");
const fileInput = document.getElementById("file");
const fileDrop = document.getElementById("file-drop");
const fileDropLabel = document.getElementById("file-drop-label");

const confirmPanel = document.getElementById("confirm-panel");
const confirmFrom = document.getElementById("confirm-from");
const confirmSubject = document.getElementById("confirm-subject");
const confirmBody = document.getElementById("confirm-body");
const confirmCount = document.getElementById("confirm-count");
const confirmCancelBtn = document.getElementById("confirm-cancel");
const confirmSendBtn = document.getElementById("confirm-send");

const progressPanel = document.getElementById("progress-panel");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressSummary = document.getElementById("progress-summary");
const progressLog = document.getElementById("progress-log");

let pendingFormData = null;

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileDropLabel.textContent = file ? file.name : "Click to choose a file, or drag one here";
});

["dragover", "dragleave", "drop"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (e) => {
    e.preventDefault();
    fileDrop.classList.toggle("dragover", eventName === "dragover");
  });
});

fileDrop.addEventListener("drop", (e) => {
  const dropped = e.dataTransfer?.files?.[0];
  if (dropped) {
    fileInput.files = e.dataTransfer.files;
    fileDropLabel.textContent = dropped.name;
  }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  pendingFormData = new FormData(form);

  confirmFrom.textContent = pendingFormData.get("gmailAddress");
  confirmSubject.textContent = pendingFormData.get("subject");
  confirmBody.textContent = pendingFormData.get("body");
  confirmCount.textContent = "Click \"Send now\" to start sending. You'll see a live status for each recipient below.";

  form.classList.add("hidden");
  confirmPanel.classList.remove("hidden");
  progressPanel.classList.add("hidden");
});

confirmCancelBtn.addEventListener("click", () => {
  confirmPanel.classList.add("hidden");
  form.classList.remove("hidden");
});

confirmSendBtn.addEventListener("click", async () => {
  if (!pendingFormData) return;

  confirmPanel.classList.add("hidden");
  progressPanel.classList.remove("hidden");
  progressLog.innerHTML = "";
  progressBarFill.style.width = "0%";
  progressSummary.textContent = "Connecting to Gmail…";
  confirmSendBtn.disabled = true;

  try {
    await sendAndTrack(pendingFormData);
  } catch (err) {
    addLogRow({ type: "result", email: "(request)", status: "FAILED", detail: String(err) });
    progressSummary.textContent = "Something went wrong before sending could finish.";
  } finally {
    confirmSendBtn.disabled = false;
  }
});

async function sendAndTrack(formData) {
  const response = await fetch("/api/send", { method: "POST", body: formData });

  if (!response.ok || !response.body) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {
      // not JSON, use raw text
    }
    progressSummary.textContent = `Failed: ${message}`;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let processed = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);

      if (event.type === "info") {
        addInfoRow(event.message);
        const match = /(\d+) recipient/.exec(event.message);
        if (match) total = Number(match[1]);
        progressSummary.textContent = event.message;
      } else if (event.type === "result") {
        processed++;
        addLogRow(event);
        if (total > 0) {
          progressBarFill.style.width = `${Math.min(100, (processed / total) * 100)}%`;
        }
        progressSummary.textContent = `Processed so far: ${processed}${total ? ` / ${total}` : ""}`;
      } else if (event.type === "done") {
        progressBarFill.style.width = "100%";
        progressSummary.textContent = `Done. Accepted by Gmail: ${event.accepted}  Rejected immediately: ${event.failed}`;
      }
    }
  }
}

function addInfoRow(message) {
  const li = document.createElement("li");
  li.className = "info-row";
  li.textContent = message;
  progressLog.appendChild(li);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function addLogRow(event) {
  const li = document.createElement("li");

  const email = document.createElement("span");
  email.className = "email";
  email.textContent = event.email;

  const status = document.createElement("span");
  status.className = `status ${event.status === "ACCEPTED" ? "sent" : "failed"}`;
  status.textContent = event.status + (event.detail ? ` — ${event.detail}` : "");

  li.appendChild(email);
  li.appendChild(status);
  progressLog.appendChild(li);
  progressLog.scrollTop = progressLog.scrollHeight;
}
