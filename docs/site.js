/* ClipForge site animations — GSAP + ScrollTrigger + Lenis (CDN).
   The page is fully readable with no JS: initial hidden states are
   set HERE, not in CSS, so a failed CDN load degrades gracefully. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- make sure demo videos actually play (data-saver / strict autoplay fallback) --- */
  document.querySelectorAll('.ph video').forEach(function (v) {
    var kick = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
    if (v.readyState >= 2) kick(); else v.addEventListener('loadeddata', kick, { once: true });
    document.addEventListener('click', kick, { once: true });
  });

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

  /* --- giant ticker band scrubs slightly with scroll on top of its CSS loop --- */
  gsap.to('.marquee .track', {
    xPercent: -6, ease: 'none',
    scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'bottom top', scrub: true }
  });

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

  /* --- film strip drifts sideways with scroll --- */
  gsap.fromTo('.filmstrip', { x: 46 }, {
    x: -26, ease: 'none',
    scrollTrigger: { trigger: '.filmreel', start: 'top bottom', end: 'bottom top', scrub: true }
  });
})();
