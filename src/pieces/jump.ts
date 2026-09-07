import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { bezierPath, boxGeo, lerpProfile, mergeGeometries, slopePath, sweep, TRACK_PROFILE, TROUGH_HALF, type Profile } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/**
 * Spring jump pad over 4 cells. The track curves down into a 35-degree chute that
 * ends at a stop bar; the marble slides down into that pocket, a spring button in
 * the chute floor pops up along the floor's normal and launches it in an arc into
 * a long catch tray that funnels it to the exit.
 *
 * Nothing static moves: the button only ever rises a little above the floor, so a
 * marble arriving mid-stroke just rides it back down instead of falling into a gap.
 * A metering gate at the top of the chute lets one marble at a time into the
 * pocket: two marbles in the pocket would be kicked out sideways together.
 */
const TILT = THREE.MathUtils.degToRad(35); // chute slope at the pocket
const ALONG = new THREE.Vector3(Math.cos(TILT), -Math.sin(TILT), 0); // down the chute
const NORMAL = new THREE.Vector3(Math.sin(TILT), Math.cos(TILT), 0); // launch direction (55 degrees)
/** Where the chute floor meets the stop bar (centre line). */
const POCKET_END = v3(0.26, 0.12, 0);
const BAR_H = 0.3;
/** Button plate half extents (along the chute, across it): wide, so an off-centre marble is still hit squarely. */
const BUTTON_HX = 0.13;
const BUTTON_HZ = 0.25;
const STROKE = 0.16;
const T_CHARGE = 0.2;
const T_FIRE = 0.045; // ~3.5 m/s
const T_HOLD = 0.05;
const T_RETURN = 0.3;
/** A marble must sit in the pocket for this long before the button fires. */
const DWELL = 0.2;
const GATE_X = -0.3;
/** Crest of the stop bar (its upper -X corner after the tilt) and the top of the catch tray's
 *  back wall: the two lips of the notch the ramp below fills in. */
const NOTCH_FROM = v3(0.432, 0.366, 0);
const NOTCH_TO = v3(0.6, 0.485, 0);
const smooth = (t: number) => t * t * (3 - 2 * t);

const chutePath = bezierPath(v3(-0.5, H, 0), v3(-0.2, H, 0), POCKET_END.clone().addScaledVector(ALONG, -0.3), POCKET_END);
/** Chute floor height at local x (the path is monotonic in x). */
function chuteY(x: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (chutePath(mid).pos.x < x) lo = mid;
    else hi = mid;
  }
  return chutePath((lo + hi) / 2).pos.y;
}
const GATE_Y = chuteY(GATE_X);

function gateGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.05, 0.34, 0.6);
  g.translate(GATE_X, GATE_Y + 0.17, 0);
  return g;
}

const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -TILT);
/** Marble centre when resting against the stop bar. */
const REST = POCKET_END.clone().addScaledVector(ALONG, -0.15).addScaledVector(NORMAL, 0.15);
/** Button centre at rest: its top face just under the chute floor beneath the resting marble. */
const BUTTON_REST = POCKET_END.clone().addScaledVector(ALONG, -0.15).addScaledVector(NORMAL, -0.035);

function buttonGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(BUTTON_HX * 2, 0.024, BUTTON_HZ * 2);
  g.applyQuaternion(tiltQ);
  g.translate(BUTTON_REST.x, BUTTON_REST.y, BUTTON_REST.z);
  return g;
}

/** Coil spring along +Y from 0 to len, for the visual only. */
function springGeometry(len: number): THREE.BufferGeometry {
  const coils = 5;
  const r = 0.08;
  const pts: THREE.Vector3[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, t * len, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.016, 6, false);
}

