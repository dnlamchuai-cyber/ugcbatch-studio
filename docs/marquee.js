// Auto-scrolls the platform strip; pauses while the user hovers, touches, drags or focuses it.
(function () {
  var m = document.querySelector('.marquee'); if (!m) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var paused = false, resumeT, down = false, sx = 0, sl = 0, pos = 0;
  function pause() { paused = true; clearTimeout(resumeT); }
  function resume(d) { clearTimeout(resumeT); resumeT = setTimeout(function () { paused = false; pos = m.scrollLeft; }, d || 1500); }
  m.addEventListener('mouseenter', pause); m.addEventListener('mouseleave', function () { down = false; resume(300); });
  m.addEventListener('touchstart', pause, { passive: true }); m.addEventListener('touchend', function () { resume(); });
  m.addEventListener('focusin', pause); m.addEventListener('focusout', function () { resume(); });
  m.addEventListener('wheel', function () { pause(); resume(); }, { passive: true });
  m.addEventListener('mousedown', function (e) { down = true; sx = e.pageX; sl = m.scrollLeft; e.preventDefault(); });
  window.addEventListener('mouseup', function () { down = false; });
  m.addEventListener('mousemove', function (e) { if (down) m.scrollLeft = sl - (e.pageX - sx); });
  m.addEventListener('scroll', function () { var h = m.scrollWidth / 2; if (m.scrollLeft >= h) m.scrollLeft -= h; });
  if (reduce) return;
  var last = 0;
  function tick(t) {
    if (!paused && last) { pos += (t - last) * 0.05; var h = m.scrollWidth / 2; if (pos >= h) pos -= h; m.scrollLeft = pos; }
    last = t; requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
