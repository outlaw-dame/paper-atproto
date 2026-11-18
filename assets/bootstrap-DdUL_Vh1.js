const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/modelManager-oSxMX3sY.js","assets/rolldown-runtime-BYbx6iT9.js","assets/db-CzvN3-FU.js","assets/runtimeStore-C_qWYRxB.js","assets/schemas-DewLB7qg.js","assets/middleware-2dCbd7v8.js","assets/react-EviIgyaz.js","assets/intelligenceEvents-Cp0abeKo.js","assets/generationSession-BRKDxmPZ.js","assets/InferenceClient-CJCQnnrF.js"])))=>i.map(i=>d[i]);
import{t as e}from"./platformDetect-DKEZJTzp.js";import{s as t}from"./vendor-pglite-CG2co3QG.js";import{a as n,f as r,i,r as a}from"./index-w9eYe9VJ.js";import{t as o}from"./db-CzvN3-FU.js";import{n as s,r as c}from"./bootstrapTelemetry-DLExnkFO.js";import{a as l,n as u,r as d}from"./externalUrl-_s24Ecn3.js";import{n as f}from"./generationSession-BRKDxmPZ.js";async function p(){let e=o.getPG();console.log(`[Migration] Checking local database schema and indexes...`);try{await e.exec(`
      -- Backfill context columns used for thread resolution.
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS uri TEXT;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_to TEXT;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_root TEXT;

      -- Thread lookup path.
      CREATE INDEX IF NOT EXISTS idx_posts_uri ON posts (uri);

      -- Hot sort/filter paths and referencing-column indexes that PostgreSQL
      -- intentionally does not create automatically for foreign keys.
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_post_id ON entities (post_id);
      CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id_pub_date ON feed_items (feed_id, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_items_pub_date ON feed_items (pub_date DESC);

      -- Keep materialized tsvectors weighted and consistent across updates.
      CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
      BEGIN
        new.search_vector :=
          setweight(to_tsvector('english', coalesce(new.content, '')), 'D') ||
          setweight(to_tsvector('english', coalesce(new.image_alt_text, '')), 'B');
        RETURN new;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_posts_search_vector_update ON posts;
      CREATE TRIGGER trg_posts_search_vector_update
      BEFORE INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();

      CREATE OR REPLACE FUNCTION feed_items_search_vector_update() RETURNS trigger AS $$
      BEGIN
        new.search_vector :=
          setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(new.content, '')), 'D');
        RETURN new;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_feed_items_search_vector_update ON feed_items;
      CREATE TRIGGER trg_feed_items_search_vector_update
      BEFORE INSERT OR UPDATE ON feed_items
      FOR EACH ROW EXECUTE FUNCTION feed_items_search_vector_update();

      -- Backfill existing rows that were created before trigger setup.
      UPDATE posts
      SET search_vector =
        setweight(to_tsvector('english', coalesce(content, '')), 'D') ||
        setweight(to_tsvector('english', coalesce(image_alt_text, '')), 'B')
      WHERE search_vector IS NULL;

      UPDATE feed_items
      SET search_vector =
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'D')
      WHERE search_vector IS NULL;
    `),console.log(`[Migration] Local database schema updated successfully.`)}catch(e){console.error(`[Migration] Failed to update local database schema:`,e)}}var m=null;function h(e){if(!(e instanceof Element))return null;let t=e.closest(`a[href]`);return!(t instanceof HTMLAnchorElement)||(t.target??``).toLowerCase()!==`_blank`?null:t}function g(e){let t=(e.getAttribute(`href`)??e.href).trim();return!t||t===`#`?null:d(t)}function _(){if(typeof document>`u`||m===document)return;m=document;let e=e=>{if(e.defaultPrevented)return;let t=h(e.target);if(!t)return;let n=g(t);if(!n){l(),e.preventDefault();return}e.preventDefault(),u(n)};document.addEventListener(`click`,t=>{e(t)},!0),document.addEventListener(`auxclick`,t=>{t instanceof MouseEvent&&t.button===1&&e(t)},!0),document.addEventListener(`keydown`,t=>{t instanceof KeyboardEvent&&t.key===`Enter`&&e(t)},!0)}function v(){if(typeof navigator>`u`||typeof window>`u`)return!1;let{isIOS:t,isAndroid:n,deviceMemory:r}=e();return t||n||r>0&&r<=4}function y(e){let t=String(e??``).trim().toLowerCase();return t===`1`||t===`true`||t===`yes`}function b(){return y(`0`)}async function x(){console.log(`[Bootstrap] Initializing...`),a(),_(),n(),i(),await f(),c(`dbInit`);try{await o.init();let e=o.getRuntimeInfo();s(`dbInit`,{status:`passed`,message:e.backend===`worker`?`Worker-backed local database is ready.`:e.fallbackReason?`Local database is ready using the in-thread fallback. ${e.fallbackReason}`:`In-thread local database is ready.`,metadata:{backend:e.backend,persistent:e.persistent,...e.fallbackReason?{fallbackReason:e.fallbackReason}:{}}})}catch(e){throw s(`dbInit`,{status:`failed`,message:e instanceof Error?e.message:`Local database initialization failed.`}),e}c(`migrations`);try{await p(),s(`migrations`,{status:`passed`,message:`Local schema migrations completed.`})}catch(e){throw s(`migrations`,{status:`failed`,message:e instanceof Error?e.message:`Local schema migrations failed.`}),e}r().catch(e=>{console.warn(`[Bootstrap] Platform bootstrap failed (non-fatal):`,e)}),c(`runtimeProbe`),t(async()=>{let{browserModelManager:e}=await import(`./modelManager-oSxMX3sY.js`).then(e=>e.n);return{browserModelManager:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9])).then(({browserModelManager:e})=>e.initCapabilityProbe()).then(()=>{s(`runtimeProbe`,{status:`passed`,message:`Runtime capability probe completed.`})}).catch(e=>{s(`runtimeProbe`,{status:`failed`,message:e instanceof Error?e.message:`Runtime capability probe failed.`}),console.warn(`[Bootstrap] Runtime capability probe failed (non-fatal):`,e)});let e=()=>{c(`runtimeSmoke`),t(async()=>{let{browserModelManager:e}=await import(`./modelManager-oSxMX3sY.js`).then(e=>e.n);return{browserModelManager:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9])).then(({browserModelManager:e})=>e.runRuntimeSmokeCheck()).then(e=>{s(`runtimeSmoke`,{status:e.overallState===`passed`?`passed`:`failed`,message:e.overallState===`passed`?`Runtime smoke checks passed.`:e.db.state===`failed`?e.db.message:e.browserMl.message})}).catch(e=>{s(`runtimeSmoke`,{status:`failed`,message:e instanceof Error?e.message:`Runtime smoke check failed.`}),console.warn(`[Bootstrap] Runtime smoke check failed (non-fatal):`,e)})};if(b()?typeof requestIdleCallback<`u`?requestIdleCallback(e,{timeout:12e3}):setTimeout(e,8e3):s(`runtimeSmoke`,{status:`skipped`,message:`Skipped browser ML smoke check. Set VITE_ENABLE_BROWSER_ML_SMOKE=1 to start the inference worker during bootstrap diagnostics.`}),v()){s(`indexBuild`,{status:`skipped`,message:`Skipped HNSW index build on mobile, standalone, or low-memory device.`}),console.log(`[Bootstrap] Skipping HNSW index build on mobile/standalone or low-memory devices.`),console.log(`[Bootstrap] Semantic search will still work, but vector ranking may be slower.`),console.log(`[Bootstrap] Done.`);return}let l=()=>{c(`indexBuild`),o.buildIndexes().then(()=>{s(`indexBuild`,{status:`passed`,message:`Deferred HNSW indexes are ready.`})}).catch(e=>{s(`indexBuild`,{status:`failed`,message:e instanceof Error?e.message:`HNSW index build failed.`}),console.warn(`[Bootstrap] HNSW index build failed (non-fatal):`,e)})};typeof requestIdleCallback<`u`?requestIdleCallback(l,{timeout:1e4}):setTimeout(l,5e3),console.log(`[Bootstrap] Done.`)}export{x as initApp};