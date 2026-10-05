"use client";

// Lighthouse — night defense on a tiny island. Shadows crawl in from every
// side; your light burns them away.
//   Neck  → aims the beam (tilt your head toward a shadow).
//   Back  → powers it. Sit tall: long, bright beam + NOVA charge. Lean: it
//           weakens. Slouch past the threshold for longer than the delay:
//           BLACKOUT, the same moment the ESP32's own motor buzzes.
// Uses every sensor axis and every device setting: threshold (aim range and
// posture zone), delay (blackout grace), vibration (buzz on hit), and the
// calibration / direction setup (checked before a run).
//
// Same structure as the other games: simulation in refs inside useFrame,
// React state only for the HUD (10x/sec) and the game phase.

import { Canvas, useFrame } from "@react-three/fiber";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SpotLight } from "three";
import type { Body } from "./display-view";
import { DemoButton, cx } from "./ui";

type Phase = "ready" | "playing" | "over";
type PowerState = "full" | "weak" | "flicker" | "blackout";
type Hud = {
  score: number;
  combo: number;
  hearts: number;
  power: number;
  charge: number;
  state: PowerState;
  time: number;
};
type Result = { score: number; kills: number; time: number };

/** What the ESP32 is configured to, shown as a checklist before a run. */
export type LighthouseSetup = {
  calibrated: boolean;
  forward: boolean;
  right: boolean;
  threshold: number;
  durationMs: number;
  alertEnabled: boolean;
};

type EnemyType = "wisp" | "dasher" | "brute";
type Enemy = {
  alive: boolean;
  type: EnemyType;
  angle: number;
  r: number;
  hp: number;
  speed: number;
  wob: number;
  burning: boolean;
};
type Particle = { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };

const ARENA_R = 13;
const CORE_R = 1.3;
const BEAM_HALF = (16 * Math.PI) / 180;
const BEAM_MIN = 3.5;
const BEAM_MAX = 10.5;
const TURN_SPEED = 7; // rad/s
const AIM_DEADZONE = 0.12; // neck lean (× threshold) needed to move the beam
const TALL = 0.35; // back lean (× threshold) that still counts as sitting tall
const NOVA_SECONDS = 7; // sitting tall this long fires a NOVA
const NOVA_RADIUS = 10;
const MAX_HEARTS = 3;
const ENEMY_POOL = 40;
const PARTICLE_POOL = 80;
const BEST_KEY = "reallign-demo-lighthouse-best";

const ENEMY_STATS: Record<EnemyType, { hp: number; speed: number; size: number; points: number; eye: string }> = {
  wisp: { hp: 0.35, speed: 1.7, size: 0.7, points: 10, eye: "#f87171" },
  dasher: { hp: 0.6, speed: 1.15, size: 0.85, points: 20, eye: "#fb923c" },
  brute: { hp: 1.8, speed: 0.75, size: 1.5, points: 40, eye: "#e879f9" },
};

