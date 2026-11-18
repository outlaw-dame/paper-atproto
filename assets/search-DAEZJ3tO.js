import{t as e}from"./db-DckQf5OZ.js";import{n as t,r as n,t as r}from"./embeddingTelemetry-B_8td9IE.js";import{a as i,i as a,n as o,t as s}from"./coordinator-COYBBJ3Q.js";import{t as c}from"./runtimeStore-C_qWYRxB.js";import{n as l,t as u}from"./backoffStrategy-PqiyVVJZ.js";var d={timeoutFallbackCount:0,lastTimeoutFallback:null,discoveryIntentCounts:{},discoveryRetryAttemptCount:0,discoveryRetryExhaustedCount:0,discoveryRetryOperations:{},lastDiscoveryRetryEvent:null};function f(){typeof window>`u`||(window.__GLYMPSE_HYBRID_SEARCH_METRICS__=h())}function p(e){d.timeoutFallbackCount+=1,d.lastTimeoutFallback={...e,triggeredAt:new Date().toISOString()},f()}function m(e,t){t&&(e[t]=(e[t]??0)+1)}function ee(e){return e===`status`||e===`network`||e===`timeout`||e===`temporary`||e===`unknown`?e:`unknown`}function te(e){let t=e.trim().toLowerCase().slice(0,24);t&&(m(d.discoveryIntentCounts,t),f())}function ne(e){let t=e.operation.trim().slice(0,48)||`unknown-operation`,n=Number.isFinite(e.attempt)?Math.max(1,Math.trunc(e.attempt)):1,r=Number.isFinite(e.maxAttempts)?Math.max(n,Math.trunc(e.maxAttempts)):n,i=Number.isFinite(e.statusCode)?Number(e.statusCode):null,a=ee(e.reasonCategory);d.discoveryRetryAttemptCount+=1,m(d.discoveryRetryOperations,t),e.exhausted&&(d.discoveryRetryExhaustedCount+=1),d.lastDiscoveryRetryEvent={operation:t,attempt:n,maxAttempts:r,statusCode:i,reasonCategory:a,exhausted:!!e.exhausted,triggeredAt:new Date().toISOString()},f()}function h(){return{timeoutFallbackCount:d.timeoutFallbackCount,lastTimeoutFallback:d.lastTimeoutFallback,discoveryIntentCounts:{...d.discoveryIntentCounts},discoveryRetryAttemptCount:d.discoveryRetryAttemptCount,discoveryRetryExhaustedCount:d.discoveryRetryExhaustedCount,discoveryRetryOperations:{...d.discoveryRetryOperations},lastDiscoveryRetryEvent:d.lastDiscoveryRetryEvent}}function g(){return{hasImages:!1,hasVideo:!1,hasLink:!1,imageAltText:``,imageCount:0}}function re(e){let t=Array.isArray(e.images)?e.images:[],n=e.media&&typeof e.media==`object`?e.media:null,r=n&&Array.isArray(n.images)?n.images:[];return[...t,...r]}function _(e){if(!e||typeof e!=`object`)return``;let t=e.uri;return typeof t==`string`?t.trim():``}function v(e){if(!e||typeof e!=`object`)return``;let t=e.uri;return typeof t==`string`?t.trim():``}function y(e){return!e||typeof e!=`object`?!1:e.video&&typeof e.video==`object`||typeof e.$type==`string`&&e.$type.includes(`.video`)?!0:y(e.media??null)}function b(e){if(!e)return g();let t=re(e),n=t.length>0,r=t.length,i=t?.map(e=>e.alt?.trim()||``).filter(e=>e.length>0).join(` | `).slice(0,2e3)||``,a=y(e),o=e.media&&typeof e.media==`object`?e.media:null,s=v(e.external),c=v(o?.external),l=_(e.record)||_(o?.record);return{hasImages:n,hasVideo:a,hasLink:s.length>0||c.length>0||l.length>0||!!(e.quote&&e.record),imageAltText:i,imageCount:r}}function x(e){if(!e)return g();try{return b(JSON.parse(e))}catch(e){return console.warn(`[extractMediaSignalsFromJson] Failed to parse embed:`,e),g()}}function S(e,t){if(!t)return 1;let n=1;return e.hasImages&&(n+=.12+Math.min(e.imageCount,4)*.015),e.hasVideo&&(n+=.16),e.hasLink&&(n+=.04),e.imageAltText.trim().length>0&&(n+=.02),Math.min(1.28,Math.round(n*1e3)/1e3)}var C=[`meme`,`screenshot`,`video`,`image`,`photo`,`picture`,`illustration`,`chart`,`graph`,`diagram`,`visual`,`design`,`art`,`artwork`,`drawing`,`sketch`,`screengrab`,`thumbnail`];function w(e){let t=e.toLowerCase();return C.some(e=>t.includes(e))}var ie=7e3,ae=120,T=.45,E=.3,D=.25,oe=.15,se=2,ce=3,O=6e4,k=128;function A(){return{BASE_URL:`/paper-atproto/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,VITE_ATPROTO_HANDLE_RESOLVER:`https://bsky.social`,VITE_ATPROTO_OAUTH_CLIENT_ID:`https://outlaw-dame.github.io/paper-atproto/oauth/client-metadata-v2.json`,VITE_ATPROTO_OAUTH_CLIENT_NAME:`Glimpse`,VITE_ATPROTO_OAUTH_METADATA_ORIGIN:`https://outlaw-dame.github.io/paper-atproto`,VITE_ATPROTO_OAUTH_PRIVACY_URI:``,VITE_ATPROTO_OAUTH_REDIRECT_URIS:`https://outlaw-dame.github.io/paper-atproto/`,VITE_ATPROTO_OAUTH_SCOPE:`atproto transition:generic rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app`,VITE_ATPROTO_OAUTH_TOS_URI:``,VITE_CLOUDKIT_API_TOKEN:``,VITE_CLOUDKIT_CONTAINER_ID:``,VITE_CLOUDKIT_ENVIRONMENT:`production`,VITE_CLOUDKIT_JS_SRC:``,VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML:`0`,VITE_ENABLE_BROWSER_ML_SMOKE:`0`,VITE_ENABLE_DRAFT_RECOVERY_MIRROR:`false`,VITE_EXTERNAL_URL_FAIL_CLOSED:`true`,VITE_GLYMPSE_VERIFY_BASE_URL:`http://localhost:3001/verification`,VITE_GLYMPSE_VERIFY_SHARED_SECRET:``,VITE_GLYMPSE_VERIFY_TIMEOUT_MS:`6000`,VITE_KLIPY_API_KEY:`your_klipy_api_key_here`,VITE_KLIPY_CLIENT_KEY:`paper-atproto`,VITE_OAUTH_DEBUG:`0`}}function j(e,t){if(typeof e!=`string`)return t;let n=Number(e.trim());return Number.isFinite(n)?Math.max(0,Math.trunc(n)):t}function M(e,t,n,r){if(typeof e!=`string`)return t;let i=Number(e.trim());return Number.isFinite(i)?Math.min(r,Math.max(n,i)):t}function N(e){if(typeof e!=`string`)return null;let t=Number(e.trim());return!Number.isFinite(t)||t<=0?null:t}function P(e){let t=e.rrfWeight+e.lexicalWeight+e.semanticWeight;return!Number.isFinite(t)||t<=0?{rrfWeight:T,lexicalWeight:E,semanticWeight:D}:{rrfWeight:e.rrfWeight/t,lexicalWeight:e.lexicalWeight/t,semanticWeight:e.semanticWeight/t}}function F(e=A()){let t=P({rrfWeight:M(e.VITE_HYBRID_SEARCH_RRF_WEIGHT,T,0,1),lexicalWeight:M(e.VITE_HYBRID_SEARCH_LEXICAL_WEIGHT,E,0,1),semanticWeight:M(e.VITE_HYBRID_SEARCH_SEMANTIC_WEIGHT,D,0,1)});return{queryTimeoutMs:j(e.VITE_HYBRID_SEARCH_QUERY_TIMEOUT_MS,ie),timeoutRetryDelayMs:j(e.VITE_HYBRID_SEARCH_TIMEOUT_RETRY_DELAY_MS,ae),rrfWeight:t.rrfWeight,lexicalWeight:t.lexicalWeight,semanticWeight:t.semanticWeight,confidenceWeight:M(e.VITE_HYBRID_SEARCH_CONFIDENCE_WEIGHT,oe,0,1),semanticDistanceCutoff:N(e.VITE_HYBRID_SEARCH_SEMANTIC_DISTANCE_CUTOFF),semanticCandidateMultiplier:Math.max(1,j(e.VITE_HYBRID_SEARCH_SEMANTIC_CANDIDATE_MULTIPLIER,se)),feedSemanticCandidateMultiplier:Math.max(1,j(e.VITE_HYBRID_SEARCH_FEED_CANDIDATE_MULTIPLIER,ce)),queryEmbedCacheTtlMs:Math.max(1e3,j(e.VITE_SEARCH_QUERY_CACHE_TTL_MS,O)),queryEmbedCacheMax:Math.max(8,j(e.VITE_SEARCH_QUERY_CACHE_MAX,k))}}var I=function(e){return e.CLOSED=`closed`,e.OPEN=`open`,e.HALF_OPEN=`half_open`,e}({}),L={failureThreshold:5,successThreshold:2,openTimeoutMs:3e4,halfOpenTimeoutMs:5e3},R=class{state=I.CLOSED;failureCount=0;successCount=0;lastStateChangeTime=Date.now();lastFailureTime=null;lastSuccessTime=null;totalRequests=0;blockedRequests=0;constructor(e){this.config=e}async execute(e,t=`operation`){this.totalRequests++;let n=this.resolveState();if(n===I.OPEN)throw this.blockedRequests++,new z(`Circuit breaker OPEN for ${t}; failing fast`);try{let t=await e();return this.recordSuccess(n),t}catch(e){throw this.recordFailure(n,e),e}}resolveState(){let e=Date.now()-this.lastStateChangeTime;return this.state===I.CLOSED?I.CLOSED:this.state===I.OPEN?e>=this.config.openTimeoutMs?(this.transitionToHalfOpen(),I.HALF_OPEN):I.OPEN:I.HALF_OPEN}recordSuccess(e){this.failureCount=0,this.lastSuccessTime=Date.now(),e===I.HALF_OPEN&&(this.successCount++,this.successCount>=this.config.successThreshold&&this.transitionToClosed())}recordFailure(e,t){if(this.lastFailureTime=Date.now(),e===I.HALF_OPEN){this.transitionToOpen();return}e===I.CLOSED&&(this.failureCount++,this.failureCount>=this.config.failureThreshold&&this.transitionToOpen())}transitionToClosed(){this.state=I.CLOSED,this.failureCount=0,this.successCount=0,this.lastStateChangeTime=Date.now()}transitionToOpen(){this.state=I.OPEN,this.successCount=0,this.lastStateChangeTime=Date.now()}transitionToHalfOpen(){this.state=I.HALF_OPEN,this.failureCount=0,this.successCount=0,this.lastStateChangeTime=Date.now()}getMetrics(){return{state:this.state,failureCount:this.failureCount,successCount:this.successCount,lastFailureTime:this.lastFailureTime,lastSuccessTime:this.lastSuccessTime,totalRequests:this.totalRequests,blockedRequests:this.blockedRequests}}reset(){this.state=I.CLOSED,this.failureCount=0,this.successCount=0,this.lastStateChangeTime=Date.now(),this.lastFailureTime=null,this.lastSuccessTime=null,this.totalRequests=0,this.blockedRequests=0}},z=class extends Error{constructor(e){super(e),this.name=`CircuitBreakerOpenError`}},B=class{healthCheckIntervalId=null;lastHealthCheckTime=0;healthStatus=`healthy`;consecutiveFailures=0;constructor(e,t,n=3e4){this.healthCheckFn=e,this.onStreamChange=t,this.checkIntervalMs=n}start(){this.healthCheckIntervalId||=setInterval(()=>{this.performHealthCheck()},this.checkIntervalMs)}stop(){this.healthCheckIntervalId&&=(clearInterval(this.healthCheckIntervalId),null)}async performHealthCheck(){try{let e=await this.healthCheckFn(),t=this.healthStatus===`healthy`;return e?(this.consecutiveFailures=0,this.healthStatus!==`healthy`&&(this.healthStatus=`healthy`,this.onStreamChange?.(!0))):(this.consecutiveFailures++,this.consecutiveFailures>=2&&(this.healthStatus=`failed`,t&&this.onStreamChange?.(!1))),this.lastHealthCheckTime=Date.now(),e}catch{return this.consecutiveFailures++,this.consecutiveFailures>=2&&this.healthStatus===`healthy`&&(this.healthStatus=`failed`,this.onStreamChange?.(!1)),!1}}getStatus(){return{status:this.healthStatus,consecutiveFailures:this.consecutiveFailures,lastCheckTime:this.lastHealthCheckTime}}dispose(){this.stop()}},V=20,H=50,U=class extends Error{constructor(e){super(e),this.name=`HybridSearchTimeoutError`}};function W(e){return Number.isFinite(e)?Math.max(1,Math.min(Math.trunc(e),H)):V}function G(e){return Number.isFinite(e)?Math.max(40,Math.min(Math.trunc(e),128)):40}function le(e){if(!(e instanceof Error))return!1;let t=e.message.toLowerCase();return t.includes(`hnsw.ef_search`)||t.includes(`unrecognized configuration parameter`)}function ue(e){return e instanceof U}function de(e){return!Number.isFinite(e)||e<=0?Promise.resolve():new Promise(t=>setTimeout(t,e))}function fe(e){return e&&e.trim().slice(0,64)||`policy-v1`}function pe(e){return e&&e.trim().slice(0,128)||`default`}function me(e){return n(e).slice(0,256)}function K(e){return w(e)}function q(e){return typeof e==`string`?e.trim():``}function he(e){return e.startsWith(`image/`)}function ge(e){return e.startsWith(`video/`)}function J(e){return/\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(e)}function Y(e){return/\.(m3u8|mov|mp4|m4v|webm)(\?.*)?$/i.test(e)}function X(e){let t=x(typeof e?.embed==`string`?e.embed:null),n=Number(e?.has_images??0)===1,r=Number(e?.has_video??0)===1,i=Number(e?.has_link??0)===1,a=q(e?.image_alt_text)||t.imageAltText,o=q(e?.enclosure_type).toLowerCase(),s=q(e?.enclosure_url),c=q(e?.link),l=q(e?.transcript_url),u=q(e?.chapters_url),d=he(o)||J(s)||J(c),f=ge(o)||Y(s)||Y(c),p=s.length>0||c.length>0||l.length>0||u.length>0;return{hasImages:t.hasImages||n||d,hasVideo:t.hasVideo||r||f,hasLink:t.hasLink||i||p,imageAltText:a,imageCount:Math.max(t.imageCount,n||d?1:0)}}function _e(e,t,n){let r=Number(e?.rrf_score??0),i=Number(e?.fts_rank_raw??0),a=Number(e?.semantic_distance??1.2),o=X(e),s=Number.isFinite(i)?Math.min(1,Math.max(0,i)):0,c=Number.isFinite(a)?Math.min(1,Math.max(0,1-a)):0,l=Math.min(1,Math.max(0,r*30)),u=n.rrfWeight*l+n.lexicalWeight*s+n.semanticWeight*c,d=S(o,t?.queryHasVisualIntent??!1);return u*=d,Math.round(Math.max(0,Math.min(1,u))*1e3)/1e3}function Z(e,t){let n={rrfWeight:Number(t?.rrfWeight??.45),lexicalWeight:Number(t?.lexicalWeight??.3),semanticWeight:Number(t?.semanticWeight??.25),confidenceWeight:Number(t?.confidenceWeight??.15)},r=Number.isFinite(t?.semanticDistanceCutoff)?Math.max(0,Number(t?.semanticDistanceCutoff)):null;return e.filter(e=>r===null||Number(e?.semantic_matched??0)!==1?!0:Number(e?.semantic_distance??1/0)<=r).map(e=>{let r=_e(e,t,n);return{...e,confidence_score:r,fused_score:Number(e?.rrf_score??0)+r*n.confidenceWeight}}).sort((e,t)=>Number(t.fused_score??0)-Number(e.fused_score??0))}function Q(e){return e===`private_corpus`||e===`private_draft`?`local_only`:`balanced`}function ve(e){return e===`public_corpus`}function ye(e){return{task:e.task,dataScope:e.dataScope,privacyMode:e.options.privacyMode??Q(e.dataScope),localSmallMlAvailable:e.options.localSmallMlAvailable??!0,edgeAvailable:e.options.edgeAvailable??ve(e.dataScope),localSearchQuality:e.localSearchQuality}}function be(e){return e?e.event.status!==`stale_discarded`&&!e.reasonCodes.includes(`stale_source_token`):!1}function xe(e,t){return e.lane===t.lane||e.lane===`edge_reranker`?e:t.lane===`edge_reranker`?{...e,lane:`edge_reranker`,fallbackLane:e.fallbackLane??`browser_small_ml`}:{...e,lane:t.lane,fallbackLane:t.fallbackLane??e.fallbackLane}}function $(e,t,n){let r=n.options.dataScope??n.fallbackDataScope,o=i({rows:t,resultLimit:n.limit,localIndexCoverage:n.options.localIndexCoverage??null}),s=a(ye({task:n.task,dataScope:r,options:n.options,localSearchQuality:o})),c=n.coordinatorAdvice??n.options.coordinatorAdvice??null,l=be(c)?xe(s,c):s;return{...e,rows:t,localSearchQuality:o,intelligenceRouting:l}}var Se=new class{resolvedRuntimeConfig;backoffTimer;circuitBreaker;healthMonitor;constructor(e={}){this.runtimeOptions=e,this.resolvedRuntimeConfig=F(),this.backoffTimer=new u(l),this.circuitBreaker=new R(L),this.healthMonitor=new B(()=>this.performConnectionHealthCheck(),e=>this.onConnectionHealthChange(e),3e4)}get queryTimeoutMs(){let e=this.runtimeOptions.queryTimeoutMs;return!Number.isFinite(e)||e===void 0?this.resolvedRuntimeConfig.queryTimeoutMs:Math.max(0,Math.trunc(e))}get timeoutRetryDelayMs(){let e=this.runtimeOptions.timeoutRetryDelayMs;return!Number.isFinite(e)||e===void 0?this.resolvedRuntimeConfig.timeoutRetryDelayMs:Math.max(0,Math.trunc(e))}get semanticDistanceCutoff(){let e=this.runtimeOptions.semanticDistanceCutoff;return Number.isFinite(e)?Math.max(0,Number(e)):this.resolvedRuntimeConfig.semanticDistanceCutoff}get semanticCandidateMultiplier(){return this.resolvedRuntimeConfig.semanticCandidateMultiplier}get feedSemanticCandidateMultiplier(){return this.resolvedRuntimeConfig.feedSemanticCandidateMultiplier}async adviseSearchRouting(e,t,n,r){if(n.coordinatorAdvice)return n.coordinatorAdvice;try{let i=c.getState(),a=n.privacyMode??Q(t);return await s.adviseOnSearch(o({surface:`search`,intent:e,scope:t,privacy:a,capability:i.capability??void 0,settingsMode:i.settingsMode,freshness:{sourceToken:null},textLength:0,estimatedPromptTokens:0,explicitUserAction:!1,hasSensitiveLocalData:t===`private_corpus`||t===`private_draft`,attachments:{count:0,hasImages:!1,hasLinks:!1,hasCode:!1}}),{silentRouterAudit:!0,...r?{signal:r}:{}})}catch{return null}}async withQueryTimeout(e,t){return this.queryTimeoutMs<=0?e:await new Promise((n,r)=>{let i=setTimeout(()=>{r(new U(t))},this.queryTimeoutMs);e.then(e=>{clearTimeout(i),n(e)},e=>{clearTimeout(i),r(e)})})}queryVectorCache=new Map;evictCacheIfNeeded(){let e=this.resolvedRuntimeConfig.queryEmbedCacheMax;if(this.queryVectorCache.size<=e)return;let t=this.queryVectorCache.keys().next().value;t&&this.queryVectorCache.delete(t)}cacheKeyForQuery(e,t){let n=me(e);return`${fe(t.policyVersion)}::${pe(t.moderationProfileHash)}::${n}`}async getQueryEmbedding(e,t={}){let n=this.cacheKeyForQuery(e,t),r=Date.now(),i=this.resolvedRuntimeConfig.queryEmbedCacheTtlMs;if(!t.disableCache){let e=this.queryVectorCache.get(n);if(e&&e.expiresAt>r)return this.queryVectorCache.delete(n),this.queryVectorCache.set(n,e),e.value}let a=await this.generateEmbedding(e,{mode:`query`});return!t.disableCache&&a.length>0&&(this.queryVectorCache.delete(n),this.queryVectorCache.set(n,{value:a,expiresAt:r+i}),this.evictCacheIfNeeded()),a}async generateEmbedding(e,n={}){let i=await t.embed(e,{mode:n.mode??`query`});return r(n.mode??`query`,i),i}async performConnectionHealthCheck(){try{let t=e.getPG();return await Promise.race([t.query(`SELECT 1`),new Promise((e,t)=>setTimeout(()=>t(Error(`Health check timeout`)),this.queryTimeoutMs/2))]),!0}catch(e){return console.debug(`[HybridSearch] Connection health check failed:`,e instanceof Error?e.message:`Unknown error`),!1}}onConnectionHealthChange(e){e?console.debug(`[HybridSearch] Database connection restored`):console.warn(`[HybridSearch] Database connection degraded; circuit breaker may activate`)}startHealthMonitoring(){this.healthMonitor.start()}stopHealthMonitoring(){this.healthMonitor.stop()}getCircuitBreakerMetrics(){return this.circuitBreaker.getMetrics()}resetCircuitBreaker(){this.circuitBreaker.reset()}async executeSemanticQuery(t,n,r,i){let a=e.getPG(),o=G(r);try{return await this.circuitBreaker.execute(()=>this.withQueryTimeout(a.transaction(async e=>(await e.query(`SET LOCAL hnsw.ef_search = ${o}`),e.query(t,n))),`Hybrid search transaction timed out after ${this.queryTimeoutMs}ms`),`[HybridSearch] ${i} semantic query execution`)}catch(e){if(le(e))return await this.withQueryTimeout(a.query(t,n),`Hybrid search fallback query timed out after ${this.queryTimeoutMs}ms`);if(ue(e))return p({scope:i,retryDelayMs:this.timeoutRetryDelayMs,timeoutMs:this.queryTimeoutMs}),await de(50+Math.random()*100),await this.withQueryTimeout(a.query(t,n),`Hybrid search retry timed out after ${this.queryTimeoutMs}ms`);throw e}}async search(e,t=20,n={}){let r=W(t),i={...n,queryHasVisualIntent:n.queryHasVisualIntent??K(e),semanticDistanceCutoff:n.semanticDistanceCutoff??this.semanticDistanceCutoff,rrfWeight:this.resolvedRuntimeConfig.rrfWeight,lexicalWeight:this.resolvedRuntimeConfig.lexicalWeight,semanticWeight:this.resolvedRuntimeConfig.semanticWeight,confidenceWeight:this.resolvedRuntimeConfig.confidenceWeight},a=`[${(await this.getQueryEmbedding(e,i)).join(`,`)}]`,o=r*this.semanticCandidateMultiplier,[s,c]=await Promise.allSettled([this.executeSemanticQuery(`
      WITH query_terms AS (
        SELECT websearch_to_tsquery('english', $1) AS q
      ),
      fts_results AS (
        SELECT id,
               ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, query_terms.q, 32) DESC) as rank
        FROM posts
        CROSS JOIN query_terms
        WHERE search_vector @@ query_terms.q
        LIMIT $2 * 2
      ),
      semantic_results AS (
        SELECT id,
               (embedding <=> $3::vector) AS semantic_distance,
               ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
        FROM posts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector ASC
        LIMIT $2 * 2
      )
      SELECT
        p.*,
        p.has_images,
        p.has_video,
        p.has_link,
        p.image_alt_text,
        COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) as rrf_score
      FROM posts p
      LEFT JOIN fts_results f ON p.id = f.id
      LEFT JOIN semantic_results s ON p.id = s.id
      WHERE f.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $2;
    `,[e,r,a,60],o,`search`),this.adviseSearchRouting(`local_search`,i.dataScope??`local_cache`,i)]);if(s.status===`rejected`)throw s.reason;let l=s.value,u=c.status===`fulfilled`?c.value:null;return $(l,Z(l.rows??[],i),{limit:r,task:`local_search`,fallbackDataScope:`local_cache`,options:i,coordinatorAdvice:u})}async searchAll(e,t=20,n={}){let r=W(t),i={...n,queryHasVisualIntent:n.queryHasVisualIntent??K(e),semanticDistanceCutoff:n.semanticDistanceCutoff??this.semanticDistanceCutoff,rrfWeight:this.resolvedRuntimeConfig.rrfWeight,lexicalWeight:this.resolvedRuntimeConfig.lexicalWeight,semanticWeight:this.resolvedRuntimeConfig.semanticWeight,confidenceWeight:this.resolvedRuntimeConfig.confidenceWeight},a=`[${(await this.getQueryEmbedding(e,i)).join(`,`)}]`,o=r*this.semanticCandidateMultiplier,[s,c]=await Promise.allSettled([this.executeSemanticQuery(`
          WITH query_terms AS (
       SELECT websearch_to_tsquery('english', $1) AS q
          ),
          fts_candidates AS (
        SELECT id, 'post' AS type,
         ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw
        FROM posts
       CROSS JOIN query_terms
       WHERE search_vector @@ query_terms.q
        UNION ALL
        SELECT id, 'feed_item' AS type,
         ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw
        FROM feed_items
       CROSS JOIN query_terms
       WHERE search_vector @@ query_terms.q
      ),
      fts_results AS (
        SELECT id, type, fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY fts_rank_raw DESC) AS rank
        FROM fts_candidates
        LIMIT $2 * 2
      ),
      post_semantic_candidates AS (
        SELECT id, 'post' AS type,
               (embedding <=> $3::vector) AS semantic_distance
        FROM posts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector ASC
        LIMIT $2 * 2
      ),
      feed_item_semantic_candidates AS (
        SELECT id, 'feed_item' AS type,
               (embedding <=> $3::vector) AS semantic_distance
        FROM feed_items
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector ASC
        LIMIT $2 * 2
      ),
      semantic_candidates AS (
        SELECT * FROM post_semantic_candidates
        UNION ALL
        SELECT * FROM feed_item_semantic_candidates
      ),
      semantic_results AS (
        SELECT id, type, semantic_distance,
               ROW_NUMBER() OVER (ORDER BY semantic_distance ASC) AS rank
        FROM semantic_candidates
        LIMIT $2 * 2
      )
      SELECT
        COALESCE(f.id, s.id) AS id,
        COALESCE(f.type, s.type) AS item_type,
        p.embed,
        p.has_images,
        p.has_video,
        p.has_link,
        p.image_alt_text,
        fi.link,
        fi.enclosure_url,
        fi.enclosure_type,
        fi.transcript_url,
        fi.chapters_url,
        COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) AS rrf_score
      FROM fts_results f
      FULL OUTER JOIN semantic_results s ON f.id = s.id AND f.type = s.type
      LEFT JOIN posts p ON COALESCE(f.id, s.id) = p.id AND COALESCE(f.type, s.type) = 'post'
      LEFT JOIN feed_items fi ON COALESCE(f.id, s.id) = fi.id AND COALESCE(f.type, s.type) = 'feed_item'
      ORDER BY rrf_score DESC
      LIMIT $2;
    `,[e,r,a,60],o,`searchAll`),this.adviseSearchRouting(`public_search`,i.dataScope??`public_corpus`,i)]);if(s.status===`rejected`)throw s.reason;let l=s.value,u=c.status===`fulfilled`?c.value:null;return $(l,Z(l.rows??[],i),{limit:r,task:`public_search`,fallbackDataScope:`public_corpus`,options:i,coordinatorAdvice:u})}async searchFeedItems(e,t=20,n={}){let r=W(t),i={...n,queryHasVisualIntent:n.queryHasVisualIntent??K(e),semanticDistanceCutoff:n.semanticDistanceCutoff??this.semanticDistanceCutoff,rrfWeight:this.resolvedRuntimeConfig.rrfWeight,lexicalWeight:this.resolvedRuntimeConfig.lexicalWeight,semanticWeight:this.resolvedRuntimeConfig.semanticWeight,confidenceWeight:this.resolvedRuntimeConfig.confidenceWeight},a=`[${(await this.getQueryEmbedding(e,i)).join(`,`)}]`,o=r*this.feedSemanticCandidateMultiplier,s=await this.executeSemanticQuery(`
      WITH query_terms AS (
        SELECT websearch_to_tsquery('english', $1) AS q
      ),
      fts_results AS (
        SELECT fi.id,
               ts_rank_cd(fi.search_vector, query_terms.q, 32) AS fts_rank_raw,
               ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(fi.search_vector, query_terms.q, 32) DESC
        ) as rank
        FROM feed_items fi
        CROSS JOIN query_terms
        WHERE fi.search_vector @@ query_terms.q
        LIMIT $2 * 3
      ),
      semantic_results AS (
        SELECT fi.id,
               (fi.embedding <=> $3::vector) AS semantic_distance,
               ROW_NUMBER() OVER (ORDER BY fi.embedding <=> $3::vector ASC) as rank
        FROM feed_items fi
        WHERE fi.embedding IS NOT NULL
        ORDER BY fi.embedding <=> $3::vector ASC
        LIMIT $2 * 3
      )
      SELECT
        fi.id,
        fi.title,
        fi.content,
        fi.link,
        fi.pub_date,
        fi.author,
        fi.enclosure_url,
        fi.enclosure_type,
        fi.transcript_url,
        fi.chapters_url,
        fi.value_config,
        f.title AS feed_title,
        f.category AS feed_category,
        f.type AS feed_type,
        COALESCE(fr.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(sr.semantic_distance, 1.2) AS semantic_distance,
        CASE WHEN sr.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
        COALESCE(1.0 / ($4 + fr.rank), 0.0) + COALESCE(1.0 / ($4 + sr.rank), 0.0) as rrf_score
      FROM feed_items fi
      LEFT JOIN feeds f ON fi.feed_id = f.id
      LEFT JOIN fts_results fr ON fi.id = fr.id
      LEFT JOIN semantic_results sr ON fi.id = sr.id
      WHERE fr.id IS NOT NULL OR sr.id IS NOT NULL
      ORDER BY rrf_score DESC, fi.pub_date DESC NULLS LAST
      LIMIT $2;
    `,[e,r,a,60],o,`searchFeedItems`);return $(s,Z(s.rows??[],i),{limit:r,task:`local_search`,fallbackDataScope:`local_cache`,options:i})}async searchTranscriptSegments(e,t=10,n={}){let r=W(t),i={...n,semanticDistanceCutoff:n.semanticDistanceCutoff??this.semanticDistanceCutoff,rrfWeight:this.resolvedRuntimeConfig.rrfWeight,lexicalWeight:this.resolvedRuntimeConfig.lexicalWeight,semanticWeight:this.resolvedRuntimeConfig.semanticWeight,confidenceWeight:this.resolvedRuntimeConfig.confidenceWeight},a=`[${(await this.getQueryEmbedding(e,i)).join(`,`)}]`,o=r*this.feedSemanticCandidateMultiplier,s=await this.executeSemanticQuery(`
      WITH query_terms AS (
        SELECT websearch_to_tsquery('english', $1) AS q
      ),
      fts_results AS (
        SELECT ts.id, ts.feed_item_id,
               ts_rank_cd(ts.search_vector, q, 32) AS fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(ts.search_vector, q, 32) DESC) AS rank
        FROM transcript_segments ts
        CROSS JOIN query_terms
        WHERE ts.search_vector @@ q
        LIMIT $2 * 3
      ),
      semantic_results AS (
        SELECT ts.id, ts.feed_item_id,
               (ts.embedding <=> $3::vector) AS semantic_distance,
               ROW_NUMBER() OVER (ORDER BY ts.embedding <=> $3::vector ASC) AS rank
        FROM transcript_segments ts
        WHERE ts.embedding IS NOT NULL
        ORDER BY ts.embedding <=> $3::vector ASC
        LIMIT $2 * 3
      ),
      merged AS (
        SELECT
          COALESCE(f.id, s.id) AS id,
          COALESCE(f.feed_item_id, s.feed_item_id) AS feed_item_id,
          COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
          COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
          CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
          COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) AS rrf_score
        FROM fts_results f
        FULL OUTER JOIN semantic_results s ON f.id = s.id
      ),
      best_per_episode AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY feed_item_id ORDER BY rrf_score DESC) AS ep_rank
        FROM merged
      )
      SELECT
        b.id AS segment_id,
        b.feed_item_id,
        b.rrf_score,
        b.fts_rank_raw,
        b.semantic_distance,
        b.semantic_matched,
        ts.start_time,
        ts.end_time,
        ts.text AS segment_text,
        ts.speaker,
        fi.title AS episode_title,
        fi.enclosure_url,
        fi.enclosure_type,
        fi.link AS episode_link,
        fi.pub_date,
        f.title AS feed_title,
        f.category AS feed_category
      FROM best_per_episode b
      JOIN transcript_segments ts ON b.id = ts.id
      JOIN feed_items fi ON b.feed_item_id = fi.id
      LEFT JOIN feeds f ON fi.feed_id = f.id
      WHERE b.ep_rank = 1
        AND fi.enclosure_url IS NOT NULL
      ORDER BY b.rrf_score DESC
      LIMIT $2
    `,[e,r,a,60],o,`searchTranscriptSegments`);return $(s,Z(s.rows??[],i),{limit:r,task:`local_search`,fallbackDataScope:`local_cache`,options:i})}async getIndexHealthSnapshot(){let t=e.getPG(),[n,r,i]=await Promise.all([t.query(`SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM posts`),t.query(`SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM feed_items`),t.query(`SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM transcript_segments`)]),a=n.rows?.[0]??{total:0,with_embedding:0},o=r.rows?.[0]??{total:0,with_embedding:0},s=i.rows?.[0]??{total:0,with_embedding:0},c=Number(a.total??0),l=Number(a.with_embedding??0),u=Number(o.total??0),d=Number(o.with_embedding??0),f=Number(s.total??0),p=Number(s.with_embedding??0);return{posts:{total:c,withEmbedding:l,coverage:c>0?l/c:0},feedItems:{total:u,withEmbedding:d,coverage:u>0?d/u:0},transcriptSegments:{total:f,withEmbedding:p,coverage:f>0?p/f:0}}}};export{ne as i,w as n,te as r,Se as t};