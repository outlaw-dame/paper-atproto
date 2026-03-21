# Technology Stack

This document outlines the core technologies and frameworks selected for the local-first ATProto application, inspired by Facebook Paper.

## Core Principles

*   **Local-First Software:** Prioritizing local data storage and computation, enabling offline functionality and fast user interfaces. Conflict resolution and synchronization will be handled gracefully.
*   **ATProto Integration:** Leveraging the Authenticated Transfer Protocol (ATProto) for decentralized data storage, identity, and social graph management.
*   **Modern Web Technologies:** Utilizing contemporary web development practices for a performant, scalable, and maintainable application.
*   **User Experience (UX):** Emphasizing a fluid, intuitive, and visually appealing user interface, drawing inspiration from Facebook Paper's innovative design.

## Proposed Technologies

### Frontend

*   **Framework:** React (with Next.js for SSR/SSG) - For building dynamic and responsive user interfaces.
*   **Styling:** Tailwind CSS - For utility-first CSS styling, enabling rapid UI development and consistency.
*   **UI Components:** Konsta UI - For mobile-first, iOS-style UI components that follow Apple's design guidelines.
*   **Emoji Support:** Twemoji - For consistent, high-quality emoji rendering across all platforms.
*   **State Management:** Zustand or Jotai - Lightweight and performant state management solutions for local-first data.
*   **Offline-First/Data Persistence:** PGlite (Postgres WASM) - For robust client-side data storage with full SQL support, persisting to IndexedDB or OPFS.
*   **Hybrid Search:** PGlite with `pgvector` and `transformers.js` - Combining full-text search (tsvector) and semantic search (vector embeddings) for high-performance, intent-aware discovery.
*   **ATProto Client:** `@atproto/api` - Official ATProto client library for interacting with the ATProto network.

### Backend (Optional/Minimal)

Given the local-first and ATProto-centric nature, a traditional backend might be minimal or entirely absent for core functionalities. However, a small serverless function layer might be considered for:

*   **ATProto Relay/PDS Proxy:** To handle certain ATProto interactions or act as a personal data server (PDS) if self-hosting is desired.
*   **Image/Media Processing:** For optimizing and serving media content.

### Data Storage

*   **Local:** IndexedDB - Primary local data store.
*   **Decentralized:** ATProto Personal Data Server (PDS) - For decentralized and federated data storage.

### Development Tools

*   **Package Manager:** pnpm - For efficient dependency management.
*   **TypeScript:** For type safety and improved developer experience.
*   **Linting/Formatting:** ESLint, Prettier - For code quality and consistency.
*   **Testing:** Jest, React Testing Library - For unit and integration testing.

## Justification

This stack is chosen to balance the requirements of a local-first application with the decentralized nature of ATProto, while providing a modern and efficient development experience. React and Next.js offer a powerful frontend foundation, while IndexedDB and ATProto provide the necessary data persistence and decentralization capabilities. Tailwind CSS will enable rapid iteration on the UI, aiming for the polished feel of Facebook Paper.
