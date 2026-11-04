(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');
  const mobileLoop = window.matchMedia('(max-width: 900px)');
  const canAnimate = () => !reduced.matches;

  /* Header, progress, chapter rail --------------------------------------- */

  const header = $('[data-header]');
  const progress = $('[data-progress]');
  const navLinks = $$('[data-nav-link]');
  const railLinks = $$('[data-rail-link]');
  const headerSections = ['loop', 'modules', 'daily', 'local', 'personas', 'faq', 'download']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const railSections = ['loop', 'modules', 'local', 'personas', 'faq', 'download']
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const setHeaderState = () => {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 10);
  };

  const setProgress = () => {
    if (!progress) return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? clamp(window.scrollY / scrollable, 0, 1) : 0;
    progress.style.setProperty('--p', ratio.toFixed(4));
  };

  const setSpy = () => {
    const line = window.innerHeight * 0.38;
    let headerId = '';
    let railId = '';

    headerSections.forEach((section) => {
      if (section.getBoundingClientRect().top <= line) headerId = section.id;
    });

    railSections.forEach((section) => {
      if (section.getBoundingClientRect().top <= line) railId = section.id;
    });

    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${headerId}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });

    railLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${railId}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  /* Mobile navigation ----------------------------------------------------- */

  const navToggle = $('[data-nav-toggle]');
  const navPanel = $('#mobile-nav');
  const navBackdrop = $('[data-nav-backdrop]');
  const navLabel = $('[data-nav-label]');

  if (navToggle && navPanel && navBackdrop && navLabel) {
    const navOpen = () => navToggle.getAttribute('aria-expanded') === 'true';
    const navFocusables = () => [
      navToggle,
      ...$$('a[href], button', navPanel),
    ].filter((el) => el && !el.hasAttribute('disabled'));

    const setNav = (open, returnFocus = false) => {
      navToggle.setAttribute('aria-expanded', String(open));
      navLabel.textContent = open ? '关闭导航菜单' : '打开导航菜单';
      navPanel.hidden = !open;
      navBackdrop.hidden = !open;
      document.body.classList.toggle('nav-open', open);
      if (open) {
        window.requestAnimationFrame(() => {
          const first = $('a[href]', navPanel);
          if (first) first.focus({ preventScroll: true });
        });
      } else if (returnFocus) {
        navToggle.focus();
      }
    };

    navToggle.addEventListener('click', () => setNav(!navOpen()));

    navBackdrop.addEventListener('click', () => setNav(false, true));

    navPanel.addEventListener('click', (event) => {
      if (event.target.closest('a')) setNav(false, true);
    });

    document.addEventListener('keydown', (event) => {
      if (!navOpen()) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setNav(false, true);
        return;
      }

      if (event.key !== 'Tab') return;
      const items = navFocusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && navOpen()) {
        const insidePanel = navPanel.contains(document.activeElement);
        setNav(false, insidePanel);
      }
    });

    if (window.innerWidth > 900 && navOpen()) setNav(false);
  }

  /* Section titles: split into masked characters ------------------------- */

  const splitTitles = $$('[data-split]');

  const splitTitle = (element) => {
    if (element.dataset.splitDone === 'true') return;
    const text = element.textContent.replace(/\s+/g, ' ').trim();
    if (!text) return;

    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = text;

    const wrapper = document.createElement('span');
    wrapper.className = 'split';
    wrapper.setAttribute('aria-hidden', 'true');

    // 以中文标点为断点分组，避免标题在词中间被拆开。
    const phrases = [];
    let phrase = '';
    Array.from(text).forEach((character) => {
      phrase += character;
      if ('，。！？；：、'.includes(character)) {
        phrases.push(phrase);
        phrase = '';
      }
    });
    if (phrase) phrases.push(phrase);

    let index = 0;
    phrases.forEach((chunk) => {
      const line = document.createElement('span');
      line.className = 'split-line';
      Array.from(chunk).forEach((character) => {
        if (/\s/.test(character)) {
          line.appendChild(document.createTextNode(' '));
          return;
        }
        const outer = document.createElement('span');
        outer.className = 'char';
        const inner = document.createElement('span');
        inner.className = 'char__in';
        inner.textContent = character;
        inner.style.setProperty('--i', String(index));
        index += 1;
        outer.appendChild(inner);
        line.appendChild(outer);
      });
      wrapper.appendChild(line);
    });

    element.textContent = '';
    element.append(label, wrapper);
    element.classList.add('split-ready');
    element.dataset.splitDone = 'true';
  };

  splitTitles.forEach(splitTitle);

  /* Count-up -------------------------------------------------------------- */

  const animateCount = (element) => {
    if (element.dataset.counted === 'true') return;
    const target = Number.parseInt(element.dataset.count, 10);
    if (!Number.isFinite(target)) return;
    const pad = Number.parseInt(element.dataset.pad || '0', 10);
    element.dataset.counted = 'true';

    if (!canAnimate()) {
      element.textContent = String(target).padStart(pad, '0');
      return;
    }

    const duration = 920;
    const started = performance.now();

    const frame = (now) => {
      const t = clamp((now - started) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(target * eased);
      element.textContent = String(value).padStart(pad, '0');
      if (t < 1) window.requestAnimationFrame(frame);
    };

    window.requestAnimationFrame(frame);
  };

  const countAll = (scope) => {
    $$('[data-count]', scope).forEach(animateCount);
  };

  /* Reveals --------------------------------------------------------------- */

  const revealTargets = $$('[data-reveal]');
  const hasObserver = 'IntersectionObserver' in window;

  if (!hasObserver || !canAnimate()) {
    revealTargets.forEach((el) => {
      el.classList.add('is-visible');
      countAll(el);
    });
    splitTitles.forEach((el) => el.classList.add('is-visible'));
  } else {
    revealTargets.forEach((el) => el.classList.add('reveal-ready'));

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        countAll(entry.target);
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });

    revealTargets.forEach((el) => revealObserver.observe(el));

    const titleObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        titleObserver.unobserve(entry.target);
      });
    }, { threshold: 0.35, rootMargin: '0px 0px -4% 0px' });

    splitTitles.forEach((el) => titleObserver.observe(el));
  }

  /* Screenshot reveal + scroll parallax ----------------------------------- */

  const shots = $$('[data-shot]');

  if (shots.length) {
    if (!hasObserver || !canAnimate()) {
      shots.forEach((shot) => shot.classList.add('is-inview'));
    } else {
      const shotObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-inview');
          shotObserver.unobserve(entry.target);
        });
      }, { threshold: 0.18 });

      shots.forEach((shot) => shotObserver.observe(shot));
    }
  }

  const updateShots = () => {
    if (!canAnimate() || window.innerWidth <= 900) {
      shots.forEach((shot) => shot.style.setProperty('--shot-y', '0px'));
      return;
    }
    const center = window.innerHeight / 2;
    shots.forEach((shot) => {
      const rect = shot.getBoundingClientRect();
      const distance = rect.top + rect.height / 2 - center;
      const offset = clamp(distance * -0.018, -9, 9);
      shot.style.setProperty('--shot-y', `${offset.toFixed(2)}px`);
    });
  };

  /* Terminal line reveal --------------------------------------------------- */

  const terminal = $('[data-terminal]');

  if (terminal) {
    if (!hasObserver || !canAnimate()) {
      terminal.classList.add('is-lit');
    } else {
      terminal.classList.add('is-armed');
      const terminalObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-lit');
          terminalObserver.unobserve(entry.target);
        });
      }, { threshold: 0.35 });
      terminalObserver.observe(terminal);
    }
  }

  /* FAQ: one open at a time, animated rows -------------------------------- */

  const faqList = $('.faq__list');
  const faqItems = $$('.faq__item');

  if (faqList && faqItems.length) {
    faqList.classList.add('is-enhanced');

    const closeFaq = (item, immediate = false) => {
      item.classList.remove('is-open');
      const finish = () => {
        if (!item.classList.contains('is-open')) item.open = false;
      };
      if (immediate || reduced.matches) finish();
      else window.setTimeout(finish, 380);
    };

    const openFaq = (item) => {
      faqItems.forEach((other) => {
        if (other !== item && other.classList.contains('is-open')) closeFaq(other, true);
      });
      item.open = true;
      void item.offsetHeight;
      item.classList.add('is-open');
    };

    faqItems.forEach((item) => {
      const summary = $('summary', item);
      if (!summary) return;
      summary.addEventListener('click', (event) => {
        event.preventDefault();
        if (item.classList.contains('is-open')) closeFaq(item);
        else openFaq(item);
      });
    });
  }

  /* The loop: sticky scrollytelling + tabs --------------------------------- */

  const loop = $('[data-loop]');
  const loopSteps = $$('[data-loop-step]');
  const loopScenes = $$('[data-loop-scene]');
  const loopProgress = $('[data-loop-progress]');
  const loopTabs = $('.loop__tabs');
  let loopIndex = 0;
  let loopLockUntil = 0;

  const setLoopIndex = (index) => {
    const next = clamp(index, 0, loopSteps.length - 1);
    loopIndex = next;

    loopSteps.forEach((step, i) => {
      const active = i === next;
      step.setAttribute('aria-selected', String(active));
      step.tabIndex = active ? 0 : -1;
    });

    loopScenes.forEach((scene, i) => {
      const active = i === next;
      scene.classList.toggle('is-active', active);
      scene.setAttribute('aria-hidden', String(!active));
    });

    if (loopProgress) loopProgress.style.width = `${((next + 1) / loopSteps.length) * 100}%`;
  };

  const loopScrollTarget = (index) => {
    if (!loop) return null;
    const start = loop.getBoundingClientRect().top + window.scrollY;
    const total = loop.offsetHeight - window.innerHeight;
    if (total <= 0) return null;
    const ratio = clamp((index + 0.5) / loopSteps.length, 0, 1);
    return start + total * ratio;
  };

  const activateLoop = (index, withScroll) => {
    setLoopIndex(index);
    if (!withScroll || mobileLoop.matches || !canAnimate()) return;
    const target = loopScrollTarget(index);
    if (target === null) return;
    loopLockUntil = performance.now() + 1100;
    window.scrollTo({ top: target, behavior: 'smooth' });
  };

  if (loop && loopSteps.length && loopScenes.length) {
    setLoopIndex(0);

    loopSteps.forEach((step) => {
      step.addEventListener('click', () => {
        activateLoop(Number.parseInt(step.dataset.loopStep, 10) || 0, true);
      });
    });

    if (loopTabs) {
      loopTabs.addEventListener('keydown', (event) => {
        const current = loopSteps.indexOf(document.activeElement);
        if (current < 0) return;

        let next = current;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % loopSteps.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current - 1 + loopSteps.length) % loopSteps.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = loopSteps.length - 1;
        else return;

        event.preventDefault();
        const target = loopSteps[next];
        if (!target) return;
        target.focus();
        activateLoop(next, true);
      });
    }
  }

  const updateLoopFromScroll = () => {
    if (!loop || !loopSteps.length) return;
    if (mobileLoop.matches || !canAnimate()) return;
    if (performance.now() < loopLockUntil) return;

    const start = loop.getBoundingClientRect().top + window.scrollY;
    const total = loop.offsetHeight - window.innerHeight;
    if (total <= 0) return;

    const ratio = clamp((window.scrollY - start) / total, 0, 1);
    const next = Math.min(loopSteps.length - 1, Math.floor(ratio * loopSteps.length));
    if (next !== loopIndex) setLoopIndex(next);
  };

  /* Scroll ticker ---------------------------------------------------------- */

  let scrollFrame = 0;

  const runScroll = () => {
    scrollFrame = 0;
    setHeaderState();
    setProgress();
    setSpy();
    updateLoopFromScroll();
    updateShots();

    const heroTilt = $('[data-hero-tilt]');
    if (heroTilt && canAnimate() && window.innerWidth > 900) {
      const offset = Math.min(window.scrollY * 0.045, 22);
      heroTilt.style.setProperty('--hero-y', `${offset.toFixed(2)}px`);
    }
  };

  const requestScroll = () => {
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(runScroll);
  };

  window.addEventListener('scroll', requestScroll, { passive: true });
  window.addEventListener('resize', requestScroll);
  window.addEventListener('load', requestScroll);
  runScroll();

  /* Pointer: hero tilt, surface glow, magnetic buttons -------------------- */

  const heroVisual = $('[data-hero-visual]');
  const heroTilt = $('[data-hero-tilt]');
  const surfaces = $$('[data-surface]');
  const magnets = $$('.btn--primary');

  const pointerState = {
    frame: 0,
    tiltX: 0,
    tiltY: 0,
    targetX: 0,
    targetY: 0,
    tiltActive: false,
  };

  const surfaceStates = surfaces.map((el) => ({
    el,
    x: 50,
    y: 50,
    targetX: 50,
    targetY: 50,
    active: false,
  }));

  const magnetStates = magnets.map((el) => ({
    el,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    active: false,
  }));

  const pointerOK = () => finePointer.matches && canAnimate();

  const tickPointer = () => {
    pointerState.frame = 0;
    let moving = false;

    if (heroTilt && pointerState.tiltActive && pointerOK()) {
      pointerState.tiltX += (pointerState.targetX - pointerState.tiltX) * 0.12;
      pointerState.tiltY += (pointerState.targetY - pointerState.tiltY) * 0.12;
      heroTilt.style.setProperty('--rx', `${pointerState.tiltX.toFixed(2)}deg`);
      heroTilt.style.setProperty('--ry', `${pointerState.tiltY.toFixed(2)}deg`);
      if (Math.abs(pointerState.targetX - pointerState.tiltX) > 0.02 || Math.abs(pointerState.targetY - pointerState.tiltY) > 0.02) moving = true;
    }

    surfaceStates.forEach((state) => {
      if (!state.active) return;
      state.x += (state.targetX - state.x) * 0.16;
      state.y += (state.targetY - state.y) * 0.16;
      state.el.style.setProperty('--mx', `${state.x.toFixed(2)}%`);
      state.el.style.setProperty('--my', `${state.y.toFixed(2)}%`);
      if (Math.abs(state.targetX - state.x) > 0.08 || Math.abs(state.targetY - state.y) > 0.08) moving = true;
    });

    magnetStates.forEach((state) => {
      if (!state.active && Math.abs(state.x) < 0.03 && Math.abs(state.y) < 0.03) return;
      state.x += (state.targetX - state.x) * 0.22;
      state.y += (state.targetY - state.y) * 0.22;
      state.el.style.setProperty('--mag-x', `${state.x.toFixed(2)}px`);
      state.el.style.setProperty('--mag-y', `${state.y.toFixed(2)}px`);
      if (Math.abs(state.targetX - state.x) > 0.03 || Math.abs(state.targetY - state.y) > 0.03) moving = true;
    });

    if (moving) pointerState.frame = window.requestAnimationFrame(tickPointer);
  };

  const requestPointer = () => {
    if (!pointerState.frame) pointerState.frame = window.requestAnimationFrame(tickPointer);
  };

  if (heroVisual && heroTilt) {
    heroVisual.addEventListener('pointermove', (event) => {
      if (!pointerOK() || window.innerWidth <= 900) return;
      const rect = heroVisual.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      pointerState.targetX = clamp(-ny * 6, -6, 6);
      pointerState.targetY = clamp(nx * 6, -6, 6);
      pointerState.tiltActive = true;
      requestPointer();
    }, { passive: true });

    heroVisual.addEventListener('pointerleave', () => {
      pointerState.targetX = 0;
      pointerState.targetY = 0;
      pointerState.tiltActive = true;
      requestPointer();
    });
  }

  surfaceStates.forEach((state) => {
    state.el.addEventListener('pointermove', (event) => {
      if (!pointerOK()) return;
      const rect = state.el.getBoundingClientRect();
      state.targetX = ((event.clientX - rect.left) / rect.width) * 100;
      state.targetY = ((event.clientY - rect.top) / rect.height) * 100;
      state.active = true;
      requestPointer();
    }, { passive: true });

    state.el.addEventListener('pointerleave', () => {
      state.active = false;
    });
  });

  magnetStates.forEach((state) => {
    state.el.addEventListener('pointermove', (event) => {
      if (!pointerOK()) return;
      const rect = state.el.getBoundingClientRect();
      state.targetX = clamp((event.clientX - rect.left - rect.width / 2) * 0.12, -6, 6);
      state.targetY = clamp((event.clientY - rect.top - rect.height / 2) * 0.16, -6, 6);
      state.active = true;
      requestPointer();
    }, { passive: true });

    state.el.addEventListener('pointerleave', () => {
      state.targetX = 0;
      state.targetY = 0;
      state.active = false;
      requestPointer();
    });
  });

  /* Keep reduced-motion sessions static without hiding content ------------ */

  const settleMotion = () => {
    if (!reduced.matches) return;
    revealTargets.forEach((el) => el.classList.add('is-visible'));
    splitTitles.forEach((el) => el.classList.add('is-visible'));
    shots.forEach((shot) => shot.classList.add('is-inview'));
    if (terminal) terminal.classList.add('is-lit');
    heroTilt?.style.removeProperty('--rx');
    heroTilt?.style.removeProperty('--ry');
    heroTilt?.style.setProperty('--hero-y', '0px');
    shots.forEach((shot) => shot.style.setProperty('--shot-y', '0px'));
  };

  if (typeof reduced.addEventListener === 'function') {
    reduced.addEventListener('change', settleMotion);
  }
  settleMotion();
})();
