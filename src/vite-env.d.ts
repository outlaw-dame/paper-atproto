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
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
