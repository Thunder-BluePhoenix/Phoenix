# Fawkes v2 — Character & Animation Specification

> **Phoenix is the platform. Fawkes is the pet.**
>
> Fawkes is a useful visual companion, not a decorative mascot.

## 1. Objective

Evolve the current Fawkes artwork into a distinctive, cute phoenix companion while preserving the existing Phoenix runtime contract.

The visual redesign MUST NOT require capability code to know anything about animation implementation.

Current architecture remains:

```text
Phoenix event
    ↓
Display state
    ↓
@phoenix/pet-states
    ↓
@phoenix/pet-runtime
    ↓
@phoenix/pet-assets
    ↓
Fawkes artwork
```

---

# 2. Character Identity

## Core description

Fawkes is:

> A tiny, chubby, young phoenix companion with a warm personality, expressive eyes, soft rounded features, and subtle living flame details.

Fawkes should feel:

- Cute
- Intelligent
- Friendly
- Curious
- Calm
- Slightly playful
- Trustworthy
- Technically capable

Fawkes should NOT feel:

- Aggressive
- Dark
- Demonic
- Militaristic
- Overly fantasy-oriented
- Like a generic eagle
- Like a fire monster

---

# 3. Silhouette

The silhouette is the highest-priority visual feature.

At 32px the user should immediately recognize:

```text
       🔥
      /  \       ← crest
    ( •ᴗ• )      ← large eye / face
    /|    \      ← rounded body + wing
   / |____|       \🔥/       ← tail
```

Actual artwork should remain original and should not literally reproduce this ASCII shape.

## Proportions

Recommended visual proportions:

```text
Head / face       35%
Body              45%
Wings             15%
Tail / crest       5% visual emphasis
```

The head should be slightly oversized relative to the body.

This gives Fawkes the companion/pet appearance.

---

# 4. Face

## Eyes

The eye is Fawkes's most important emotional feature.

Requirements:

- Large relative to face
- Rounded
- High contrast
- One small highlight
- Capable of subtle directional movement
- Blink animation
- Different emotional poses

Eye states:

```text
Neutral
Curious
Focused
Happy
Concerned
Sleepy
Excited
```

At 32px, the eye must remain readable.

## Beak

The beak should be:

- Small
- Rounded
- Friendly
- Slightly golden
- Clearly visible
- Never sharp/aggressive

Avoid a large eagle-like beak.

---

# 5. Body

Fawkes should have a rounded, slightly fluffy body.

Recommended characteristics:

- Compact body
- Soft belly
- Slight chest fluff
- Rounded shoulders
- No hard anatomical edges
- Small feet or hidden lower body depending on pose

The body should visually communicate:

> “small creature”

rather than:

> “large mythical bird”.

---

# 6. Wings

The wings should be:

- Rounded
- Small-to-medium
- Expressive
- Capable of waving
- Capable of opening during celebration
- Capable of flapping during deployment
- Able to droop during errors/sad states

Primary wing poses:

```text
Neutral
Raised
Wave
Open
Flap
Droop
```

The wing should be one of Fawkes's primary communication mechanisms.

---

# 7. Flame Crest

The crest is Fawkes's phoenix signature.

It should look like a small flame rather than hair.

Normal:

```text
warm orange
+
golden inner flame
```

State variations:

```text
IDLE        → gentle warm flame
THINKING    → slightly tilted flame
WORKING     → brighter flame
SUCCESS     → bright golden flame
WARNING     → amber
ERROR       → red/dim
RECORDING   → subtle pulse
SLEEPING    → small/dim
OFFLINE     → desaturated
```

The crest must remain readable at small sizes.

---

# 8. Tail

The tail should use 2–3 flame-feather shapes.

Normal behavior:

- Small flicker
- Gentle movement
- Never excessive

Animation roles:

```text
IDLE        → subtle flicker
WORKING     → slightly active
SUCCESS     → brighter
ERROR       → droops
DEPLOYING   → trails behind
SLEEPING    → low/dim
```

---

# 9. Color System

The current artwork already uses a warm orange/red palette. Preserve this general identity.

Suggested semantic palette:

```text
Primary feather:
#E8590C

Deep feather:
#C2410C

Flame:
#F76707

Flame core:
#FCC419

Belly:
#FFE8CC

Beak:
#FAB005

Eye:
#1B1B1F

Cheek:
#FF8787
```

Semantic states may introduce controlled variations:

```text
Success:
golden / bright

Warning:
amber

Error:
red

Offline:
desaturated grey

Recording:
red indicator
```

Do not recolor the entire character aggressively for every state.

The character should remain recognizably Fawkes.

---

# 10. Animation Principles

## Principle 1 — Small movement

Fawkes lives on the desktop/UI for long periods.

Animations should therefore be subtle.

## Principle 2 — Every loop returns to neutral

Animations should generally satisfy:

```text
neutral
  ↓
action
  ↓
neutral
```

This makes state transitions safe.

## Principle 3 — No frantic movement

Even ERROR should not create an annoying flashing/shaking pet.

## Principle 4 — State changes must interrupt safely

