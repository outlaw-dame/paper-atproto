import { PGlite } from '@electric-sql/pglite';
/**
 * Database Utility using PGlite and Drizzle ORM.
 * Persists to IndexedDB for local-first reliability.
 */
export declare class PaperDB {
    private pg;
    private db;
    constructor();
    init(): Promise<void>;
    buildIndexes(): Promise<void>;
    getDB(): any;
    getPG(): PGlite;
}
export declare const paperDB: PaperDB;
//# sourceMappingURL=db.d.ts.map