# reallign — Frontend Guide

Welcome! This is the guide for everyone working on the **reallign** web app.
Read it once before your first PR.

## What we're building

reallign helps you fix your posture. A small **ESP32** sensor worn on the body
measures how you're sitting (tilt angles). The app shows your posture score
in real time, your history, and the sensor's status.

| Part | Folder | Who |
| --- | --- | --- |
| IoT firmware | `../esp32` | IoT teammate |
| Backend / data | `lib/data.ts` (+ whatever comes next) | Backend |
| Frontend (this guide) | `app/`, `components/` | Frontend team |

**Not decided yet:** how data gets from the sensor to the app. Options are
**Supabase** (sensor → cloud → app) or **Bluetooth** straight to the browser,
stored locally with **Dexie.js** (IndexedDB). Either way, the frontend does
not need to care. See [The golden rule](#the-golden-rule-all-data-goes-through-libdatats).

---

## Getting started

We use **Bun**.

```bash
cd app
bun install
bun dev          # http://localhost:3000
```

Before you push:

```bash
bun run lint
bun run build
```

## Stack

- **Next.js 16** (App Router) + **React 19**. Heads up: Next 16 changed some APIs.
  If something from a tutorial doesn't work, check `node_modules/next/dist/docs/`.
- **Tailwind CSS v4.** There is no `tailwind.config.js`. Theme tokens live in `app/globals.css`.
- **shadcn/ui** for components ([section below](#shadcnui))
- **Motion** (formerly Framer Motion) for animation ([section below](#motion-formerly-framer-motion))
- **lucide-react** for icons
- **sonner** for toasts

## Project structure

```
app/
├── app/                     # Routes (Next.js App Router)
│   ├── layout.tsx           # Nav + <Toaster /> for every page
│   ├── loading.tsx          # Skeleton shown while a page loads
│   ├── page.tsx             # /         Dashboard      (placeholder)
│   ├── history/page.tsx     # /history  History        (placeholder)
│   └── device/              # /device   Sensor status  (placeholder)
├── components/
│   ├── ui/                  # shadcn components. Generated, see below
│   ├── motion/fade-in.tsx   # FadeIn / Stagger / StaggerItem wrappers
│   ├── posture/             # App-specific posture widgets
│   └── layout/site-nav.tsx  # Top navigation
└── lib/
    ├── types.ts             # Data shapes (PostureReading, Device, ...)
    ├── mock-data.ts         # Dummy data. Only lib/data.ts imports this
    ├── data.ts              # ⭐ The ONLY place components get data from
    └── utils.ts             # cn() helper
```

---

## The golden rule: all data goes through `lib/data.ts`

```tsx
// ✅ Do
import { getLatestReading } from "@/lib/data"
const reading = await getLatestReading()

// ❌ Don't
import { mockReadings } from "@/lib/mock-data"
```

Right now every function in `lib/data.ts` returns dummy data after a small
fake delay. When the backend is ready, only the *inside* of those functions
changes. Your components keep working.

**Need data that doesn't exist yet?** Add a function to `lib/data.ts` that
returns mock data, add the type to `lib/types.ts`, and tell the backend
person in the group chat so they know to implement it.

### The data shapes (`lib/types.ts`)

| Type | What it is |
| --- | --- |
| `PostureReading` | One sensor sample: `pitch`, `roll` (degrees), `score` (0–100), `status` |
| `PostureStatus` | `"good" \| "warning" \| "bad"` |
| `PostureSession` | One tracking period: average score, slouch count, good minutes |
| `DailySummary` | Per-day stats for history charts |
| `Device` | Sensor info: connected, battery, firmware |

These types are **our best guess**. The real fields depend on what the ESP32
ends up sending. When that's decided, we update `types.ts` and TypeScript
shows us everything that breaks.

---

## shadcn/ui

shadcn isn't a package you import from npm. It **copies component source
code into `components/ui/`**. You own that code and can edit it.

### Adding a component

```bash
bunx --bun shadcn@latest add dialog
bunx --bun shadcn@latest add dropdown-menu tooltip   # several at once
```

Browse components at https://ui.shadcn.com/docs/components.

Already installed: `button`, `card`, `badge`, `progress`, `tabs`, `skeleton`,
`separator`, `sonner`.

### ⚠️ We use Base UI, not Radix

Our shadcn setup (`base-nova` style) is built on **Base UI** (`@base-ui/react`),
not Radix. Most shadcn examples online use Radix. The main difference:

```tsx
// ❌ Radix style. Does NOT work here
<Button asChild><Link href="/history">History</Link></Button>

// ✅ Base UI style. Use the `render` prop
// (add nativeButton={false} when the rendered element isn't a <button>)
<Button render={<Link href="/history" />} nativeButton={false}>History</Button>
```

When you copy an example, make sure the docs page is set to **Base UI**.

### Using components

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

<Card>
  <CardHeader><CardTitle>Today</CardTitle></CardHeader>
  <CardContent>
    <Button variant="outline" size="sm">Details</Button>
  </CardContent>
</Card>
```

Button variants: `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`.
Badge variants: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`.

### Styling rules

- **Use theme colors, not raw colors.** Write `bg-primary`, `text-muted-foreground`,
  `border`, `bg-destructive`, not `bg-blue-500` or `#333`. Theme colors switch
  automatically in dark mode, and we can rebrand by editing `app/globals.css`.
- **Merge classes with `cn()`** when a component accepts a `className`:
  ```tsx
  import { cn } from "@/lib/utils"
  <div className={cn("rounded-lg p-4", active && "bg-muted", className)} />
  ```
- **Toasts:** `import { toast } from "sonner"` then `toast.success("Saved")`.
  Only works in client components.

---

## Motion (formerly Framer Motion)

Framer Motion is now called **Motion**. Same API, new package name.

```tsx
import { motion, AnimatePresence } from "motion/react"   // ✅
import { motion } from "framer-motion"                   // ❌ old name, not installed
```

### Rule #1: Motion needs `"use client"`

Pages in `app/` are **server components** by default, and they can't use
`motion.div` directly. You have two options:

**Option A: use our wrappers** (easiest, works inside server components):

```tsx
import { FadeIn, Stagger, StaggerItem } from "@/components/motion/fade-in"

<FadeIn delay={0.1}>
  <h1>Dashboard</h1>
</FadeIn>

<Stagger className="grid gap-4 md:grid-cols-3">
  <StaggerItem><Card>…</Card></StaggerItem>
  <StaggerItem><Card>…</Card></StaggerItem>   {/* appears 80ms later */}
</Stagger>
```

**Option B: make your own client component:**

```tsx
"use client"
import { motion } from "motion/react"

export function Pulse() {
  return (
    <motion.div
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 1.5, repeat: Infinity }}
    />
  )
}
```

### Cheat sheet

| Want | Code |
| --- | --- |
| Animate on mount | `initial={{ opacity: 0 }} animate={{ opacity: 1 }}` |
| Hover / tap | `whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}` |
| Animate on scroll into view | `whileInView={{ opacity: 1 }} viewport={{ once: true }}` |
| Animate removal | Wrap in `<AnimatePresence>` and add `exit={{ opacity: 0 }}` |
| Element slides between spots | Same `layoutId` on both (see `site-nav.tsx`) |
| Animate a number | `useMotionValue` + `animate()` (see `score-ring.tsx`) |

### Examples already in the code

- `components/motion/fade-in.tsx`: fade-in and stagger wrappers
- `components/posture/score-ring.tsx`: ring fills up and the number counts up from data
- `components/posture/readings-bar-chart.tsx`: bars grow one after another
- `components/layout/site-nav.tsx`: active nav pill slides between links (`layoutId`)

### Keep it subtle

The app is a health tool, not a game. Keep durations short (0.2–0.5s), use
`easeOut`, and don't animate things the user is trying to read.

---

## Conventions

- **Files:** `kebab-case.tsx`. **Components:** `PascalCase`.
- **Imports:** always use the `@/` alias (`@/components/...`, `@/lib/...`).
- **Server first.** Keep pages as server components that fetch data from
  `lib/data.ts`. Put interactivity (clicks, state, Motion) in small
  `"use client"` components.
- **App-specific components** go in `components/posture/` (or a new folder
  named by feature). **Don't put them in `components/ui/`.** That folder is
  for shadcn.
- **No `Math.random()` or `Date.now()` in render.** They cause hydration
  errors. The mock data uses a fixed date and a seeded random for this reason.
- Mark unfinished work with `// TODO:` so it's easy to grep.

## Pages & what's left (pick one!)

| Page | File | Status | Ideas / TODO |
| --- | --- | --- | --- |
| Dashboard | `app/page.tsx` | Placeholder | Real chart (shadcn `chart`), live updating score, slouch alerts |
| History | `app/history/page.tsx` | Placeholder | Weekly trend chart, session detail page, date filter |
| Device | `app/device/page.tsx` | Placeholder | Pairing flow UI, connection states (connecting / failed / lost) |
| Demo | `app/demo/` | Working | Phone = fake sensor. Open `/demo` on laptop, scan QR with phone. Uses PeerJS (WebRTC) + react-three-fiber. Both devices on the same WiFi works best |
| Settings | (none) | Not started | Alert threshold, vibration on/off, calibration ("sit straight & tap") |
| Onboarding | (none) | Not started | How to wear the sensor, first calibration |

Please also design these states on every page: **loading** (skeletons),
**empty** (no data yet), **disconnected** (sensor offline).

## Open questions (waiting on backend / IoT)

- Bluetooth + Dexie (local) vs. Supabase (cloud)?
- How often does the sensor send data? (Mock data assumes one reading per minute.)
- Raw angles only, or does the ESP32 calculate the score itself?
- Do we need user accounts / login?

Until these are answered, build against the dummy data. The UI shouldn't
have to change much either way.
