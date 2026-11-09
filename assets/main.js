// Draws the diagrams (Saturn wires, language bar, timeline dots) once each scrolls into view.
// Without JS (or with reduced motion) they are simply shown.
(() => {
  const figures = document.querySelectorAll('.arch, .langs, .timeline');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!figures.length || prefersReducedMotion || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.remove('is-pending');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.3 });
  figures.forEach((figure) => {
    figure.classList.add('is-pending');
    observer.observe(figure);
  });
})();

// Fades lazy site screenshots in once decoded instead of popping in. Already-decoded images are left alone.
(() => {
  const shots = document.querySelectorAll('.case__shot img, .concept__shot img');
  shots.forEach((img) => {
    if (img.complete && img.naturalWidth > 0) return;
    img.classList.add('is-loading');
    const reveal = () => img.classList.remove('is-loading');
    img.addEventListener('load', () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(reveal), { once: true });
    img.addEventListener('error', reveal, { once: true });
  });
})();