export const jumpDef: PieceDef = {
  id: 'jump',
  name: '弹簧跳台',
  footprint: [0, 1, 2, 3].map((x) => ({ x, z: 0 })),
  heightUnits: 3,
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(3.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    // Chute: level at the port, curving down to the 35-degree pocket floor (tangent-continuous, so a
    // fast marble stays on the floor instead of flying off a step and landing on the stop bar).
    const chute = sweep(chutePath, 20);
    // Stop bar across the pocket end, perpendicular to the floor, taller than the marble centre.
    const bar = new THREE.BoxGeometry(0.05, BAR_H + 0.08, 0.72);
    bar.translate(0.025, (BAR_H + 0.08) / 2 - 0.08, 0);
    bar.applyQuaternion(tiltQ);
    bar.translate(POCKET_END.x, POCKET_END.y, POCKET_END.z);
    // Catch tray: wide flat floor with tall walls, morphing into the standard trough at the exit;
    // it slopes towards the exit the whole way.
    const wide: Profile = TRACK_PROFILE.map(([s, u]) => {
      if (Math.abs(s) > TROUGH_HALF + 1e-6) return [Math.sign(s) * 0.5, u < 0 ? u : 0.55];
      return [s * (0.44 / TROUGH_HALF), u < 0.2 ? Math.abs(s) * 0.05 : 0.55];
    });
    const catchTray = sweep(slopePath(v3(0.6, 0.16, 0), v3(3.5, 0, 0)), 40, (t) => lerpProfile(wide, TRACK_PROFILE, smooth(THREE.MathUtils.clamp((t - 0.55) / 0.45, 0, 1))));
    // Fill the V between the stop bar's top edge and the catch tray's back wall. Without it a
    // marble that clears the bar but not the wall balances on the bar's top corner: it is then
    // outside the pocket, so the spring never fires, yet inside the gate's "busy" zone, so the
    // gate never reopens and the whole track jams behind it. The fill is a 35-degree ramp from
    // the bar's crest up to the wall top, steeper than anything a ball can rest on, so a marble
    // landing there rolls back over the crest into the pocket and gets launched again.
    const rampLen = Math.hypot(NOTCH_TO.x - NOTCH_FROM.x, NOTCH_TO.y - NOTCH_FROM.y);
    const rampAngle = Math.atan2(NOTCH_TO.y - NOTCH_FROM.y, NOTCH_TO.x - NOTCH_FROM.x);
    const ramp = new THREE.BoxGeometry(rampLen, 0.1, 0.76);
    ramp.translate(0, -0.05, 0); // top face through the origin
    ramp.rotateZ(rampAngle);
    ramp.translate((NOTCH_FROM.x + NOTCH_TO.x) / 2, (NOTCH_FROM.y + NOTCH_TO.y) / 2, 0);
    // Back wall of the catch tray, side walls beside the pocket, floor under it.
    const walls = mergeGeometries([
      boxGeo(v3(0.62, 0.2, 0), v3(0.02, 0.3, 0.5)),
      boxGeo(v3(0.2, 0.5, 0.4), v3(0.45, 0.5, 0.02)),
      boxGeo(v3(0.2, 0.5, -0.4), v3(0.45, 0.5, 0.02)),
      boxGeo(v3(0.2, 0.02, 0), v3(0.45, 0.02, 0.42)),
    ]);
    return {
      parts: [
        { geometry: chute, material: 'wood' },
        { geometry: bar, material: 'dark' },
        { geometry: ramp, material: 'dark' },
        { geometry: catchTray, material: 'wood' },
        { geometry: walls, material: 'dark' },
      ],
      preview: [
        { geometry: buttonGeometry(), material: 'accent' },
        { geometry: gateGeometry(), material: 'accent' },
      ],
      mechanisms: [makeButton],
    };
  },
};

