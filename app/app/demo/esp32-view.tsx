"use client";

// ESP32 tab of /demo: live back + neck angles from the two MPU6050s over BLE
// (pitch = forward/back, roll = sideways), plus the firmware's commands
// (calibrate, directions, threshold, duration, vibration).

import { useEffect, useRef, useState } from "react";
import { tilt, TONE_COLORS, type Tone } from "./math";
import { DemoButton, Panel, cx } from "./ui";
import { HISTORY_SIZE, NO_BLUETOOTH, type Esp32Link, type Esp32Sample } from "./use-esp32";

const BACK_COLOR = "#3b82f6";
const NECK_COLOR = "#a855f7";

function toneFor(angle: number, threshold: number): Tone {
  const a = Math.abs(angle);
  if (a > threshold) return "bad";
  if (a > threshold * 0.6) return "warning";
  return "good";
}

/** Same rule as the firmware: total tilt (forward + sideways) of either sensor. */
function isOver(s: Esp32Sample, threshold: number) {
  return tilt(s.back, s.backRoll) > threshold || tilt(s.neck, s.neckRoll) > threshold;
}

/** How long (ms) the latest run of over-threshold samples has lasted. */
function slouchMs(history: Esp32Sample[], threshold: number) {
  let i = history.length - 1;
  if (i < 0 || !isOver(history[i], threshold)) return 0;
  while (i > 0 && isOver(history[i - 1], threshold)) i--;
  return history.at(-1)!.t - history[i].t;
}

export function Esp32View({ ble }: { ble: Esp32Link }) {
  const connected = ble.status === "connected";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="flex flex-col gap-4 lg:min-h-[520px]">
        {connected ? <LivePanel ble={ble} /> : <ConnectPanel ble={ble} />}
      </div>
      <div className="flex flex-col gap-4">
        {connected && <Controls ble={ble} />}
        <LogPanel ble={ble} />
      </div>
    </div>
  );
}

function ConnectPanel({ ble }: { ble: Esp32Link }) {
  return (
    <Panel className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
      <p className="text-lg font-medium">Connect the posture sensor</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Power on the ESP32, then pick <span className="font-mono">PostureMonitor</span> from the browser&apos;s
        Bluetooth list. First time only: sit upright while it calibrates after boot.
      </p>
      {ble.supported ? (
        <DemoButton className="h-12 px-6 text-base" onClick={ble.connect} disabled={ble.status === "connecting"}>
          {ble.status === "connecting" ? "Connecting…" : "Connect via Bluetooth"}
        </DemoButton>
      ) : (
        <p className="max-w-sm text-sm text-destructive">{NO_BLUETOOTH}</p>
      )}
      {ble.error && <p className="text-sm text-destructive">{ble.error}</p>}
    </Panel>
  );
}

function LivePanel({ ble }: { ble: Esp32Link }) {
  const { latest, history, settings, calibrating, cal } = ble;
  const threshold = settings.threshold;
  const slouch = slouchMs(history, threshold);
  const s = latest ?? { back: 0, neck: 0, backRoll: 0, neckRoll: 0 };

  let headline = "Upright";
  let headlineTone: Tone = "good";
  if (calibrating) {
    headline = cal?.phase === "wait" ? `Sit upright… ${cal.seconds}` : "Hold still…";
    headlineTone = "warning";
  } else if (!latest) {
    headline = "Waiting for data…";
    headlineTone = "warning";
  } else if (latest.motor) {
    headline = "Slouching, buzzing";
    headlineTone = "bad";
  } else if (slouch > 0) {
    headline = `Slouching ${(slouch / 1000).toFixed(1)}s`;
    headlineTone = "warning";
  }

  return (
    <>
      <Panel className="grid gap-4 sm:grid-cols-[260px_1fr]">
        <div className="grid grid-cols-2 gap-2 text-center text-[11px] text-muted-foreground">
          <div>
            <Figure a={s.back} b={s.neck} threshold={threshold} />
            side
          </div>
          <div>
            <Figure a={s.backRoll} b={s.neckRoll} threshold={threshold} front />
            front
          </div>
        </div>
        <div className="flex flex-col justify-center gap-4">
          <div className="text-2xl font-semibold" style={{ color: TONE_COLORS[headlineTone] }}>
            {headline}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Reading label="Back" color={BACK_COLOR} pitch={latest?.back} roll={latest?.backRoll} threshold={threshold} />
            <Reading label="Neck" color={NECK_COLOR} pitch={latest?.neck} roll={latest?.neckRoll} threshold={threshold} />
          </div>
          <p className="text-xs text-muted-foreground">
            Buzzes after {(settings.durationMs / 1000).toFixed(1)}s tilted past {threshold}°
            {settings.alertEnabled ? "" : " (vibration off)"}
          </p>
        </div>
      </Panel>
      <Panel className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Last 30 s</span>
          <Legend color={BACK_COLOR} label="back" />
          <Legend color={NECK_COLOR} label="neck" />
          <Legend color="currentColor" label="side lean" dashed />
          <span className="ml-auto">red = ±{threshold}°</span>
        </div>
        <Chart history={history} threshold={threshold} />
      </Panel>
    </>
  );
}

