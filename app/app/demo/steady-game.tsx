"use client";

// Steady — keep a wobbly ragdoll balanced on top of a pillar while wind gusts
// try to knock it off. The ragdoll is an inverted pendulum in two axes
// (forward/back and left/right): left alone it tips over, and the player's lean
// pushes it back. It mirrors you: lean the way you want it to go.
//
// Like Tilt Racer, the simulation lives in refs inside useFrame; React state
// only drives the HUD (10x/sec) and the game phase.

import { Canvas, useFrame } from "@react-three/fiber";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { Body } from "./display-view";
import { TONE_COLORS } from "./math";
import { DemoButton, cx } from "./ui";

type Phase = "ready" | "playing" | "falling" | "over";
type Hud = { score: number; mult: number; time: number; slouching: boolean };
type RadarRefs = {
  doll: RefObject<SVGCircleElement | null>;
  you: RefObject<SVGCircleElement | null>;
  wind: RefObject<SVGLineElement | null>;
};

const FALL_DEG = 40; // ragdoll past this = falls off
const STEADY_DEG = 6; // inside this = "steady", multiplier grows
const INSTABILITY = 2.2; // how fast it tips over by itself (1/s²)
const CONTROL = 60; // deg/s² of push at full lean
const DAMPING = 1.6;
const MAX_MULT = 5;
const SLOUCH_WIND = 1.8; // wind multiplier while the player slouches
const BEST_KEY = "reallign-demo-steady-best";
const STREAKS = 36;
const RADAR_R = 44;

const rad = (d: number) => (d * Math.PI) / 180;
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

const INPUT_HINTS: Record<string, string> = {
  ESP32:
    "Sit upright and hold still when you press start. Lean (forward, back, sideways) the way the ragdoll should go. Small moves win. Slouching past your threshold makes the wind stronger.",
  Phone: "Hold your phone upright. Tilt it the way the ragdoll should go.",
  Keyboard: "Arrow keys / WASD push the ragdoll. Connect a phone or the ESP32 to balance with your body.",
};

