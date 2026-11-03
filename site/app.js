(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Header ----------------------------------------------------------------- */
  const header = $('[data-masthead]');
  const syncHeader = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  /* Mobile navigation ------------------------------------------------------ */
  const navToggle = $('[data-nav-toggle]');
  const navPanel = $('#mobile-nav');
  const navScrim = $('[data-nav-scrim]');
  const navLabel = $('[data-nav-label]');

  if (navToggle && navPanel && navScrim && navLabel) {
    let lastFocus = null;

    const setNav = (open) => {
      navToggle.setAttribute('aria-expanded', String(open));
      navLabel.textContent = open ? '关闭菜单' : '打开菜单';
      navPanel.hidden = !open;
      navScrim.hidden = !open;
      document.body.classList.toggle('nav-open', open);

      if (open) {
        lastFocus = document.activeElement;
        const first = $('a, button', navPanel);
        if (first) window.requestAnimationFrame(() => first.focus());
      } else {
        const focusTarget = lastFocus instanceof HTMLElement ? lastFocus : navToggle;
        if (focusTarget === navToggle || navPanel.contains(focusTarget)) navToggle.focus();
      }
    };

    const isOpen = () => navToggle.getAttribute('aria-expanded') === 'true';

    navToggle.addEventListener('click', () => setNav(!isOpen()));
    navScrim.addEventListener('click', () => setNav(false));
    navPanel.addEventListener('click', (event) => {
      if (event.target.closest('a')) setNav(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        setNav(false);
        navToggle.focus();
      }
    });

    navPanel.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const items = $$('a, button', navPanel).filter((el) => !el.hasAttribute('disabled'));
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
      if (window.innerWidth > 1080 && isOpen()) setNav(false);
    });
  }

  /* Tabs ------------------------------------------------------------------- */
  const initTabs = (root) => {
    const tabs = $$('[role="tab"]', root);
    const panels = $$('[role="tabpanel"]', root);
    if (!tabs.length || !panels.length) return;

    let selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    if (selected < 0) selected = 0;

    const panelFor = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

    const show = (index) => {
      panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel === panelFor(tabs[index]));
      });
    };

    const select = (index, focus = false) => {
      selected = index;
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
        tab.classList.toggle('is-active', i === index);
      });
      show(index);
      if (focus) tabs[index].focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', (event) => {
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        select(next, true);
      });
    });

    // Desktop-only hover preview for the feature index: hovering a row
    // temporarily shows its panel. The selected tab and aria state stay put.
    if (root.classList.contains('system')) {
      const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
      if (canHover.matches) {
        tabs.forEach((tab, index) => {
          tab.addEventListener('pointerenter', () => {
            panels.forEach((panel) => panel.classList.toggle('is-active', panel === panelFor(tab)));
            root.classList.add('is-peeking');
          });
          tab.addEventListener('pointerleave', () => {
            root.classList.remove('is-peeking');
            show(selected);
          });
        });
      }
    }

    select(selected);
  };

  $$('[data-tabs]').forEach(initTabs);

  /* Disclosure groups ------------------------------------------------------ */
  const oneAtATime = (container, selector = 'details') => {
    if (!container) return;
    const items = $$(selector, container);
    items.forEach((item) => {
      item.addEventListener('toggle', () => {
        if (!item.open) return;
        items.forEach((other) => {
          if (other !== item && other.open) other.open = false;
        });
      });
    });
  };

  oneAtATime($('.faq-list'));
  oneAtATime($('.folder'));

  /* Chapter rail ----------------------------------------------------------- */
  const railLinks = $$('[data-chapter-link]');
  const chapters = $$('[data-chapter]');
  const setRail = (id) => {
    railLinks.forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('data-chapter-link') === id);
    });
  };

  if (railLinks.length && chapters.length) {
    let railFrame = 0;
    const syncRail = () => {
      railFrame = 0;
      const line = window.innerHeight * 0.36;
      let current = 'idea';
      chapters.forEach((chapter) => {
        if (chapter.getBoundingClientRect().top <= line) {
          current = chapter.getAttribute('data-chapter');
        }
      });
      setRail(current);
    };
    const queueRail = () => {
      if (!railFrame) railFrame = window.requestAnimationFrame(syncRail);
    };
    syncRail();
    window.addEventListener('scroll', queueRail, { passive: true });
  } else {
    setRail('idea');
  }

  /* Reveal ----------------------------------------------------------------- */
  const revealTargets = $$('[data-reveal]');
  if (reduced.matches || !('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => el.classList.add('is-in'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealTargets.forEach((el) => revealObserver.observe(el));
  }

  /* Hero plate parallax ---------------------------------------------------- */
  const parallax = $('[data-parallax]');
  if (parallax && !reduced.matches) {
    let frame = 0;
    const render = () => {
      frame = 0;
      const offset = Math.min(window.scrollY * 0.035, 18);
      parallax.style.setProperty('--py', `${offset.toFixed(2)}px`);
    };
    const queue = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    render();
    window.addEventListener('scroll', queue, { passive: true });
  }
})();
