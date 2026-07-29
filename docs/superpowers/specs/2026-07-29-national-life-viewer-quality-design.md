# National Life Viewer Quality Design

## Problem

The National Life login is functional inside the Keepr One secure viewer, but
the carrier page appears soft and slightly misaligned on larger displays.
Production inspection found two concrete causes:

- the interactive Steel session and Xvfb display are fixed at `1280x800`;
- Steel sends Chrome screencast frames as JPEG at quality `75`.

The Keepr One modal can render wider than the captured browser. Upscaling the
compressed frames makes text and form controls look low resolution.

## Goals

- Show the complete National Life page, without cropping or forced zoom.
- Make text, logos, and form controls visibly sharper on desktop displays.
- Preserve pointer and keyboard coordinate accuracy.
- Keep the current secure login, MFA, session encryption, and worker flow
  unchanged.
- Fail the build if a future pinned Steel image no longer matches the reviewed
  quality patch.

## Non-goals

- Redesigning or modifying National Life/Auth0 content.
- Injecting CSS or JavaScript into the carrier page.
- Capturing credentials or changing how authenticated context is stored.
- Supporting user-controlled zoom in this iteration.

## Approved Approach

Use a balanced high-quality desktop profile:

- interactive browser dimensions: `1600x1000`;
- private Xvfb display: `1600x1000x24`;
- Chrome screencast: JPEG quality `92`;
- device scale factor remains `1`;
- modal viewer surface: centered `16:10`, maximum `1600x1000`, using available
  space without stretching beyond the source resolution.

On smaller screens the complete viewer scales down proportionally. Empty space
is treated as neutral letterboxing rather than stretching or cropping the
carrier page.

## Architecture

### Interactive Steel session

`workers/national-life/steel-session.ts` creates interactive sessions with
`dimensions: { width: 1600, height: 1000 }`. Worker-only restored sessions are
unchanged because they do not need the interactive viewer.

### Private display

`deploy/national-life-runtime.compose.yaml` starts Xvfb with the same
`1600x1000x24` dimensions. Matching the browser and display prevents Chromium
from rendering into a smaller backing surface.

### Screencast quality

A dedicated build-time patch updates the pinned Steel casting handler from
JPEG quality `75` to `92`. This remains separate from the existing privacy
patch so security hardening and visual quality have independent tests and
failure messages.

The patch must:

- replace the exact reviewed `quality: 75` statement in the runtime build;
- require exactly one match;
- fail closed if the pinned Steel source changes.

### Keepr One modal

The iframe is placed in a centered `16:10` surface capped at `1600x1000`.
The modal uses the available viewport height and width, but does not enlarge
the viewer beyond its source resolution. The secure-session header, verified
origin, cancellation behavior, sandbox, and referrer policy remain unchanged.

## Data and Security Flow

No authentication data flow changes. Keyboard and pointer events continue
through the signed viewer broker to the isolated Steel session. Auth0 receives
the credentials inside that browser. Keepr One continues to persist only the
encrypted authenticated browser context after successful login.

The higher-quality stream exists only during the short interactive connection
attempt. Steel remains private and the public broker continues to enforce the
owned attempt and signed viewer cookie.

## Performance

The source frame contains about 56% more pixels than `1280x800`, and JPEG 92 can
use materially more bandwidth than JPEG 75. This is accepted for the
time-limited login flow. The change does not affect normal Keepr One page loads
or background worker sessions.

The existing single interactive-session resource limits, two-gigabyte Steel
memory limit, shared-memory allocation, and ten-minute attempt timeout remain
unchanged.

## Verification

Automated checks:

- Steel session test asserts interactive dimensions `1600x1000`.
- Compose test asserts Xvfb `1600x1000x24`.
- Quality patch test proves one exact `75` to `92` replacement.
- Quality patch test fails when the reviewed Steel statement is missing or
  duplicated.
- Modal test confirms the secure iframe remains sandboxed and is hosted inside
  the fixed-ratio viewer surface.
- Focused National Life tests and TypeScript checks remain green.

Production verification:

- rebuild the dedicated Steel and runtime services on `btapps`;
- confirm both containers are healthy;
- start a new connection attempt, because existing sessions retain their old
  dimensions;
- confirm the complete National Life page is visible, sharp, centered, and
  that pointer clicks land on the intended username, password, and login
  controls;
- confirm login/MFA still transitions to a connected encrypted session.

## Rollback

Revert the implementation PR and rebuild the dedicated National Life services.
This restores `1280x800`, JPEG 75, and the previous modal sizing without
changing stored encrypted sessions or Keepr One authentication.

## Alternatives Considered

- `1920x1080` with JPEG 95: sharper but unnecessarily expensive for the
  time-limited login window.
- CSS-only scaling: cheaper, but cannot restore detail already lost at capture
  and compression time.
- Login-focused zoom: makes the form larger but crops the carrier page and
  requires scrolling, contrary to the approved full-page experience.
