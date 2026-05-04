# Conversation OS Runtime Proof

## Claim

The runtime now behaves as one coordinated Conversation OS across the main session surfaces instead of a set of adjacent subsystems that only share telemetry.

## What Changed

1. Session hydration consults the coordinator facade in the live runtime before and during the summary flow.
2. Multimodal execution is now coordinator-authoritative when advice is available.
   - If the coordinator does not keep the media task on the edge lane, the runtime skips the remote multimodal stage with `privacy_restricted` instead of calling the provider anyway.
3. Premium deep execution is now coordinator-authoritative when advice is available.
   - The runtime evaluates a fresh session brief with `explicitUserAction=true` for the premium quality-escalation path and only runs the premium provider when the coordinator selects the premium lane.
4. Composer writer execution is now coordinator-authoritative when advice is available.
   - The live hook no longer computes coordinator advice only for telemetry; it uses that advice as the final gate before the server writer call.
5. Supervisor next-step planning remains aligned with committed session state.
   - Planning reads the committed supervisor state instead of re-running the supervisor, so decision-feed emissions and supervisor telemetry are not double-counted.

## Why This Qualifies As One Runtime

A Conversation OS is not just shared evaluation or shared telemetry. It needs one coordinating layer that meaningfully constrains live execution across surfaces.

That condition now holds in three ways:

1. Shared brief shape
   - Session, media, and composer all go through the same coordinator facade and normalized brief contract.
2. Shared authority
   - Live runtime gates now consume coordinator advice for media, premium, and composer writer instead of treating it as a side-channel.
3. Shared state discipline
   - Supervisor planning and decision-feed publication operate from committed session state, so diagnostics reflect the same runtime that the user experiences.

## Evidence

- Live runtime authority helpers are in `src/conversation/sessionAssembler.ts`.
- Live composer authority gate is in `src/hooks/useComposerGuidance.ts`.
- Composer authority helper tests are in `src/intelligence/composer/routing.test.ts`.
- Session authority helper tests are in `src/conversation/sessionAssemblerCoordinatorRuntime.test.ts`.
- Explicit coordinator privacy skip state is covered in `src/conversation/modelExecution.test.ts`.

## Remaining Gaps

1. The coordinator does not yet own every local planner decision.
   - Some preflight and stage-shape planning still originates in local planner helpers before coordinator authority is consulted.
2. Session hydration still uses local runtime-advisory summarization in parallel with coordinator advice.
   - That path is useful for diagnostics, but it is not yet fully collapsed into a single coordinator-owned routing object.
3. Search and some non-writer composer refinement paths are still coordinated primarily through local planner logic.

## Practical Conclusion

The system is now coordinated in the places that matter most for remote execution and high-cost model stages. It is reasonable to describe the runtime as a unified Conversation OS with partial remaining authority debt, rather than as disconnected systems with only shared scoring and instrumentation.
