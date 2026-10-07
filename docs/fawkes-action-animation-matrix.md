# Fawkes Action → State → Animation Matrix

> **Phoenix is the platform. Fawkes is the pet.**
>
> Animation communicates system state; it never replaces text, status indicators, permissions, confirmation UI, or audit information.

## 1. Canonical pipeline

```text
Capability / Event
        ↓
Normalized Phoenix Display State
        ↓
Fawkes Visual Mapping
        ↓
Animation + Tone + Expression
        ↓
Explanation / Notification / User Action
```

Capability implementations MUST NOT directly select Fawkes animation names. They emit semantic Phoenix events/states; `@phoenix/pet-states` owns the mapping.

## 2. Canonical states

| Priority | State       | Meaning                            | Animation   | Tone      | Loop |
| -------: | ----------- | ---------------------------------- | ----------- | --------- | ---- |
|        1 | `ERROR`     | Operation failed                   | `alarm`     | danger    | yes  |
|        2 | `WAITING`   | User action or approval required   | `attention` | warning   | yes  |
|        3 | `RECORDING` | Audio/video capture active         | `record`    | recording | yes  |
|        4 | `WARNING`   | Non-fatal risk                     | `caution`   | warning   | yes  |
|        5 | `DEPLOYING` | Deployment or release in progress  | `fly`       | info      | yes  |
|        6 | `THINKING`  | AI/context reasoning               | `think`     | info      | yes  |
|        7 | `LISTENING` | Phoenix is receiving user input    | `listen`    | info      | yes  |
|        8 | `WORKING`   | A capability is executing a task   | `focus`     | info      | yes  |
|        9 | `SUCCESS`   | Transient completion               | `celebrate` | success   | no   |
|       10 | `IDLE`      | Nothing active                     | `breathe`   | neutral   | yes  |
|        – | `SLEEPING`  | Mode: user-selected pause          | `sleep`     | muted     | yes  |
|        – | `OFFLINE`   | Mode: UI cannot reach Phoenix Core | `offline`   | muted     | no   |

Source of truth: [ADR-0019](adr/ADR-0019-canonical-fawkes-states-and-priority.md) for priority and `pet/states/src/index.ts` (`STATE_VISUALS`) for animation, tone and loop. If this table disagrees with either, they win.

## 3. Priority / pre-emption

```text
ERROR > WAITING > RECORDING > WARNING > DEPLOYING > THINKING > LISTENING > WORKING > SUCCESS > IDLE
```

Modes sit outside the ranking:

- **SLEEPING** is a user-selected pause. Only `ERROR` and `RECORDING` break through it.
- **OFFLINE** is computed by the UI when Core is unreachable. Core cannot report it, so it is never an event.
- The snapshot always carries a separate `recording` flag, so the recording indicator is never hidden by a higher-priority state.

`SUCCESS` is a transient acknowledgement (it expires through a `ttlMs`). After it, Fawkes returns to the underlying state.

## 4. Character direction

Fawkes should feel like a **tiny, cute, chubby young phoenix companion**.

- Oversized expressive eye
- Small friendly beak
- Rounded body
- Fluffy chest/belly
- Soft rounded wing
- Compact flame-shaped crest
- Small flame-like tail
- Orange/red primary feathers
- Golden/yellow flame accents
- Warm, friendly expression
- Clearly readable at 32px

Avoid realistic/aggressive fantasy styling, excessive flames, or details that disappear at small sizes.

## 5. Animation behavior

### IDLE — `breathe`

Slow body breathing, occasional blink, subtle crest movement.

### THINKING — `think`

Slight head tilt, upward glance, small crest movement.

### LISTENING — `listen`

Lean slightly toward the user, attentive eyes, minimal movement.

### WORKING — `focus`

Focused expression, slight body bob, brighter crest.

### WAITING — `attention`

Small hop, gentle wing wave, looks toward user. Repeat until user responds.

### SUCCESS — `celebrate`

Happy hop, wings open, crest brightens. Play once for about 0.8–1.5 seconds.

### WARNING — `caution`

Small shake, amber/orange crest, mildly concerned expression.

### ERROR — `alarm`

Short shake, danger/red crest, concerned expression, persistent calm pulse. Never frantic.

### RECORDING — `record`

Attentive/listening posture with steady crest pulse.

**Recording must always have a persistent non-animated indicator.**

### DEPLOYING — `fly`

Gentle floating, wing flapping, tail movement, flying feeling.

### SLEEPING — `sleep`

Eyes closed, soft breathing, dim crest.

### OFFLINE — `offline`

Still, desaturated/greyed pose. UI must explicitly say Phoenix Core is unreachable.

## 6. Kage mapping

Real events and rules live in `core/state-engine/src/default-mapping.ts`.

```text
kage.meeting.started           → WORKING   "Starting meeting capture"
kage.meeting.recording         → RECORDING "Recording meeting" (no timeout)
kage.meeting.ended             → WORKING   "Processing meeting"
kage.transcription.started     → WORKING   "Transcribing meeting"
kage.transcription.completed   → WORKING   "Transcript ready"
kage.summary.started           → THINKING  "Summarising meeting"
kage.summary.ready             → SUCCESS   "Meeting summary ready"
kage.meeting.archived          → clear (back to the underlying state)
kage.meeting.failed            → ERROR     "Meeting processing failed"
```

While audio is recorded, `state = RECORDING` and `recording = true`.

