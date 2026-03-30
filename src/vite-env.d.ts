/// <reference types="vite/client" />

declare module '*.css';

interface ImportMetaEnv {
	readonly VITE_ATPROTO_OAUTH_CLIENT_ID?: string;
	readonly VITE_ATPROTO_HANDLE_RESOLVER?: string;
	readonly VITE_ATPROTO_OAUTH_SCOPE?: string;
	readonly VITE_ATPROTO_OAUTH_CLIENT_NAME?: string;
	readonly VITE_ATPROTO_OAUTH_TOS_URI?: string;
	readonly VITE_ATPROTO_OAUTH_PRIVACY_URI?: string;
	readonly VITE_ATPROTO_OAUTH_METADATA_ORIGIN?: string;
	readonly VITE_ATPROTO_OAUTH_REDIRECT_URIS?: string;
	readonly VITE_OAUTH_DEBUG?: string;
	readonly VITE_WEB_PUSH_VAPID_PUBLIC_KEY?: string;
	readonly VITE_VAPID_PUBLIC_KEY?: string;
	readonly VITE_PUSH_SUBSCRIPTION_ENDPOINT?: string;
	readonly VITE_CLOUDKIT_CONTAINER_ID?: string;
	readonly VITE_CLOUDKIT_API_TOKEN?: string;
	readonly VITE_CLOUDKIT_ENV?: string;
	readonly VITE_CLOUDKIT_ENVIRONMENT?: string;
	readonly VITE_CLOUDKIT_JS_SRC?: string;
	readonly VITE_ENABLE_DRAFT_RECOVERY_MIRROR?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
