// Internal defaults for Keyway CLI. These values are bundled so the CLI works out of the box.
// Environment variables (e.g., KEYWAY_API_URL, KEYWAY_POSTHOG_KEY, KEYWAY_POSTHOG_HOST) can override at runtime for development.

export const INTERNAL_API_URL = 'https://api.keyway.sh';
export const INTERNAL_POSTHOG_KEY = 'phc_duG0qqI5z8LeHrS9pNxR5KaD4djgD0nmzUxuD3zP0ov'; // Public/ingestion key; leave empty to disable by default.
export const INTERNAL_POSTHOG_HOST = 'https://eu.i.posthog.com';