const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function World({
  phase,
  getBody,
  useBack,
  onHud,
  onHit,
  onOver,
}: {
  phase: Phase;
  getBody: RefObject<() => Body>;
  /** False for phone/keyboard: there is no back sensor, so power stays full. */
  useBack: boolean;
  onHud: (hud: Hud) => void;
  onHit: () => void;
  onOver: (result: Result) => void;
}) {
  const beam = useRef<Group>(null);
  const beamMat = useRef<MeshBasicMaterial>(null);
  const lampMat = useRef<MeshStandardMaterial>(null);
  const spot = useRef<SpotLight>(null);
  const spotTarget = useRef<Object3D>(null);
  const novaRing = useRef<Mesh>(null);
  const enemyGroups = useRef<(Group | null)[]>([]);
  const enemyMats = useRef<(MeshStandardMaterial | null)[]>([]);
  const eyeMats = useRef<(MeshBasicMaterial | null)[]>([]);
  const particleMeshes = useRef<(Mesh | null)[]>([]);
  const sim = useRef({
    aim: -Math.PI / 2,
    power: 1,
    charge: 0,
    state: "full" as PowerState,
    hearts: MAX_HEARTS,
    score: 0,
    kills: 0,
    combo: 1,
    comboT: 0,
    spawnIn: 1.5,
    t: 0,
    hudT: 0,
    shake: 0,
    nova: -1, // ring progress 0..1, -1 = idle
    over: false,
    lastPhase: "ready" as Phase,
    enemies: Array.from({ length: ENEMY_POOL }, (): Enemy => ({
      alive: false,
      type: "wisp",
      angle: 0,
      r: 0,
      hp: 0,
      speed: 0,
      wob: 0,
      burning: false,
    })),
    particles: Array.from({ length: PARTICLE_POOL }, (): Particle => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })),
  });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;

    if (phase === "playing" && s.lastPhase !== "playing") {
      Object.assign(s, {
        power: 1,
        charge: 0,
        state: "full",
        hearts: MAX_HEARTS,
        score: 0,
        kills: 0,
        combo: 1,
        comboT: 0,
        spawnIn: 1.5,
        t: 0,
        hudT: 0,
        shake: 0,
        nova: -1,
        over: false,
      });
      for (const e of s.enemies) e.alive = false;
    }
    s.lastPhase = phase;

    const burst = (x: number, z: number, n: number) => {
      for (const p of s.particles) {
        if (n <= 0) break;
        if (p.life > 0) continue;
        const a = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 4;
        Object.assign(p, { life: 0.6, x, y: 0.6, z, vx: Math.cos(a) * v, vy: 2 + Math.random() * 3, vz: Math.sin(a) * v });
        n--;
      }
    };
    const kill = (e: Enemy) => {
      const stats = ENEMY_STATS[e.type];
      e.alive = false;
      s.kills += 1;
      s.score += stats.points * s.combo;
      s.combo = Math.min(10, s.combo + 1);
      s.comboT = 2.5;
      burst(Math.cos(e.angle) * e.r, Math.sin(e.angle) * e.r, e.type === "brute" ? 18 : 9);
      if (s.kills % 25 === 0) s.hearts = Math.min(MAX_HEARTS, s.hearts + 1);
    };

    if (phase === "playing" && !s.over) {
      const body = getBody.current();
      s.t += dt;

      // --- neck aims ---
      const aimMag = Math.hypot(body.neckFwd, body.neckRight);
      if (aimMag > AIM_DEADZONE) {
        // forward = up the screen (-z), right = +x
        const want = Math.atan2(-body.neckFwd, body.neckRight);
        const diff = wrapPi(want - s.aim);
        s.aim += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * dt);
      }

      // --- back powers ---
      const backLean = useBack ? Math.hypot(body.fwd, body.right) : 0;
      let target: number;
      if (body.slouching) {
        s.state = "blackout";
        target = 0;
      } else if (backLean > 1) {
        s.state = "flicker";
        target = 0.3;
      } else if (backLean > TALL) {
        s.state = "weak";
        target = 1 - ((backLean - TALL) / (1 - TALL)) * 0.5;
      } else {
        s.state = "full";
        target = 1;
      }
      s.power += (target - s.power) * smooth(target < s.power ? 4 : 1.5, dt);

      if (s.state === "full") s.charge = Math.min(1, s.charge + dt / NOVA_SECONDS);
      else if (s.state === "blackout") s.charge = Math.max(0, s.charge - dt / 2);
      if (s.charge >= 1 && s.nova < 0) {
        s.charge = 0;
        s.nova = 0;
      }

      // --- NOVA shockwave ---
      if (s.nova >= 0) {
        s.nova += dt / 0.6;
        const ringR = s.nova * NOVA_RADIUS;
        for (const e of s.enemies) if (e.alive && e.r < ringR) kill(e);
        if (s.nova >= 1) s.nova = -1;
      }

      // --- spawn ---
      s.spawnIn -= dt;
      if (s.spawnIn <= 0) {
        s.spawnIn = Math.max(0.4, 1.7 - s.t * 0.018) * (0.6 + Math.random() * 0.8);
        const slot = s.enemies.find((e) => !e.alive);
        if (slot) {
          const roll = Math.random();
          const type: EnemyType =
            s.t > 15 && roll < 0.18 ? "brute" : s.t > 30 && roll < 0.45 ? "dasher" : "wisp";
          const st = ENEMY_STATS[type];
          Object.assign(slot, {
            alive: true,
            type,
            angle: Math.random() * Math.PI * 2,
            r: ARENA_R,
            hp: st.hp,
            speed: st.speed * (1 + s.t * 0.006),
            wob: Math.random() * 10,
            burning: false,
          });
        }
      }

      // --- enemies ---
      const beamLen = BEAM_MIN + (BEAM_MAX - BEAM_MIN) * s.power;
      const lit = s.power > 0.05 && !(s.state === "flicker" && Math.random() < 0.35);
      for (const e of s.enemies) {
        if (!e.alive) continue;
        e.r -= e.speed * dt;
        if (e.type === "dasher") e.angle += Math.sin(s.t * 3 + e.wob) * 0.9 * dt;

        const inCone = Math.abs(wrapPi(e.angle - s.aim)) < BEAM_HALF + Math.atan(0.5 / Math.max(e.r, 0.5));
        e.burning = lit && inCone && e.r < beamLen;
        if (e.burning) {
          e.hp -= dt * (0.5 + s.power);
          if (e.hp <= 0) {
            kill(e);
            continue;
          }
        }

        if (e.r < CORE_R) {
          e.alive = false;
          s.hearts -= 1;
          s.combo = 1;
          s.shake = 0.5;
          burst(Math.cos(e.angle) * CORE_R, Math.sin(e.angle) * CORE_R, 12);
          onHit();
          if (s.hearts <= 0) {
            s.over = true;
            onOver({ score: Math.floor(s.score), kills: s.kills, time: s.t });
          }
        }
      }

      s.comboT -= dt;
      if (s.comboT <= 0) s.combo = 1;

      s.hudT += dt;
      if (s.hudT > 0.1) {
        s.hudT = 0;
        onHud({
          score: Math.floor(s.score),
          combo: s.combo,
          hearts: s.hearts,
          power: s.power,
          charge: s.charge,
          state: s.state,
          time: s.t,
        });
      }
    } else if (phase === "ready") {
      s.t += dt;
      s.aim += dt * 0.6;
      s.power = 1;
      s.state = "full";
    }

    // --- push into the scene ---
    const beamLen = BEAM_MIN + (BEAM_MAX - BEAM_MIN) * s.power;
    const flick = s.state === "flicker" ? 0.4 + Math.random() * 0.6 : 1;
    const on = s.state !== "blackout" && phase !== "over";
    if (beam.current) {
      beam.current.rotation.y = -s.aim;
      beam.current.scale.set(beamLen, 1, beamLen);
      beam.current.visible = on;
    }
    if (beamMat.current) {
      beamMat.current.opacity = 0.32 * s.power * flick;
      beamMat.current.color.set(s.state === "full" ? "#fef3c7" : "#fdba74");
    }
    if (lampMat.current) lampMat.current.emissiveIntensity = on ? 0.6 + 2.4 * s.power * flick : 0.05;
    if (spot.current && spotTarget.current) {
      spotTarget.current.position.set(Math.cos(s.aim) * 6, 0, Math.sin(s.aim) * 6);
      spotTarget.current.updateMatrixWorld();
      spot.current.target = spotTarget.current;
      spot.current.intensity = on ? 90 * s.power * flick : 0;
      spot.current.distance = beamLen + 3;
    }
    if (novaRing.current) {
      novaRing.current.visible = s.nova >= 0;
      const r = Math.max(0.01, s.nova * NOVA_RADIUS);
      novaRing.current.scale.set(r, r, r);
      (novaRing.current.material as MeshBasicMaterial).opacity = 0.8 * (1 - Math.max(0, s.nova));
    }

    const time = state.clock.elapsedTime;
    s.enemies.forEach((e, i) => {
      const g = enemyGroups.current[i];
      if (!g) return;
      g.visible = e.alive;
      if (!e.alive) return;
      const st = ENEMY_STATS[e.type];
      const x = Math.cos(e.angle) * e.r;
      const z = Math.sin(e.angle) * e.r;
      g.position.set(x, 0.45 * st.size + Math.sin(time * 4 + e.wob) * 0.12, z);
      g.scale.setScalar(st.size * (e.burning ? 0.92 + Math.random() * 0.1 : 1));
      g.lookAt(0, g.position.y, 0);
      const mat = enemyMats.current[i];
      if (mat) mat.emissiveIntensity = e.burning ? 1.2 : 0;
      eyeMats.current[i * 2]?.color.set(st.eye);
      eyeMats.current[i * 2 + 1]?.color.set(st.eye);
    });

    s.particles.forEach((p, i) => {
      const m = particleMeshes.current[i];
      if (!m) return;
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 9 * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
      }
      m.visible = p.life > 0;
      m.position.set(p.x, p.y, p.z);
      m.scale.setScalar(Math.max(0.01, p.life / 0.6));
    });

    s.shake = Math.max(0, s.shake - dt);
    const sh = s.shake * 0.6;
    // Narrow screens (phones) see less sideways: pull back so the island fits.
    const zoom = Math.min(2.2, Math.max(1, 1.5 / (state.size.width / state.size.height)));
    state.camera.position.set((Math.random() - 0.5) * sh, (15 + (Math.random() - 0.5) * sh) * zoom, 9.5 * zoom);
    state.camera.lookAt(0, 0, 1);
    if (state.scene.fog && "near" in state.scene.fog) {
      state.scene.fog.near = 16 * zoom;
      state.scene.fog.far = 34 * zoom;
    }
  });

  return (
    <>
      <color attach="background" args={["#040814"]} />
      <fog attach="fog" args={["#040814", 16, 34]} />
      <ambientLight intensity={0.16} color="#93c5fd" />
      <hemisphereLight args={["#1e3a8a", "#000000", 0.35]} />

      {/* ground + island */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#050b1c" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[ARENA_R, 64]} />
        <meshStandardMaterial color="#14203d" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
        <ringGeometry args={[ARENA_R - 0.15, ARENA_R, 64]} />
        <meshBasicMaterial color="#1e40af" transparent opacity={0.5} />
      </mesh>

      {/* lighthouse */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.45 + i * 0.85, 0]}>
          <cylinderGeometry args={[0.55 - i * 0.08, 0.62 - i * 0.08, 0.85, 24]} />
          <meshStandardMaterial color={i % 2 ? "#dc2626" : "#f8fafc"} />
        </mesh>
      ))}
      <mesh position={[0, 3.1, 0]}>
        <sphereGeometry args={[0.38, 24, 16]} />
        <meshStandardMaterial ref={lampMat} color="#fef9c3" emissive="#fde047" emissiveIntensity={2} />
      </mesh>
      <mesh position={[0, 3.55, 0]}>
        <coneGeometry args={[0.5, 0.5, 24]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <pointLight position={[0, 3.1, 0]} intensity={3} distance={5} color="#fde68a" />
      <object3D ref={spotTarget} />
      <spotLight
        ref={spot}
        position={[0, 3.1, 0]}
        angle={BEAM_HALF * 1.3}
        penumbra={0.5}
        decay={1}
        color="#fef3c7"
      />

      {/* beam: flat circular sector pointing +x, rotated around y */}
      <group ref={beam} position={[0, 0.05, 0]}>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1, 24, -BEAM_HALF, BEAM_HALF * 2]} />
          <meshBasicMaterial ref={beamMat} color="#fef3c7" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      </group>

      {/* NOVA ring */}
      <mesh ref={novaRing} rotation-x={-Math.PI / 2} position={[0, 0.1, 0]} visible={false}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color="#a5f3fc" transparent opacity={0.8} depthWrite={false} />
      </mesh>

      {/* shadows (pooled) */}
      {Array.from({ length: ENEMY_POOL }, (_, i) => (
        <group key={i} ref={(g) => void (enemyGroups.current[i] = g)} visible={false}>
          <mesh>
            <sphereGeometry args={[0.45, 16, 12]} />
            <meshStandardMaterial
              ref={(m) => void (enemyMats.current[i] = m)}
              color="#120a1f"
              emissive="#c084fc"
              emissiveIntensity={0}
              roughness={0.9}
            />
          </mesh>
          {[-0.15, 0.15].map((x, j) => (
            <mesh key={x} position={[x, 0.1, 0.38]}>
              <sphereGeometry args={[0.07, 8, 6]} />
              <meshBasicMaterial ref={(m) => void (eyeMats.current[i * 2 + j] = m)} />
            </mesh>
          ))}
        </group>
      ))}

      {/* sparks */}
      {Array.from({ length: PARTICLE_POOL }, (_, i) => (
        <mesh key={i} ref={(m) => void (particleMeshes.current[i] = m)} visible={false}>
          <sphereGeometry args={[0.08, 6, 4]} />
          <meshBasicMaterial color={i % 2 ? "#fde68a" : "#c084fc"} />
        </mesh>
      ))}
    </>
  );
}

