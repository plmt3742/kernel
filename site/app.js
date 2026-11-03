(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');

  /* Sticky header state -------------------------------------------------- */
  const header = $('[data-header]');
  const syncHeader = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  /* Mobile navigation ---------------------------------------------------- */
  const toggle = $('[data-nav-toggle]');
  const panel = $('#mobile-nav');
  const backdrop = $('[data-nav-backdrop]');
  const navLabel = $('[data-nav-label]');

  if (toggle && panel && backdrop && navLabel) {
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    const setNav = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      navLabel.textContent = open ? '关闭导航菜单' : '打开导航菜单';
      panel.hidden = !open;
      backdrop.hidden = !open;
      document.body.classList.toggle('nav-open', open);
    };

    toggle.addEventListener('click', () => setNav(!isOpen()));
    backdrop.addEventListener('click', () => {
      setNav(false);
      toggle.focus();
    });
    panel.addEventListener('click', (event) => {
      if (event.target.closest('a')) setNav(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        setNav(false);
        toggle.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && isOpen()) setNav(false);
    });
  }

  /* Scroll reveal -------------------------------------------------------- */
  const revealTargets = $$('[data-reveal]');
  const showAll = () => revealTargets.forEach((el) => el.classList.add('is-visible'));

  if (reduced.matches || !('IntersectionObserver' in window)) {
    showAll();
  } else {
    revealTargets.forEach((el) => el.classList.add('reveal-ready'));

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    revealTargets.forEach((el) => observer.observe(el));
  }

  /* FAQ: one open at a time --------------------------------------------- */
  const faqItems = $$('.faq__item');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item && other.open) other.open = false;
      });
    });
  });

  /* Pointer surface ------------------------------------------------------ */
  const surfaces = $$('[data-surface]');

  if (surfaces.length && finePointer.matches && !reduced.matches) {
    let frame = 0;
    const states = surfaces.map((el) => ({
      el,
      targetX: 50,
      targetY: 50,
      x: 50,
      y: 50,
      active: false,
    }));

    const animate = () => {
      frame = 0;
      let moving = false;

      for (const state of states) {
        if (!state.active) continue;
        state.x += (state.targetX - state.x) * 0.16;
        state.y += (state.targetY - state.y) * 0.16;
        state.el.style.setProperty('--mx', `${state.x.toFixed(2)}%`);
        state.el.style.setProperty('--my', `${state.y.toFixed(2)}%`);
        if (Math.abs(state.targetX - state.x) > 0.05 || Math.abs(state.targetY - state.y) > 0.05) {
          moving = true;
        }
      }

      if (moving) frame = window.requestAnimationFrame(animate);
    };

    states.forEach((state) => {
      state.el.addEventListener('pointermove', (event) => {
        const rect = state.el.getBoundingClientRect();
        state.targetX = ((event.clientX - rect.left) / rect.width) * 100;
        state.targetY = ((event.clientY - rect.top) / rect.height) * 100;
        state.active = true;
        if (!frame) frame = window.requestAnimationFrame(animate);
      }, { passive: true });

      state.el.addEventListener('pointerleave', () => {
        state.active = false;
      });
    });
  }

  /* Hero parallax -------------------------------------------------------- */
  const parallax = $('[data-parallax]');

  if (parallax && !reduced.matches) {
    let frame = 0;
    const render = () => {
      frame = 0;
      const offset = Math.min(window.scrollY * 0.05, 10);
      parallax.style.setProperty('--py', `${offset.toFixed(2)}px`);
    };
    const queue = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    render();
    window.addEventListener('scroll', queue, { passive: true });
  }
})();
