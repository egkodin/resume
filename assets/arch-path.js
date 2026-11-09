// "Path of a message" walkthrough on the Saturn diagram: a dot runs along the wires and a caption explains each hop.
// The order mirrors backend/app/routers/chat.py: save to PostgreSQL, then publish to Redis for every FastAPI instance.
(() => {
  const arch = document.querySelector('.arch');
  const play = arch && arch.querySelector('.arch__play');
  if (!play || !Element.prototype.animate) return;

  const grid = arch.querySelector('.arch__grid');
  const button = play.querySelector('button');
  const caption = play.querySelector('.arch__step');
  const [browser, nginx, core] = arch.querySelectorAll('.arch__flow .node');
  const [postgres, redis] = arch.querySelectorAll('.arch__deps .node');
  const wide = window.matchMedia('(min-width: 900px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SPEED = 0.3;           // px per ms
  const MIN_LEG = 600;         // ms
  const DWELL = 1300;          // ms to read each caption
  const REDUCED_STEP = 1400;   // ms per hop when the dot does not travel

  const pulse = document.createElement('i');
  pulse.className = 'arch__pulse';
  pulse.setAttribute('aria-hidden', 'true');
  grid.append(pulse);

  const steps = [
    { at: browser, text: 'Браузер отправляет сообщение по WebSocket.' },
    { at: nginx, text: 'Nginx передаёт соединение одному из двух экземпляров FastAPI.' },
    { at: core, text: 'FastAPI проверяет доступ к комнате.' },
    { at: postgres, text: 'Сообщение сохраняется в PostgreSQL, история чата не теряется.' },
    { at: redis, text: 'Событие уходит в Redis Pub/Sub, его получают оба экземпляра.' },
    { at: core, text: 'Каждый экземпляр рассылает сообщение своим участникам комнаты.' },
  ];

  let run = 0;

  function box(el) {
    const g = grid.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { left: r.left - g.left, right: r.right - g.left, top: r.top - g.top, bottom: r.bottom - g.top, cy: r.top - g.top + r.height / 2 };
  }

  const rem = (name) => parseFloat(getComputedStyle(arch).getPropertyValue(name)) * parseFloat(getComputedStyle(document.documentElement).fontSize);

  // polyline from the node a dot is at to the next one, following the wires of the current layout
  function legPoints(from, to) {
    const isWide = wide.matches;
    const B = box(browser), N = box(nginx), C = box(core), deps = box(postgres);
    const wireX = B.left + rem('--x') + 1.5;
    const busX = isWide ? deps.left - rem('--gap') / 2 : wireX;
    const exit = (n) => (isWide ? { x: n.right, y: n.cy } : { x: wireX, y: n.bottom });
    const entry = (n) => (isWide ? { x: n.left, y: n.cy } : { x: wireX, y: n.top });
    const coreToBus = isWide ? [exit(C), { x: busX, y: C.cy }] : [exit(C)];
    const dep = (el) => { const d = box(el); return [{ x: busX, y: d.cy }, { x: d.left, y: d.cy }]; };

    if (from === browser) return [exit(B), entry(N)];
    if (from === nginx) return [exit(N), entry(C)];
    if (from === core && to === postgres) return [...coreToBus, ...dep(postgres)];
    if (from === postgres) return [...[...dep(postgres)].reverse(), ...dep(redis)];
    if (from === redis) return [...[...dep(redis)].reverse(), ...[...coreToBus].reverse()];
    return [];
  }

  async function travel(points, token) {
    if (points.length < 2) return;
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    let walked = 0;
    const frames = points.map((p, i) => {
      if (i > 0) walked += lengths[i - 1];
      return { transform: `translate(${p.x}px, ${p.y}px)`, offset: walked / total };
    });
    pulse.getAnimations().forEach((a) => a.cancel());
    const motion = pulse.animate(frames, { duration: Math.max(MIN_LEG, total / SPEED), easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' });
    try { await motion.finished; } catch { /* cancelled by a restart */ }
    if (token !== run) throw new Error('restarted');
  }

  const wait = (ms, token) => new Promise((resolve, reject) => setTimeout(() => (token === run ? resolve() : reject(new Error('restarted'))), ms));

  function light(node, text) {
    arch.querySelectorAll('.node.is-lit').forEach((n) => n.classList.remove('is-lit'));
    node.classList.add('is-lit');
    caption.textContent = text;
  }

  async function start() {
    run += 1;
    const token = run;
    arch.classList.remove('is-pending');
    pulse.getAnimations().forEach((a) => a.cancel());
    const moving = !reduceMotion.matches;
    button.textContent = 'Показать ещё раз';
    pulse.classList.toggle('is-on', moving);
    try {
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        if (i > 0 && moving) await travel(legPoints(steps[i - 1].at, step.at), token);
        else if (i > 0) await wait(REDUCED_STEP, token);
        light(step.at, `${i + 1}/${steps.length}. ${step.text}`);
        if (i === 0 && moving) {
          const B = legPoints(browser, nginx)[0];
          pulse.animate([{ transform: `translate(${B.x}px, ${B.y}px)` }], { duration: 0, fill: 'forwards' });
        }
        if (moving && i < steps.length - 1) await wait(DWELL, token);
      }
      pulse.classList.remove('is-on');
    } catch {
      /* a newer run took over */
    }
  }

  play.hidden = false;
  button.addEventListener('click', start);
})();