Example:

```text
WORKING
   ↓
ERROR
```

The ERROR animation must begin immediately without requiring the WORKING animation to finish.

## Principle 5 — Animation never represents an unverified action

Fawkes may animate DEPLOYING while deployment is running.

Fawkes may celebrate only after Phoenix verifies success.

---

# 11. Core Animation Specifications

## 11.1 IDLE

Name:

```text
breathe
```

Loop:

```text
yes
```

Duration:

```text
3.5–5 seconds
```

Components:

- Body scale ±2–4%
- Occasional blink
- Crest flicker
- Tail micro-motion

Energy:

```text
very low
```

---

## 11.2 LISTENING

Name:

```text
listen
```

Loop:

```text
yes
```

Duration:

```text
1.4–2 seconds
```

Components:

- Slight lean toward user
- Attentive eye
- Small head movement

Energy:

```text
low
```

---

## 11.3 THINKING

Name:

```text
think
```

Loop:

```text
yes
```

Duration:

```text
2–3 seconds
```

Components:

- Head tilt
- Eye glance upward
- Crest movement

Optional:

- Tiny ember/spark

Avoid excessive particle effects.

---

## 11.4 WORKING

Name:

```text
focus
```

Loop:

```text
yes
```

Duration:

```text
1.2–1.8 seconds
```

Components:

- Small body bob
- Focused eye
- Slightly active crest

Energy:

```text
medium
```

---

## 11.5 WAITING

Name:

```text
attention
```

Loop:

```text
yes
```

Duration:

```text
1.2–1.5 seconds
```

Components:

- Small hop
- Wing wave
- Eye directed toward user

Important:

WAITING should clearly communicate:

> “Phoenix needs you.”

It must not look like generic idle animation.

---

## 11.6 SUCCESS

Name:

```text
celebrate
```

Loop:

```text
no
```

Duration:

```text
0.8–1.5 seconds
```

Sequence:

```text
neutral
 ↓
small crouch
 ↓
hop
 ↓
wings open
 ↓
crest brightens
 ↓
land
 ↓
neutral
```

The animation plays once.

---

## 11.7 WARNING

Name:

```text
caution
```

Loop:

```text
yes
```

Duration:

```text
1–2 seconds
```

Components:

- Small shake
- Amber crest
- Concerned expression

The user should think:

> “Something needs attention.”

Not:

> “Everything is broken.”

---

## 11.8 ERROR

Name:

```text
alarm
```

Loop:

```text
yes
```

Sequence:

```text
small shake
 ↓
concerned expression
 ↓
crest pulse
 ↓
calm hold
 ↓
repeat
```

Do not continuously shake.

The error state should remain visually persistent without becoming irritating.

---

## 11.9 RECORDING

Name:

```text
record
```

Loop:

```text
yes
```

Duration:

```text
~2 seconds
```

Components:

- Attentive posture
- Subtle crest pulse
- Recording indicator

External UI:

```text
🔴 Recording
```

The recording state must never depend solely on animation.

---

## 11.10 DEPLOYING

Name:

```text
fly
```

Loop:

```text
yes
```

Duration:

```text
1–1.4 seconds
```

Components:

- Wing flap
- Small vertical float
- Tail trailing motion

The motion should suggest:

> “Something is moving forward.”

---

## 11.11 SLEEPING

Name:

```text
sleep
```

Loop:

```text
yes
```

Duration:

```text
5–7 seconds
```

Components:

- Closed eyes
- Gentle breathing
- Dim crest
- Minimal movement

Optional future feature:

```text
tiny Z particles
```

But these should not be required.

---

## 11.12 OFFLINE

Name:

```text
offline
```

Loop:

```text
no
```

Pose:

- Still
- Slightly desaturated
- Reduced crest brightness
- Neutral/concerned expression

Text:

```text
Phoenix Core is unreachable
```

---

# 12. Expression System

Expressions should be composable with animations.

Instead of creating completely separate artwork for every state:

```text
Animation
+
Expression
+
Pose
```

Example:

```text
WORKING
+
focused eyes
+
slight forward lean
```

Possible expression identifiers:

```text
neutral
happy
curious
focused
concerned
sleepy
excited
```

Future runtime design can expose:

```ts
expression?: FawkesExpression;
```

But this should be introduced only if the current state-only model becomes insufficient.

---

# 13. Animation State Contract

Current runtime contract should remain compatible with:

```ts
export type AnimationName =
  | "breathe"
  | "focus"
  | "think"
  | "listen"
  | "attention"
  | "celebrate"
  | "caution"
  | "alarm"
  | "record"
  | "fly"
  | "sleep"
  | "offline";
```

Do not rename existing animation identifiers without a migration.

Future animations can be added.

---

# 14. Asset Implementation Strategy

## Phase A — Current SVG

Continue using:

```text
pet/assets/src/fawkes.ts
```

Advantages:

- Small
- Fast
- Scalable
- Easy to theme
- CSS animation friendly
- No sprite loading system required

## Phase B — Optional sprite support

Later add:

```text
pet/assets/fawkes/
```

