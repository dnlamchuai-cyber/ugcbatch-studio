/* UGCBatch Studio site animations — GSAP + ScrollTrigger + Lenis (CDN).
   The page is fully readable with no JS: initial hidden states are
   set HERE, not in CSS, so a failed CDN load degrades gracefully. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- demo videos: load + play only when scrolled into view (preload="none", data-src) --- */
  var vids = document.querySelectorAll('.ph video');
  var play = function (v) {
    if (!v.src && v.dataset.src) { v.src = v.dataset.src; }
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  };
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) play(e.target); else if (e.target.src) e.target.pause(); });
    }, { threshold: 0.01 });
    vids.forEach(function (v) { io.observe(v); });
  } else {
    vids.forEach(play);
  }
  /* strict autoplay fallback: first user click (re)starts any video already in view */
  document.addEventListener('click', function () {
    vids.forEach(function (v) { if (v.src && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } });
  }, { once: true });

  /* --- sound toggle on demo videos (independent of GSAP) --- */
  document.querySelectorAll('.ph').forEach(function (ph) {
    var v = ph.querySelector('video');
    var btn = ph.querySelector('.snd');
    if (!v || !btn) return;
    btn.addEventListener('click', function () {
      // unmute this one, mute the others (one voice at a time)
      document.querySelectorAll('.ph video').forEach(function (o) { if (o !== v) { o.muted = true; } });
      document.querySelectorAll('.ph .snd').forEach(function (o) { if (o !== btn) { o.textContent = '🔇'; } });
      v.muted = !v.muted;
      btn.textContent = v.muted ? '🔇' : '🔊';
    });
  });

  if (reduce || !window.gsap || !window.ScrollTrigger) return;
  try { animate(); } catch (err) {
    /* any failure mid-setup: drop every inline state GSAP may have applied so nothing stays hidden */
    try { gsap.set('.reveal, .reveal *, .hero h1 .ch, .hero h1 .hl, .fbadge', { clearProps: 'opacity,transform,visibility' }); } catch (e) {}
    if (window.console) console.warn('site.js animations disabled:', err);
  }

  function animate() {
  gsap.registerPlugin(ScrollTrigger);

  /* --- Lenis smooth scrolling, driven by the GSAP ticker --- */
  if (window.Lenis) {
    var lenis = new Lenis({ lerp: 0.115 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    // anchor links go through Lenis
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var el = document.querySelector(a.getAttribute('href'));
        if (el) { e.preventDefault(); lenis.scrollTo(el, { offset: -70 }); }
      });
    });
  }

  /* --- split headline into per-character spans grouped by word (keeps spaces; words never break mid-way) --- */
  function splitWords(text) {
    return text.split(/(\s+)/).map(function (part) {
      if (!part) return '';
      if (/^\s+$/.test(part)) return ' ';
      return '<span class="w">' + Array.from(part).map(function (ch) { return '<i class="ch">' + ch + '</i>'; }).join('') + '</span>';
    }).join('');
  }
  document.querySelectorAll('.hero h1 .line > span').forEach(function (span) {
    var out = [];
    span.childNodes.forEach(function (node) {
      if (node.nodeType === 3) {
        out.push(splitWords(node.textContent));
      } else if (node.nodeType === 1) {
        // keep the highlight block whole, split its text inside
        node.innerHTML = splitWords(node.textContent);
        out.push(node.outerHTML);
      }
    });
    span.innerHTML = out.join('');
    span.style.animation = 'none';
  });
  var chStyle = document.createElement('style');
  chStyle.textContent = '.hero h1 .w{display:inline-block;white-space:nowrap;}.hero h1 .ch{display:inline-block;font-style:normal;}';
  document.head.appendChild(chStyle);

  /* --- hero entrance timeline: characters drop in with a bounce --- */
  var tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  // Only the headline animates; kicker, subtitle, CTAs, trust line and demo phones are visible immediately.
  tl.from('.hero h1 .ch', {
      yPercent: -130, opacity: 0, duration: 0.9, ease: 'bounce.out',
      stagger: { each: 0.035, from: 'start' }
    }, '-=0.25')
    .from('.hero h1 .hl', { rotate: 6, duration: 0.7, ease: 'elastic.out(1, 0.5)' }, '-=0.5')
    .from('.fbadge', { scale: 0.6, duration: 0.5, stagger: 0.08, ease: 'back.out(1.8)' }, '-=0.5');


  /* --- oversized chapter numbers drift past their titles --- */
  gsap.utils.toArray('.sec-head .no').forEach(function (el) {
    gsap.fromTo(el, { y: 46 }, {
      y: -46, ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true }
    });
  });

  /* --- app window unfolds as it scrolls into view --- */
  gsap.utils.toArray('.stage .window').forEach(function (w) {
    gsap.fromTo(w, { rotateX: 10, scale: 0.96 }, {
      rotateX: 0, scale: 1, ease: 'none',
      scrollTrigger: { trigger: w, start: 'top 92%', end: 'top 40%', scrub: true }
    });
  });

  /* --- section reveals with stagger --- */
  gsap.utils.toArray('.reveal').forEach(function (el) {
    var head = el.querySelector('.sec-head');
    if (head) {
      gsap.from(head.children, {
        y: 26, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 80%' }
      });
    }
    var group = el.querySelector('.stagger');
    if (group) {
      gsap.from(group.children, {
        y: 30, opacity: 0, duration: 0.7, stagger: 0.09, ease: 'power3.out',
        scrollTrigger: { trigger: group, start: 'top 82%' }
      });
    } else if (!head) {
      gsap.from(el, {
        y: 26, opacity: 0, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 82%' }
      });
    }
    // non-stagger content blocks inside a headed section
    el.querySelectorAll('.tablewrap, .faq-list, .filmreel').forEach(function (blk) {
      gsap.from(blk, {
        y: 30, opacity: 0, duration: 0.75, ease: 'power3.out',
        scrollTrigger: { trigger: blk, start: 'top 85%' }
      });
    });
  });

  /* --- stats count up --- */
  gsap.utils.toArray('.stat b').forEach(function (el) {
    var m = el.textContent.match(/^(\d+)([\s\S]*)$/);
    if (!m || +m[1] === 0) return;
    var target = +m[1], suffix = m[2] || '';
    var obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.3, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 86%' },
      onUpdate: function () { el.textContent = Math.round(obj.v) + suffix; }
    });
  });

  /* --- failsafe: a reveal must never stay hidden. If a ScrollTrigger doesn't fire
     (smooth-scroll desync, programmatic jumps, resized layout), finish every entrance
     tween whose element is on or above the screen, checked with a native
     IntersectionObserver plus scroll/resize and a final sweep after load. --- */
  function finishVisible() {
    ScrollTrigger.getAll().forEach(function (st) {
      var tw = st.animation;
      if (!tw || st.vars.scrub || tw.progress() === 1) return;
      var el = st.trigger; if (!el) return;
      if (el.getBoundingClientRect().top < window.innerHeight) tw.progress(1);
    });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) setTimeout(finishVisible, 1200);
    });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  }
  var sweepT;
  ['scroll', 'resize'].forEach(function (ev) {
    window.addEventListener(ev, function () { clearTimeout(sweepT); sweepT = setTimeout(finishVisible, 900); }, { passive: true });
  });
  window.addEventListener('load', function () { setTimeout(finishVisible, 2500); });

  /* --- film strip drifts sideways with scroll --- */
  gsap.fromTo('.filmstrip', { x: 46 }, {
    x: -26, ease: 'none',
    scrollTrigger: { trigger: '.filmreel', start: 'top bottom', end: 'bottom top', scrub: true }
  });
  }
})();