function makeButton(ctx: MechanismContext): Mechanism {
  const body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ctx.origin.x, ctx.origin.y, ctx.origin.z).setRotation(ctx.quat));
  ctx.world.createCollider(
    RAPIER.ColliderDesc.cuboid(BUTTON_HX, 0.012, BUTTON_HZ)
      .setTranslation(BUTTON_REST.x, BUTTON_REST.y, BUTTON_REST.z)
      .setRotation(tiltQ)
      .setFriction(0.5)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
    body,
  );
  const button = new THREE.Mesh(buttonGeometry(), new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.6 }));
  button.castShadow = true;
  ctx.root.add(button);
  ctx.bind(body, button);

  // Metering gate: closed while the pocket is busy, never rises onto a marble.
  const gateBody = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ctx.origin.x, ctx.origin.y, ctx.origin.z).setRotation(ctx.quat));
  ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, 0.17, 0.3).setTranslation(GATE_X, GATE_Y + 0.17, 0), gateBody);
  const gate = new THREE.Mesh(gateGeometry(), new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.7 }));
  gate.castShadow = true;
  ctx.root.add(gate);
  ctx.bind(gateBody, gate);
  let gateDown = 1; // 1 = lowered (open)

  // Spring under the button (visual), stretched along the launch direction.
  const springLen0 = 0.22;
  const base = BUTTON_REST.clone().addScaledVector(NORMAL, -springLen0 - 0.012);
  const spring = new THREE.Mesh(springGeometry(springLen0), new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.4, metalness: 0.6 }));
  spring.position.copy(base).applyQuaternion(ctx.quat).add(ctx.origin);
  spring.quaternion.copy(ctx.quat).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), NORMAL));
  ctx.root.add(spring);

  const inv = ctx.quat.clone().invert();
  const local = new THREE.Vector3();
  let phase: 'idle' | 'charge' | 'fire' | 'hold' | 'return' = 'idle';
  let t = 0;
  let dwell = 0;
  let s = 0; // displacement along NORMAL

  return {
    update(dt, marbles) {
      // Where the marbles are: at rest in the pocket, anywhere past the gate, or over the gate.
      let near = false;
      let pastGate = false;
      let overGate = false;
      for (const m of marbles) {
        local.copy(m.pos).sub(ctx.origin).applyQuaternion(inv);
        if (Math.abs(local.z) > 0.4 || local.y < -0.2 || local.y > 0.9) continue;
        if (local.distanceTo(REST) < 0.2) near = true;
        if (local.x > GATE_X + 0.2 && local.x < 0.6) pastGate = true;
        if (Math.abs(local.x - GATE_X) < 0.24) overGate = true;
      }
      const wantDown = phase === 'idle' && !pastGate ? 1 : 0;
      const gateSpeed = dt / 0.15;
      if (!(wantDown === 0 && overGate)) gateDown += THREE.MathUtils.clamp(wantDown - gateDown, -gateSpeed, gateSpeed);
      local.set(0, -0.42 * smooth(gateDown), 0).applyQuaternion(ctx.quat).add(ctx.origin);
      gateBody.setNextKinematicTranslation({ x: local.x, y: local.y, z: local.z });

      if (phase === 'idle') {
        dwell = near ? dwell + dt : 0;
        if (dwell >= DWELL) {
          phase = 'charge';
          t = 0;
          dwell = 0;
        }
      } else {
        t += dt;
        if (phase === 'charge') {
          s = -0.02 * smooth(Math.min(1, t / T_CHARGE));
          if (t >= T_CHARGE) {
            phase = 'fire';
            t = 0;
          }
        } else if (phase === 'fire') {
          s = -0.02 + (STROKE + 0.02) * Math.min(1, t / T_FIRE);
          if (t >= T_FIRE) {
            phase = 'hold';
            t = 0;
          }
        } else if (phase === 'hold') {
          s = STROKE;
          if (t >= T_HOLD) {
            phase = 'return';
            t = 0;
          }
        } else {
          s = STROKE * (1 - smooth(Math.min(1, t / T_RETURN)));
          if (t >= T_RETURN) {
            phase = 'idle';
            s = 0;
          }
        }
      }
      local.copy(NORMAL).multiplyScalar(s).applyQuaternion(ctx.quat).add(ctx.origin);
      body.setNextKinematicTranslation({ x: local.x, y: local.y, z: local.z });
      spring.scale.y = (springLen0 + s) / springLen0;
    },
    dispose() {
      ctx.unbind(body);
      ctx.unbind(gateBody);
      ctx.world.removeRigidBody(body);
      ctx.world.removeRigidBody(gateBody);
      ctx.root.remove(button, spring, gate);
      button.geometry.dispose();
      spring.geometry.dispose();
      gate.geometry.dispose();
    },
  };
}