const STATE_BANNER: Partial<Record<PowerState, { text: string; className: string }>> = {
  weak: { text: "Sit taller for a stronger beam", className: "bg-amber-500/90" },
  flicker: { text: "Past your threshold: light flickering", className: "bg-orange-600/90 animate-pulse" },
  blackout: { text: "BLACKOUT! Sit up to relight", className: "bg-red-600/90 animate-pulse" },
};

export function LighthouseGame({
  getBody,
  input,
  setup,
  onStart,
  onHit,
  onOpenSetup,
}: {
  getBody: () => Body;
  input: string;
  /** ESP32 configuration; null when no sensor is connected. */
  setup: LighthouseSetup | null;
  onStart: () => void;
  /** Called when a shadow reaches the lighthouse (used to buzz the sensor). */
  onHit?: () => void;
  onOpenSetup?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState<Hud>({
    score: 0,
    combo: 1,
    hearts: MAX_HEARTS,
    power: 1,
    charge: 0,
    state: "full",
    time: 0,
  });
  const [best, setBest] = useState(0);
  const [last, setLast] = useState<Result>({ score: 0, kills: 0, time: 0 });

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
    setPhase("playing");
  }, [onStart]);

  const over = useCallback((result: Result) => {
    setLast(result);
    setPhase("over");
    setBest((prev) => {
      const next = Math.max(prev, result.score);
      try {
        localStorage.setItem(BEST_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);
  const hit = useCallback(() => onHit?.(), [onHit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "Enter") && phase !== "playing") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start]);

  const banner = phase === "playing" ? STATE_BANNER[hud.state] : undefined;
  const setupMissing = setup && (!setup.calibrated || !setup.forward || !setup.right);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <Canvas camera={{ position: [0, 15, 9.5], fov: 50 }} dpr={[1, 2]}>
        <World
          phase={phase}
          getBody={bodyRef}
          useBack={input === "ESP32"}
          onHud={setHud}
          onHit={hit}
          onOver={over}
        />
      </Canvas>

      {phase === "playing" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-4 font-mono text-white">
            <div>
              <div className="text-3xl font-bold tabular-nums drop-shadow">{hud.score}</div>
              {hud.combo > 1 && <div className="text-sm font-bold text-amber-300 drop-shadow">combo ×{hud.combo}</div>}
            </div>
            <div className="text-right drop-shadow">
              <div className="text-xl tracking-widest">
                {"♥".repeat(Math.max(0, hud.hearts))}
                <span className="opacity-30">{"♥".repeat(Math.max(0, MAX_HEARTS - hud.hearts))}</span>
              </div>
              <div className="text-sm tabular-nums">{hud.time.toFixed(0)}s</div>
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 flex w-44 flex-col gap-1.5 font-mono text-[10px] text-white/80">
            <Meter label="light" value={hud.power} color={hud.state === "full" ? "#fde68a" : "#fb923c"} />
            <Meter label="nova" value={hud.charge} color="#a5f3fc" />
          </div>
        </>
      )}

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 text-center">
          <span className={cx("rounded-full px-4 py-1.5 text-sm font-bold text-white", banner.className)}>
            {banner.text}
          </span>
        </div>
      )}

      <AnimatePresence>
        {phase !== "playing" && (
          <motion.div
            key={phase}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 flex overflow-y-auto bg-black/50 p-4 text-center text-white"
          >
            <div className="m-auto flex max-w-sm flex-col items-center gap-3">
              <h2 className="text-3xl font-black italic tracking-tight sm:text-4xl">
                {phase === "ready" ? "LIGHTHOUSE" : "THE LIGHT WENT OUT"}
              </h2>
              {phase === "over" && (
                <p className="font-mono text-lg tabular-nums">
                  {last.score} pts · {last.kills} shadows · {last.time.toFixed(0)}s · best {best}
                </p>
              )}
              {phase === "ready" && best > 0 && <p className="font-mono text-sm">best {best}</p>}
              <ul className="space-y-1 text-left text-sm text-white/85">
                {input === "ESP32" ? (
                  <>
                    <li>🎯 <b>Head</b> aims the beam: tilt it toward a shadow.</li>
                    <li>🪑 <b>Back</b> powers it: sit tall for a long, bright beam.</li>
                    <li>💥 Stay tall for {NOVA_SECONDS}s to fire a <b>NOVA</b> that clears the island.</li>
                    <li>
                      ⚠️ Past {setup?.threshold}° for {((setup?.durationMs ?? 0) / 1000).toFixed(1)}s ={" "}
                      <b>blackout</b>.
                    </li>
                  </>
                ) : (
                  <>
                    <li>🎯 {input === "Phone" ? "Tilt the phone" : "Arrow keys / WASD"} to aim the beam.</li>
                    <li>💥 Every {NOVA_SECONDS}s a NOVA clears the island.</li>
                    <li>Connect the ESP32 to aim with your head and power the light with your posture.</li>
                  </>
                )}
              </ul>
              {setup && (
                <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-white/10 p-3 text-left font-mono text-xs">
                  <Check ok={setup.calibrated} label="calibrated" />
                  <Check ok={setup.forward} label="forward set" />
                  <Check ok={setup.right} label="right set" />
                  <Check ok={setup.alertEnabled} label={setup.alertEnabled ? "buzz on hit" : "vibration off"} />
                </div>
              )}
              {setupMissing && onOpenSetup && (
                <button className="text-xs text-amber-300 underline" onClick={onOpenSetup}>
                  Finish sensor setup for accurate aiming →
                </button>
              )}
              <DemoButton onClick={start} className="mt-1 pointer-coarse:h-12 pointer-coarse:px-6 pointer-coarse:text-base">
                {phase === "ready" ? "Light it up" : "Again"} <span className="ml-2 opacity-60 pointer-coarse:hidden">space</span>
              </DemoButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "text-emerald-300" : "text-amber-300"}>
      {ok ? "✓" : "•"} {label}
    </span>
  );
}
