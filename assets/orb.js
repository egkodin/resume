// Wireframe Saturn for the blueprint block: a sphere and a ring of nodes, drawn on canvas without libraries.
// Drag rotates it (with inertia); reduced motion keeps it still unless dragged. Without JS the box stays hidden.
(() => {
  const box = document.querySelector('.orb');
  const canvas = box && box.querySelector('canvas');
  const ctx = canvas && canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  const TAU = Math.PI * 2;
  const TILT = 0.36;            // planet pitch towards the viewer, rad
  const ROLL = -0.32;           // diagonal axis, rad
  const PITCH_LIMIT = 0.25;     // drag range around the base pitch, rad (rubber band adds at most as much again)
  const RING_OUTER = 2.08;
  const CAMERA = 6;             // camera distance in planet radii
  const SPIN = 0.12;            // auto spin, rad/s
  const ORBIT = 0.22;           // ring nodes orbit, rad/s
  const FRICTION = 3.2;         // inertia decay, 1/s
  const RING_NODES = 30;
  const LATITUDES = [-60, -30, 0, 30, 60].map((d) => (d * Math.PI) / 180);
  const MERIDIANS = 12;
  const SEGMENTS = 64;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const css = getComputedStyle(document.documentElement);
  const INK = css.getPropertyValue('--on-blue').trim() || '#fff';
  const BLUE = css.getPropertyValue('--blue').trim() || '#2633D9';

  const view = { w: 0, h: 0, r: 0, cx: 0, cy: 0 };
  const state = { yaw: 0.6, pitch: 0, orbit: 0, velocity: 0, dragging: false, visible: false, last: 0, frame: 0 };
  const history = [];

  const rubberband = (over, limit) => (over * limit * 0.55) / (limit + 0.55 * Math.abs(over));
  const softPitch = (p) => (Math.abs(p) <= PITCH_LIMIT ? p : Math.sign(p) * (PITCH_LIMIT + rubberband(Math.abs(p) - PITCH_LIMIT, PITCH_LIMIT)));

  // largest on-screen half-size of the outer ring (in planet radii) over every reachable pitch, so dragging never crops it
  function ringExtent() {
    const saved = { ...view };
    Object.assign(view, { cx: 0, cy: 0, r: 1 });
    let x = 1, y = 1;
    for (let pitch = TILT - 2 * PITCH_LIMIT; pitch <= TILT + 2 * PITCH_LIMIT + 1e-6; pitch += 0.05) {
      for (let i = 0; i < 72; i += 1) {
        const a = (i / 72) * TAU;
        const p = project(Math.cos(a) * RING_OUTER, 0, Math.sin(a) * RING_OUTER, 0, pitch);
        x = Math.max(x, Math.abs(p.x)); y = Math.max(y, Math.abs(p.y));
      }
    }
    Object.assign(view, saved);
    return { x: x + 0.03, y: y + 0.03 };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = rect.width; view.h = rect.height;
    const fit = ringExtent();
    view.r = 0.94 * Math.min(view.w / 2 / fit.x, view.h / 2 / fit.y);
    view.cx = view.w / 2; view.cy = view.h / 2;
    canvas.width = Math.round(view.w * dpr); canvas.height = Math.round(view.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // local point (unit radius, y = planet axis) -> screen point with depth
  function project(x, y, z, spin, pitch = TILT + softPitch(state.pitch)) {
    const cs = Math.cos(spin), ss = Math.sin(spin);
    let px = x * cs + z * ss, pz = -x * ss + z * cs, py = y;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    [py, pz] = [py * cp - pz * sp, py * sp + pz * cp];
    const cr = Math.cos(ROLL), sr = Math.sin(ROLL);
    [px, py] = [px * cr - py * sr, px * sr + py * cr];
    const k = CAMERA / (CAMERA - pz);
    return { x: view.cx + px * view.r * k, y: view.cy - py * view.r * k, z: pz, k };
  }

  const isOccluded = (p) => p.z < 0 && Math.hypot(p.x - view.cx, p.y - view.cy) < view.r * 1.02;

  // polyline split into front/back runs so each part gets its own weight
  function strokeCurve(points, pass, style) {
    ctx.beginPath();
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      const front = a.z + b.z >= 0;
      if (front !== (pass === 'front')) continue;
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = style; ctx.stroke();
  }

  function sphereCurves() {
    const curves = [];
    LATITUDES.forEach((lat) => {
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const a = (i / SEGMENTS) * TAU;
        pts.push(project(Math.cos(lat) * Math.cos(a), Math.sin(lat), Math.cos(lat) * Math.sin(a), state.yaw));
      }
      curves.push(pts);
    });
    for (let m = 0; m < MERIDIANS / 2; m += 1) {
      const lon = (m / MERIDIANS) * TAU;
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const a = (i / SEGMENTS) * TAU;
        pts.push(project(Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon), state.yaw));
      }
      curves.push(pts);
    }
    return curves;
  }

  function ringCurve(radius) {
    const pts = [];
    for (let i = 0; i <= SEGMENTS * 2; i += 1) {
      const a = (i / (SEGMENTS * 2)) * TAU;
      pts.push(project(Math.cos(a) * radius, 0, Math.sin(a) * radius, state.yaw));
    }
    return pts;
  }

  function strokeRing(points, pass) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      if ((a.z + b.z >= 0) !== (pass === 'front')) continue;
      ctx.globalAlpha = pass === 'back' && (isOccluded(a) || isOccluded(b)) ? 0.12 : 0.85;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawNodes(nodes, pass) {
    nodes.forEach((p) => {
      if ((p.z >= 0) !== (pass === 'front')) return;
      ctx.globalAlpha = pass === 'back' && isOccluded(p) ? 0.15 : 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.4 * p.k, 0, TAU);
      ctx.fillStyle = BLUE; ctx.fill(); ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!view.w) return;
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.lineCap = 'round';
    const curves = sphereCurves();
    const rings = [1.5, RING_OUTER].map(ringCurve);
    const nodes = Array.from({ length: RING_NODES }, (_, i) => {
      const a = (i / RING_NODES) * TAU + state.orbit;
      return project(Math.cos(a) * 1.79, 0, Math.sin(a) * 1.79, state.yaw);
    });

    ctx.lineWidth = 1; ctx.strokeStyle = INK;
    curves.forEach((c) => strokeCurve(c, 'back', 'rgba(255,255,255,0.2)'));
    ctx.lineWidth = 1.25; ctx.strokeStyle = INK;
    rings.forEach((c) => strokeRing(c, 'back'));
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK;
    drawNodes(nodes, 'back');

    // body: same blue, lit from the upper left, so the back half reads as behind glass
    const g = ctx.createRadialGradient(view.cx - view.r * 0.4, view.cy - view.r * 0.45, view.r * 0.1, view.cx, view.cy, view.r * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(10,14,60,0.32)');
    ctx.beginPath(); ctx.arc(view.cx, view.cy, view.r, 0, TAU); ctx.fillStyle = g; ctx.fill();

    ctx.lineWidth = 1;
    curves.forEach((c) => strokeCurve(c, 'front', 'rgba(255,255,255,0.62)'));
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.arc(view.cx, view.cy, view.r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.25;
    rings.forEach((c) => strokeRing(c, 'front'));
    ctx.lineWidth = 1.5;
    drawNodes(nodes, 'front');
  }

  function tick(now) {
    state.frame = 0;
    const dt = Math.min((now - (state.last || now)) / 1000, 0.05);
    state.last = now;
    const still = reduceMotion.matches;
    if (!state.dragging) {
      state.yaw += state.velocity * dt;
      state.velocity *= Math.exp(-FRICTION * dt);
      if (Math.abs(state.velocity) < 0.01) state.velocity = 0;
      if (Math.abs(state.pitch) > PITCH_LIMIT) {
        const bound = Math.sign(state.pitch) * PITCH_LIMIT;
        state.pitch += (bound - state.pitch) * (1 - Math.exp(-10 * dt));
      }
      if (!still) { state.yaw += SPIN * dt; state.orbit += ORBIT * dt; }
    }
    draw();
    const settling = state.velocity !== 0 || Math.abs(state.pitch) > PITCH_LIMIT + 0.001;
    if (state.visible && !document.hidden && (!still || settling || state.dragging)) schedule();
  }

  function schedule() {
    if (!state.frame) state.frame = requestAnimationFrame(tick);
  }

  function pointerDown(e) {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    state.dragging = true; state.velocity = 0;
    history.length = 0; history.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    box.classList.add('is-grabbing');
    state.last = 0; schedule();
  }

  function pointerMove(e) {
    if (!state.dragging) return;
    const prev = history[history.length - 1];
    const k = TAU / Math.max(view.w * 1.4, 1);
    state.yaw += (e.clientX - prev.x) * k;
    if (e.pointerType === 'mouse') state.pitch += (e.clientY - prev.y) * k;
    history.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    while (history.length > 1 && e.timeStamp - history[0].t > 90) history.shift();
    schedule();
  }

  function pointerUp(e) {
    if (!state.dragging) return;
    state.dragging = false;
    box.classList.remove('is-grabbing');
    const first = history[0], lastPoint = history[history.length - 1];
    const span = (lastPoint.t - first.t) / 1000;
    const k = TAU / Math.max(view.w * 1.4, 1);
    // velocity handoff: keep spinning at the speed of the flick (motion users fling, still users only drag)
    state.velocity = span > 0 && e.type === 'pointerup' && !reduceMotion.matches ? ((lastPoint.x - first.x) * k) / span : 0;
    schedule();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  box.hidden = false;
  box.closest('.saturn__head')?.classList.add('has-orb');
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting;
    if (state.visible) { state.last = 0; schedule(); }
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.visible) { state.last = 0; schedule(); } });
  reduceMotion.addEventListener?.('change', () => { state.last = 0; schedule(); });
})();