function World({
  phase,
  getBody,
  onHud,
  onFall,
  onFallen,
  radar,
}: {
  phase: Phase;
  getBody: RefObject<() => Body>;
  onHud: (hud: Hud) => void;
  onFall: (score: number, time: number) => void;
  onFallen: () => void;
  radar: RadarRefs;
}) {
  const doll = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const torsoMat = useRef<MeshStandardMaterial>(null);
  const streakMeshes = useRef<(Mesh | null)[]>([]);
  const sim = useRef({
    th: { x: 0, z: 0 }, // tilt in degrees: x = toward camera, z = screen right
    vel: { x: 0, z: 0 },
    wind: { x: 0, z: 0 },
    windTarget: { x: 0, z: 0 },
    gustIn: 0,
    t: 0,
    score: 0,
    mult: 1,
    hudT: 0,
    fallT: 0,
    fell: false,
    lastPhase: "ready" as Phase,
    you: { fwd: 0, right: 0 },
    streaks: [] as { x: number; y: number; z: number }[],
  });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;
    if (s.streaks.length === 0) {
      s.streaks = Array.from({ length: STREAKS }, () => ({
        x: (Math.random() - 0.5) * 16,
        y: Math.random() * 5 - 1,
        z: (Math.random() - 0.5) * 10,
      }));
    }

    if (phase === "playing" && s.lastPhase !== "playing") {
      Object.assign(s, {
        th: { x: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 },
        vel: { x: 0, z: 0 },
        wind: { x: 0, z: 0 },
        windTarget: { x: 0, z: 0 },
        gustIn: 2,
        t: 0,
        score: 0,
        mult: 1,
        hudT: 0,
        fallT: 0,
        fell: false,
      });
    }
    s.lastPhase = phase;

    if (phase === "playing") {
      const body = getBody.current();
      s.you = { fwd: body.fwd, right: body.right };
      s.t += dt;

      // New gust every 2–4 s, stronger as time goes on.
      s.gustIn -= dt;
      if (s.gustIn <= 0) {
        s.gustIn = 2 + Math.random() * 2;
        const strength = (4 + s.t * 0.35) * (0.4 + Math.random() * 0.6);
        const dir = Math.random() * Math.PI * 2;
        s.windTarget = { x: Math.cos(dir) * Math.min(strength, 30), z: Math.sin(dir) * Math.min(strength, 30) };
      }
      const windScale = body.slouching ? SLOUCH_WIND : 1;
      s.wind.x += (s.windTarget.x * windScale - s.wind.x) * smooth(1.5, dt);
      s.wind.z += (s.windTarget.z * windScale - s.wind.z) * smooth(1.5, dt);

      // Inverted pendulum per axis: tips away from upright, wind pushes,
      // the player's lean pushes back.
      const ax = INSTABILITY * s.th.x + s.wind.x + CONTROL * body.fwd - DAMPING * s.vel.x;
      const az = INSTABILITY * s.th.z + s.wind.z + CONTROL * body.right - DAMPING * s.vel.z;
      s.vel.x += ax * dt;
      s.vel.z += az * dt;
      s.th.x += s.vel.x * dt;
      s.th.z += s.vel.z * dt;

      const lean = Math.hypot(s.th.x, s.th.z);
      if (body.slouching) s.mult = 1;
      else if (lean < STEADY_DEG) s.mult = Math.min(MAX_MULT, s.mult + dt * 0.5);
      else if (lean > FALL_DEG / 2) s.mult = Math.max(1, s.mult - dt * 2);
      s.score += dt * 10 * Math.floor(s.mult);

      // The phase prop only flips on the next render, so report the fall once.
      if (lean > FALL_DEG && !s.fell) {
        s.fell = true;
        onFall(Math.floor(s.score), s.t);
      }

      s.hudT += dt;
      if (s.hudT > 0.1) {
        s.hudT = 0;
        onHud({ score: Math.floor(s.score), mult: Math.floor(s.mult), time: s.t, slouching: body.slouching });
      }
    } else if (phase === "falling") {
      // Topple the rest of the way, then lie flat.
      const lean = Math.hypot(s.th.x, s.th.z) || 1;
      s.fallT += dt;
      const grow = Math.min(90, lean + (40 + s.fallT * 260) * dt);
      s.th.x *= grow / lean;
      s.th.z *= grow / lean;
      if (s.fallT > 1.1) onFallen();
    } else if (phase === "ready") {
      // Idle sway on the title screen.
      s.t += dt;
      s.th = { x: Math.sin(s.t * 1.3) * 4, z: Math.sin(s.t * 0.9) * 6 };
      s.wind = { x: 0, z: Math.sin(s.t * 0.5) * 6 };
    }

    // --- push into the scene ---
    const lean = Math.hypot(s.th.x, s.th.z);
    if (doll.current) {
      doll.current.rotation.set(rad(s.th.x), 0, rad(-s.th.z));
    }
    const fallen = phase === "falling" || phase === "over";
    const flail = fallen ? 0 : Math.min(1, lean / FALL_DEG);
    const wobble = Math.sin(state.clock.elapsedTime * 14) * flail * 0.6;
    if (armL.current && armR.current) {
      const base = fallen ? 0.3 : 1.25; // arms out for balance, limp when fallen
      armL.current.rotation.z = -(base + wobble + s.vel.z * 0.01);
      armR.current.rotation.z = base - wobble + s.vel.z * 0.01;
      armL.current.rotation.x = armR.current.rotation.x = fallen ? 0 : -s.vel.x * 0.01;
    }
    if (torsoMat.current) {
      const tone = lean < FALL_DEG * 0.35 ? "good" : lean < FALL_DEG * 0.7 ? "warning" : "bad";
      torsoMat.current.color.set(TONE_COLORS[tone]);
    }

    // Wind streaks drift with the wind (x on screen = z tilt, depth = x tilt).
    const windMag = Math.hypot(s.wind.x, s.wind.z);
    streakMeshes.current.forEach((m, i) => {
      const p = s.streaks[i];
      if (!m) return;
      p.x += s.wind.z * dt * 0.5;
      p.z += s.wind.x * dt * 0.5;
      if (p.x > 8) p.x -= 16;
      if (p.x < -8) p.x += 16;
      if (p.z > 5) p.z -= 10;
      if (p.z < -5) p.z += 10;
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = Math.atan2(-s.wind.x, s.wind.z);
      m.scale.x = 0.3 + windMag * 0.08;
      (m.material as MeshStandardMaterial).opacity = Math.min(0.6, windMag * 0.03);
    });

    // Radar (plain SVG over the canvas, updated without React).
    const toRadar = (deg: number) => (Math.max(-FALL_DEG, Math.min(FALL_DEG, deg)) / FALL_DEG) * RADAR_R;
    radar.doll.current?.setAttribute("cx", String(toRadar(s.th.z)));
    radar.doll.current?.setAttribute("cy", String(toRadar(s.th.x)));
    radar.you.current?.setAttribute("cx", String(Math.max(-1.5, Math.min(1.5, s.you.right)) * RADAR_R * 0.66));
    radar.you.current?.setAttribute("cy", String(Math.max(-1.5, Math.min(1.5, s.you.fwd)) * RADAR_R * 0.66));
    radar.wind.current?.setAttribute("x2", String((s.wind.z / 30) * RADAR_R));
    radar.wind.current?.setAttribute("y2", String((s.wind.x / 30) * RADAR_R));

    state.camera.lookAt(0, 1.2, 0);
  });

  return (
    <>
      <color attach="background" args={["#0b1229"]} />
      <fog attach="fog" args={["#0b1229", 10, 40]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 8, 6]} intensity={1.5} />
      <pointLight position={[0, 3, 3]} intensity={6} color="#93c5fd" />

      {/* pillar + platform */}
      <mesh position={[0, -4, 0]}>
        <cylinderGeometry args={[0.55, 0.8, 8, 24]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.9, 0.9, 0.1, 32]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>

      {/* far-off clouds for depth */}
      {[
        [-6, -3, -8, 1.6],
        [7, -2, -10, 2],
        [-9, 1, -14, 2.4],
        [5, 3, -16, 1.8],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[r, 16, 12]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      ))}

      {/* wind streaks */}
      {Array.from({ length: STREAKS }, (_, i) => (
        <mesh key={i} ref={(m) => void (streakMeshes.current[i] = m)}>
          <boxGeometry args={[1, 0.02, 0.02]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}

      {/* ragdoll: pivots at the feet, faces the camera (+z) */}
      <group ref={doll}>
        {[-0.17, 0.17].map((x) => (
          <mesh key={x} position={[x, 0.42, 0]}>
            <capsuleGeometry args={[0.11, 0.6, 4, 12]} />
            <meshStandardMaterial color="#1e3a8a" />
          </mesh>
        ))}
        <mesh position={[0, 1.2, 0]}>
          <capsuleGeometry args={[0.3, 0.55, 6, 16]} />
          <meshStandardMaterial ref={torsoMat} color={TONE_COLORS.good} />
        </mesh>
        <mesh position={[0, 1.95, 0]}>
          <sphereGeometry args={[0.26, 24, 16]} />
          <meshStandardMaterial color="#fde68a" />
        </mesh>
        {[-0.09, 0.09].map((x) => (
          <mesh key={x} position={[x, 2, 0.23]}>
            <sphereGeometry args={[0.04, 12, 8]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        ))}
        {/* arms hang from the shoulders; rotation.z swings them out */}
        <group ref={armL} position={[-0.36, 1.5, 0]}>
          <mesh position={[0, -0.32, 0]}>
            <capsuleGeometry args={[0.08, 0.5, 4, 12]} />
            <meshStandardMaterial color="#fde68a" />
          </mesh>
        </group>
        <group ref={armR} position={[0.36, 1.5, 0]}>
          <mesh position={[0, -0.32, 0]}>
            <capsuleGeometry args={[0.08, 0.5, 4, 12]} />
            <meshStandardMaterial color="#fde68a" />
          </mesh>
        </group>
      </group>
    </>
  );
}

export function SteadyGame({
  getBody,
  input,
  onStart,
  onFall,
}: {
  /** Called every frame while playing. */
  getBody: () => Body;
  /** "ESP32", "Phone" or "Keyboard" — picks the hint on the title screen. */
  input: string;
  /** Called right before a run starts (used to zero the phone / sensor). */
  onStart: () => void;
  /** Called once when the ragdoll falls (used to buzz the sensor). */
  onFall?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState<Hud>({ score: 0, mult: 1, time: 0, slouching: false });
  const [best, setBest] = useState(0);
  const [last, setLast] = useState({ score: 0, time: 0 });
  const radarDoll = useRef<SVGCircleElement>(null);
  const radarYou = useRef<SVGCircleElement>(null);
  const radarWind = useRef<SVGLineElement>(null);

  const bodyRef = useRef(getBody);
  useEffect(() => {
    bodyRef.current = getBody;
  }, [getBody]);

  const start = useCallback(() => {
    setBest((prev) => {
      if (prev > 0) return prev;
      try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
      } catch {
        return 0;
      }
    });
    onStart();
    setHud({ score: 0, mult: 1, time: 0, slouching: false });
    setPhase("playing");
  }, [onStart]);

  const fall = useCallback(
    (score: number, time: number) => {
      onFall?.();
      setLast({ score, time });
      setPhase("falling");
      setBest((prev) => {
        const next = Math.max(prev, score);
        try {
          localStorage.setItem(BEST_KEY, String(next));
        } catch {}
        return next;
      });
    },
    [onFall]
  );
  const fallen = useCallback(() => setPhase("over"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "Enter") && (phase === "ready" || phase === "over")) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start]);

  const active = phase === "playing" || phase === "falling";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <Canvas camera={{ position: [0, 2.4, 6.5], fov: 50 }} dpr={[1, 2]}>
        <World
          phase={phase}
          getBody={bodyRef}
          onHud={setHud}
          onFall={fall}
          onFallen={fallen}
          radar={{ doll: radarDoll, you: radarYou, wind: radarWind }}
        />
      </Canvas>

      {active && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-4 font-mono text-white">
          <div>
            <div className="text-3xl font-bold tabular-nums drop-shadow">{hud.score}</div>
            {hud.mult > 1 && <div className="text-sm font-bold text-emerald-300 drop-shadow">steady ×{hud.mult}</div>}
          </div>
          <div className="text-right text-sm tabular-nums drop-shadow">{hud.time.toFixed(1)}s</div>
        </div>
      )}

      {/* balance radar: filled dot = ragdoll, ring = your lean, line = wind */}
      <svg
        viewBox={`${-RADAR_R - 6} ${-RADAR_R - 6} ${RADAR_R * 2 + 12} ${RADAR_R * 2 + 12}`}
        className={cx("pointer-events-none absolute bottom-4 right-4 size-28 transition-opacity", !active && "opacity-0")}
      >
        <circle r={RADAR_R} fill="rgba(15,23,42,0.6)" stroke="rgba(255,255,255,0.35)" />
        <circle r={(STEADY_DEG / FALL_DEG) * RADAR_R} fill="none" stroke={TONE_COLORS.good} strokeOpacity={0.8} />
        <line ref={radarWind} x1={0} y1={0} x2={0} y2={0} stroke="#bae6fd" strokeWidth={2} strokeLinecap="round" />
        <circle ref={radarYou} r={6} fill="none" stroke="white" strokeWidth={1.5} />
        <circle ref={radarDoll} r={4} fill="#fde68a" />
      </svg>

      {active && hud.slouching && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center">
          <span className="animate-pulse rounded-full bg-red-600/90 px-4 py-1.5 text-sm font-bold text-white">
            SIT UP! Wind is stronger
          </span>
        </div>
      )}

      <AnimatePresence>
        {(phase === "ready" || phase === "over") && (
          <motion.div
            key={phase}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 grid place-items-center bg-black/40 text-center text-white"
          >
            <div className="flex flex-col items-center gap-3">
              <h2 className="text-4xl font-black italic tracking-tight">{phase === "ready" ? "STEADY" : "FELL OFF!"}</h2>
              {phase === "over" && (
                <p className="font-mono text-lg tabular-nums">
                  score {last.score} · {last.time.toFixed(1)}s · best {best}
                </p>
              )}
              {phase === "ready" && best > 0 && <p className="font-mono text-sm">best {best}</p>}
              <p className="max-w-xs text-sm text-white/80">{INPUT_HINTS[input] ?? INPUT_HINTS.Keyboard}</p>
              <DemoButton onClick={start} className="mt-2">
                {phase === "ready" ? "Start" : "Again"} <span className="ml-2 opacity-60">space</span>
              </DemoButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