function Reading({
  label,
  color,
  pitch,
  roll,
  threshold,
}: {
  label: string;
  color: string;
  pitch: number | undefined;
  roll: number | undefined;
  threshold: number;
}) {
  const total = pitch === undefined ? undefined : tilt(pitch, roll ?? 0);
  const tone = total === undefined ? null : toneFor(total, threshold);
  const signed = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label} tilt
      </div>
      <div
        className="font-mono text-3xl font-bold tabular-nums"
        style={{ color: tone ? TONE_COLORS[tone] : undefined }}
      >
        {total === undefined ? "–" : `${total.toFixed(1)}°`}
      </div>
      {pitch !== undefined && (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
          {signed(pitch, "fwd", "back")} · {signed(roll ?? 0, "right", "left")}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-0 w-3"
        style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`, opacity: dashed ? 0.7 : 1 }}
      />
      {label}
    </span>
  );
}

/**
 * Stick figure: hips at the bottom, back and neck segments tilted by a and b.
 * Side view uses pitch (+ = leaning right on screen = forward); front view
 * uses roll (+ = the user's right, drawn on screen right like a mirror).
 */
function Figure({ a, b, threshold, front }: { a: number; b: number; threshold: number; front?: boolean }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const hip = { x: 60, y: 150 };
  const shoulder = { x: hip.x + 70 * Math.sin(rad(a)), y: hip.y - 70 * Math.cos(rad(a)) };
  const neckEnd = { x: shoulder.x + 26 * Math.sin(rad(b)), y: shoulder.y - 26 * Math.cos(rad(b)) };
  const head = { x: neckEnd.x + 12 * Math.sin(rad(b)), y: neckEnd.y - 12 * Math.cos(rad(b)) };
  const backTone = TONE_COLORS[toneFor(a, threshold)];
  const neckTone = TONE_COLORS[toneFor(b, threshold)];
  const across = { x: Math.cos(rad(a)) * 26, y: Math.sin(rad(a)) * 26 }; // shoulder line (front view)

  return (
    <svg viewBox="0 0 120 160" className="mx-auto h-40 w-full" aria-label={front ? "Front view" : "Side view"}>
      <line x1={hip.x} y1={hip.y} x2={hip.x} y2={10} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="4 4" />
      <line x1={20} y1={hip.y} x2={100} y2={hip.y} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <line x1={hip.x} y1={hip.y} x2={shoulder.x} y2={shoulder.y} stroke={backTone} strokeWidth={8} strokeLinecap="round" />
      {front && (
        <line
          x1={shoulder.x - across.x}
          y1={shoulder.y - across.y}
          x2={shoulder.x + across.x}
          y2={shoulder.y + across.y}
          stroke={backTone}
          strokeWidth={6}
          strokeLinecap="round"
        />
      )}
      <line x1={shoulder.x} y1={shoulder.y} x2={neckEnd.x} y2={neckEnd.y} stroke={neckTone} strokeWidth={5} strokeLinecap="round" />
      <circle cx={head.x} cy={head.y} r={12} fill={neckTone} />
    </svg>
  );
}

type Series = { key: "back" | "neck" | "backRoll" | "neckRoll"; color: string; dashed?: boolean };
const SERIES: Series[] = [
  { key: "back", color: BACK_COLOR },
  { key: "neck", color: NECK_COLOR },
  { key: "backRoll", color: BACK_COLOR, dashed: true },
  { key: "neckRoll", color: NECK_COLOR, dashed: true },
];

function Chart({ history, threshold }: { history: Esp32Sample[]; threshold: number }) {
  const W = 600;
  const H = 180;
  const range = Math.max(45, threshold * 1.5);
  const y = (deg: number) => H / 2 - (Math.max(-range, Math.min(range, deg)) / range) * (H / 2 - 4);
  const x = (i: number) => (i / (HISTORY_SIZE - 1)) * W;
  const offset = HISTORY_SIZE - history.length; // fill from the right
  const points = (key: Series["key"]) => history.map((s, i) => `${x(i + offset)},${y(s[key])}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full min-h-40 w-full">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.15} />
      {[threshold, -threshold].map((t) => (
        <line
          key={t}
          x1={0}
          x2={W}
          y1={y(t)}
          y2={y(t)}
          stroke={TONE_COLORS.bad}
          strokeOpacity={0.5}
          strokeDasharray="6 6"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {SERIES.map((s) => (
        <polyline
          key={s.key}
          points={points(s.key)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.dashed ? 1.5 : 2}
          strokeDasharray={s.dashed ? "4 3" : undefined}
          strokeOpacity={s.dashed ? 0.7 : 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function Controls({ ble }: { ble: Esp32Link }) {
  const { settings, send, calibrating, cal, fwd, rgt } = ble;

  let calNote = settings.zero ? "Saved on the ESP32." : "Not calibrated yet.";
  if (cal?.phase === "ok") calNote = "Done, saved on the ESP32.";
  if (cal?.phase === "fail") calNote = `You moved ${cal.wobble.toFixed(0)}°. Sit still and try again.`;

  let fwdNote = settings.dir ? "Saved on the ESP32." : "Lean forward ~30° (back and head), then tap.";
  if (fwd === "pending") fwdNote = "Reading…";
  else if (fwd?.ok) fwdNote = "Done: leaning forward now reads positive.";
  else if (fwd) fwdNote = `Only ${fwd.angle.toFixed(0)}° of lean. Lean further (15°+) and tap again.`;

  let rgtNote = settings.rdir ? "Saved on the ESP32." : "Lean to your right ~20° (back and head), then tap.";
  if (rgt === "pending") rgtNote = "Reading…";
  else if (rgt?.ok) rgtNote = "Done: leaning right now reads positive.";
  else if (rgt) rgtNote = `Only ${rgt.angle.toFixed(0)}° of lean. Lean further (10°+) and tap again.`;

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{ble.deviceName}</span>
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={ble.disconnect}>
          Disconnect
        </button>
      </div>
      <SetupStep step={1} note={calNote} bad={cal?.phase === "fail"}>
        <DemoButton variant="outline" className="w-full" onClick={() => send("CAL")} disabled={calibrating}>
          {cal?.phase === "wait" ? `Sit upright… ${cal.seconds}` : cal?.phase === "hold" ? "Hold still…" : "Calibrate upright"}
        </DemoButton>
      </SetupStep>
      <SetupStep step={2} note={fwdNote} bad={!!fwd && fwd !== "pending" && !fwd.ok}>
        <DemoButton
          variant="outline"
          className="w-full"
          onClick={() => send("FWD")}
          disabled={calibrating || fwd === "pending"}
        >
          Set forward direction
        </DemoButton>
      </SetupStep>
      <SetupStep step={3} note={rgtNote} bad={!!rgt && rgt !== "pending" && !rgt.ok}>
        <DemoButton
          variant="outline"
          className="w-full"
          onClick={() => send("RGT")}
          disabled={calibrating || rgt === "pending"}
        >
          Set right direction
        </DemoButton>
      </SetupStep>
      <NumberSetting
        label="Threshold (°)"
        value={settings.threshold}
        min={1}
        max={89}
        onSet={(v) => send(`T=${v}`)}
      />
      <NumberSetting
        label="Delay (ms)"
        value={settings.durationMs}
        min={0}
        max={60000}
        step={500}
        onSet={(v) => send(`D=${v}`)}
      />
      <div className="grid grid-cols-2 gap-2">
        <DemoButton variant="outline" onClick={() => send(settings.alertEnabled ? "OFF" : "ON")}>
          Vibration {settings.alertEnabled ? "on" : "off"}
        </DemoButton>
        <DemoButton variant="outline" onClick={() => send("BUZZ")}>
          Test buzz
        </DemoButton>
      </div>
    </Panel>
  );
}

function SetupStep({
  step,
  note,
  bad,
  children,
}: {
  step: number;
  note: string;
  bad?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="mt-2 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">
        {step}
      </span>
      <div className="flex flex-1 flex-col gap-1">
        {children}
        <p className={cx("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{note}</p>
      </div>
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  onSet,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onSet: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow the device's value when it changes (e.g. after a STATUS reply).
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(String(value));
  }
  const parsed = Number(draft);
  const valid = draft !== "" && parsed >= min && parsed <= max;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSet(parsed);
      }}
    >
      <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
        {label}
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-lg border bg-background px-2 font-mono text-sm text-foreground"
        />
      </label>
      <DemoButton type="submit" variant="outline" disabled={!valid || parsed === value}>
        Set
      </DemoButton>
    </form>
  );
}

function LogPanel({ ble }: { ble: Esp32Link }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [ble.log]);

  return (
    <Panel className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Device log</span>
      <div ref={scroller} className="h-56 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs">
        {ble.log.length === 0 ? (
          <span className="text-muted-foreground">Nothing yet.</span>
        ) : (
          ble.log.map((l) => (
            <div
              key={l.id}
              className={cx(
                "break-words",
                l.text.startsWith(">") && "text-muted-foreground",
                (l.text.startsWith("!") || l.text.startsWith("ERR") || l.text.startsWith("PERINGATAN")) &&
                  "text-destructive"
              )}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
