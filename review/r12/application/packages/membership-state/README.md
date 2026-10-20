# `@baarne/membership-state`

Pure M1 membership-domain module. It owns deterministic membership periods,
applications, three concurrent reference-slot reservations, immutable historical
references, lifecycle transitions, replay, and the six-hop undirected historical
reference graph.

Events use nonnegative safe-integer timestamps, an explicit network identifier,
strict payload fields, restricted canonical JSON, and domain-separated SHA-256
identifiers. Replay orders events by `(occurredAt, eventId)`. A transition is
applied to a clone and committed only after every validation succeeds; rejected
events return the original state.

Each active member has slots `0..2`. Reservation occupies a slot. Recording a
valid reference changes the reservation to `CONSUMED`; activation does not free
it. The slot remains occupied until the referred member resigns or is expelled,
or until the pending candidate cancels the application. Candidate cancellation
releases both reserved and consumed slots without deleting historical references.
An issuer may release only an unconsumed reservation, so an accepted reference
cannot be revoked unilaterally. Suspension releases no slots. Pending applications
have no automatic expiry.

The first successful `MEMBERSHIP_ACTIVATED` transition for a non-founder closes
Genesis in the same atomic state update and invalidates every still-`ISSUED`
founder invitation. A rejected activation leaves Genesis unchanged. The legacy
core can replay an explicit `GENESIS_CLOSED` event for historical compatibility,
but the Gate F/G authorization boundary deliberately gives that event no signer
authority; a signed standalone closure therefore fails closed.

It imports no database, HTTP framework, UI, EAS adapter, RPC client, or private
key. The default verifier reuses the accepted V0.1 `BAARNE_REFERENCE_V1` package
verification. Storage and event-order authority are inputs outside this module.

This module does not replace `@baarne/v0.1-core`. V0.1 conserved capacity and
4/5 ordering remain unchanged. M1 suspension/expulsion events model deterministic
effects after an external process has accepted a decision; voting and decision
authority are deliberately out of scope.

The default exports consume an already-authorized, finalized event history.
`createMembershipStateMachine({ authorizeEvent })` provides a fail-closed adapter
boundary for an external event authenticator, but M1 defines no new generic event
signature or finality protocol. Canonical form, authorization, ordering, finality,
and deterministic transition validity are separate claims.

The default `eventOrdering: 'EVENT_TUPLE'` retains deterministic
`(occurredAt,eventId)` replay. A separately verified finality adapter may select
`eventOrdering: 'EXTERNAL_FINALIZED'` and feed events in external order. In that
mode this package deliberately neither sorts nor proves the supplied order.
`resolveOccurredAt` may likewise provide an externally verified policy time; its
default is the event's signed `occurredAt`. Gate F uses the finalized block
timestamp so a locally backdated value cannot reopen a time-bounded transition.

Run the isolated suite with:

```powershell
npm run test:m1
```