with:

```text
idle/
listening/
thinking/
working/
waiting/
success/
warning/
error/
recording/
deploying/
sleep/
offline/
```

The runtime should eventually be able to support either:

```text
SVG asset
```

or:

```text
sprite asset
```

without changing capability logic.

---

# 15. Responsive Sizes

Fawkes must be tested at:

```text
32px  → navbar
48px  → compact UI
64px  → standard
96px  → panel
128px → floating pet
```

At 32px:

- Eye must remain readable
- Silhouette must remain recognizable
- Crest must remain visible
- Wing must not merge into body

---

# 16. Accessibility

Fawkes remains an accessible button.

Animation must never be the only communication channel.

The runtime should continue producing:

```text
aria-label
title
aria-live
```

Examples:

```text
Fawkes — Recording. Kage is recording the meeting.
```

```text
Fawkes — Needs you. Approval is required.
```

```text
Fawkes — Error. Deployment failed.
```

---

# 17. Reduced Motion

When reduced motion is enabled:

```text
animation = stopped
pose = state-specific static pose
```

Required static poses:

```text
IDLE        → neutral
THINKING    → tilted
LISTENING   → attentive
WORKING     → focused
WAITING     → wing raised
SUCCESS     → wings open
WARNING     → concerned
ERROR       → concerned / crest lowered
RECORDING   → attentive
DEPLOYING   → floating
SLEEPING    → eyes closed
OFFLINE     → desaturated
```

---

# 18. Asset File Organization

Recommended future organization:

```text
pet/
├── assets/
│   ├── package.json
│   └── src/
│       ├── index.ts
│       ├── types.ts
│       └── fawkes.ts
│
├── runtime/
│   └── src/
│       ├── fawkes.ts
│       ├── interaction.ts
│       ├── styles.ts
│       └── index.ts
│
└── states/
    └── src/
        └── index.ts
```

If raster assets are introduced:

```text
pet/assets/
└── fawkes/
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

---

# 19. Testing Requirements

Every animation should have tests for:

### State mapping

```text
IDLE       → breathe
THINKING   → think
WORKING    → focus
LISTENING  → listen
WAITING    → attention
SUCCESS    → celebrate
WARNING    → caution
ERROR      → alarm
RECORDING  → record
DEPLOYING  → fly
SLEEPING   → sleep
OFFLINE    → offline
```

### Runtime

Verify:

- `data-state`
- `data-animation`
- `data-tone`
- `data-loop`
- accessible label
- recording indicator
- reduced-motion behavior

### Safety

Verify that:

```text
unknown state → IDLE
```

and:

```text
recording=true
```

always produces a visible recording indicator.

---

# 20. Visual Quality Checklist

Before accepting a new Fawkes asset:

- [ ] Looks good at 32px.
- [ ] Looks good at 64px.
- [ ] Looks good at 128px.
- [ ] Silhouette is recognizable.
- [ ] Eye is expressive.
- [ ] Character looks friendly.
- [ ] Wing is clearly separated.
- [ ] Crest reads as flame.
- [ ] Tail reads as phoenix-like.
- [ ] No aggressive anatomy.
- [ ] No third-party character artwork is copied.
- [ ] Transparent/background-independent artwork.
- [ ] Animation does not require layout changes.
- [ ] Animation remains smooth under normal CPU conditions.
- [ ] Reduced-motion pose is understandable.
- [ ] Accessibility text remains correct.

---

# 21. Future Character Personality

Fawkes can eventually develop subtle personality behaviors.

These should be driven by Phoenix context, not random animation.

Examples:

```text
Long idle
→ tiny stretch

User opens Phoenix
→ greeting

Task completed
→ happy hop

User returns after long absence
→ greeting

Repeated failures
→ concerned expression

Long-running task
→ focused state

No active task
→ calm idle
```

Avoid random distracting behavior such as constant dancing.

---

# 22. Future Personality Rules

Fawkes personality should follow:

```text
Useful > Entertaining
Subtle > Loud
Contextual > Random
Trustworthy > Cute
```

Cute behavior is welcome when it does not obscure system state.

---

# 23. Definition of Done

Fawkes v2 character implementation is complete when:

- [ ] New character silhouette is approved.
- [ ] Eye/face reads clearly at 32px.
- [ ] Body is visibly chubby/friendly.
- [ ] Wings are expressive.
- [ ] Crest is unmistakably flame-like.
- [ ] Tail is recognizable.
- [ ] Existing animation contract remains compatible.
- [ ] 12 core animations work.
- [ ] Reduced-motion poses work.
- [ ] Recording remains explicit.
- [ ] Error remains clear.
- [ ] Waiting clearly requests user attention.
- [ ] Success is brief and verified.
- [ ] Artwork is original and provenance is documented.
- [ ] Runtime tests pass.
- [ ] Web UI tests pass.
- [ ] No capability depends on artwork implementation.

---

# 24. Design Principle

> **Fawkes should look alive, but Phoenix should remain in control.**

Fawkes is the emotional and visual layer of Phoenix.

Phoenix remains the source of truth.
