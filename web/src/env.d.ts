// wrangler types only generates bindings declared in wrangler.jsonc. Secrets are
// intentionally never declared there (per Cloudflare's own guidance), so this
// augments the generated Env interface by hand. Re-add after `wrangler types`
// regenerates worker-configuration.d.ts if this ever gets clobbered.
declare global {
  interface Env {
    /**
     * Optional shared passphrase gating /api/send, so the deployed URL can't be
     * used by strangers as an anonymous SMTP relay. Set with:
     *   wrangler secret put ACCESS_PASSPHRASE
     * If unset, /api/send is open to anyone who has the URL.
     */
    ACCESS_PASSPHRASE?: string;
  }
}

export {};
