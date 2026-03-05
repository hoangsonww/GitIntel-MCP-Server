/* ============================================================
   GitIntel Wiki — Scripts
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Sidebar toggle (mobile) ---------- */
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('.sidebar-toggle');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        sidebar.classList.remove('open');
      }
    });
  }

  /* ---------- Active nav highlight on scroll ---------- */
  const navLinks = document.querySelectorAll('.sidebar nav a[href^="#"]');
  const sections = document.querySelectorAll('section[id]');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinks.forEach((link) => link.classList.remove('active'));
          const active = document.querySelector(`.sidebar nav a[href="#${entry.target.id}"]`);
          if (active) active.classList.add('active');
        }
      });
    },
    { rootMargin: '-20% 0px -60% 0px' },
  );
  sections.forEach((s) => observer.observe(s));

  /* ---------- Scroll-to-top button ---------- */
  const scrollBtn = document.querySelector('.scroll-top');
  if (scrollBtn) {
    window.addEventListener('scroll', () => {
      scrollBtn.classList.toggle('visible', window.scrollY > 400);
    });
    scrollBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Stagger animation on scroll ---------- */
  const staggerEls = document.querySelectorAll('.stagger');
  const staggerObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          staggerObs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  staggerEls.forEach((el) => staggerObs.observe(el));

  /* ---------- Tabs ---------- */
  document.querySelectorAll('.tabs').forEach((tabBar) => {
    const container = tabBar.parentElement;
    tabBar.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        container.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        const target = container.querySelector(`#${btn.dataset.tab}`);
        if (target) target.classList.add('active');
      });
    });
  });

  /* ---------- Mermaid init ---------- */
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#1c2129',
        primaryColor: '#58a6ff',
        primaryTextColor: '#e6edf3',
        primaryBorderColor: '#30363d',
        lineColor: '#58a6ff',
        secondaryColor: '#3fb950',
        tertiaryColor: '#d2a8ff',
        fontFamily: 'Inter, -apple-system, sans-serif',
        fontSize: '14px',
      },
      flowchart: { curve: 'basis', useMaxWidth: true },
      sequence: { useMaxWidth: true },
    });
  }
});