## 7. Git mapping

```text
git.merge_conflict             → WARNING   "Merge conflict in <repo>"
git.merge_conflict_resolved    → clear
git.commit.created             → no state change (activity feed and notification only)
git.branch.changed             → no state change
git.working_tree.dirty / clean → no state change
```

The Git capability watches repository state; it does not run fetch, clone or push, so those produce no Fawkes state.

## 8. Terminal mapping

The terminal capability reports commands the user runs through the Phoenix CLI.

```text
build.started / test.started / command.started   → WORKING
build.passed  / test.passed  / command.completed → SUCCESS (brief)
build.failed  / test.failed  / command.failed    → ERROR
```

Commands that need approval go through the permission gateway:

```text
security.confirmation.requested → WAITING "Approval needed: <summary>"
security.confirmation.resolved  → clear
```

## 9. Build and deployment mapping

```text
build.started / test.started    → WORKING
deploy.started                  → DEPLOYING "Deploying to <environment>"
deploy.progress                 → heartbeat (keeps the state alive)
deploy.succeeded                → SUCCESS
deploy.failed                   → ERROR
security.confirmation.requested → WAITING (production approval)
```

## 10. Coding-agent mapping

Implemented today for coding-agent lifecycle events:

```text
agent.started    → THINKING
agent.working    → WORKING
agent.waiting    → WAITING "<agent> needs your input"
agent.completed  → SUCCESS
agent.failed     → ERROR
```

Future in-Phoenix agent runtime (Stage 4+): observe, retrieve and plan map to `THINKING`; execute maps to `WORKING`; asking permission maps to `WAITING`.

Fawkes must never communicate success before Phoenix verifies the result.

## 11. UX invariants

1. Animation is supplementary; accessible text is authoritative.
2. Recording always has a persistent indicator.
3. Reduced motion preserves semantic distinction through static poses.
4. ERROR and WARNING are never communicated by color alone.
5. WAITING clearly tells the user that Phoenix needs them.
6. Capability implementations never import or reference animation names.
7. Unknown states safely fall back to `IDLE`.
8. State transitions are deterministic and testable.
9. Success animation only occurs after verification.
10. Fawkes must never create false confidence.

## 12. Architecture ownership

| Responsibility         | Package           |
| ---------------------- | ----------------- |
| Semantic events        | `protocol` / core |
| State normalization    | Phoenix Core      |
| State → visual mapping | `pet/states`      |
| Rendering              | `pet/runtime`     |
| Character artwork      | `pet/assets`      |
| Capability behavior    | `capabilities/*`  |
| User explanations      | Core / Web        |
| Accessibility          | Runtime + Web     |

Dependency direction:

```text
Capabilities
     ↓
Phoenix Core / Event Protocol
     ↓
Pet State
     ↓
@phoenix/pet-states
     ↓
@phoenix/pet-runtime
     ↓
@phoenix/pet-assets
```

Never reverse this dependency.

## 13. Reduced-motion contract

When reduced motion is enabled:

- Stop continuous animation.
- Preserve a recognizable static pose.
- Preserve state labels.
- Preserve recording indicators.
- Preserve accessibility announcements.

Examples:

```text
THINKING  → tilted still pose
WAITING   → wing-raised still pose
ERROR     → concerned still pose
RECORDING → attentive still pose
SUCCESS   → wings-open still pose
```

## 14. Asset requirements

Required visual states:

```text
idle
listening
thinking
working
waiting
success
warning
error
recording
deploying
sleep
offline
```

Optional future states:

```text
greeting
curious
confused
excited
celebration_big
eating
stretching
```

Optional animations must not become required Phoenix states.

## 15. 32px readability

Fawkes must remain recognizable at:

```text
32 × 32
48 × 48
64 × 64
96 × 96
128 × 128
```

Priority at 32px:

1. Eye
2. Body silhouette
3. Flame crest
4. Wing
5. Tail
6. Beak

## 16. Future sprite structure

```text
fawkes/
├── idle/
├── listening/
├── thinking/
├── working/
├── waiting/
├── success/
├── warning/
├── error/
├── recording/
├── deploying/
├── sleep/
└── offline/
```

Suggested starting frame counts:

```text
idle        8
listening   6
thinking    8
working     8
waiting     6
success     10
warning     6
error       8
recording   6
deploying   12
sleep       6
offline     1
```

These are targets, not requirements for the current SVG renderer.

## 17. Definition of Done

- [ ] Character is recognizable at 32px.
- [ ] Character feels cute and friendly.
- [ ] All canonical states have distinct visual behavior.
- [ ] Kage recording uses `RECORDING`.
- [ ] Approval requests use `WAITING`.
- [ ] Errors use `ERROR`.
- [ ] Successful operations use `SUCCESS`.
- [ ] Deployment uses `DEPLOYING`.
- [ ] AI reasoning uses `THINKING`.
- [ ] Long-running work uses `WORKING`.
- [ ] Reduced motion is supported.
- [ ] Offline mode is distinct.
- [ ] Accessibility labels remain authoritative.
- [ ] Capability code remains independent of animation names.
- [ ] State transitions are tested.
- [ ] Artwork provenance remains documented.
- [ ] No proprietary third-party character artwork is copied.

## 18. Guiding principle

> **Fawkes attracts attention. Phoenix earns trust.**

Fawkes communicates how Phoenix is behaving. The Phoenix interface communicates what actually happened.
