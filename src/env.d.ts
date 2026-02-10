export {};

declare global {
  interface Env {
    CHATWOOT_BASE_URL: string;
    CHATWOOT_ACCOUNT_ID: string;
    CHATWOOT_API_TOKEN: string;
  }
}
