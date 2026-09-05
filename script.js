document.addEventListener('DOMContentLoaded', () => {

  // ==========================================
  // 1. REUSABLE UTILITIES & DIMENSION CACHING
  // ==========================================
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const navbar = document.getElementById('main-navbar');
  const heroSection = document.getElementById('hero');
  const menuToggle = document.querySelector('.mobile-menu-toggle');
  const menuClose = document.querySelector('.nav-menu-close');
  const navMenu = document.querySelector('.nav-menu');
  const navLinks = document.querySelectorAll('.nav-link, .nav-cta-btn');
  const backToTopBtn = document.getElementById('back-to-top');
  const bgGlows = document.querySelectorAll('.parallax-bg-glow');

  let cachedHeroHeight = heroSection ? heroSection.offsetHeight : 0;
  let cachedNavbarHeight = navbar ? navbar.offsetHeight : 0;

  const recalcDimensions = () => {
    if (heroSection) cachedHeroHeight = heroSection.offsetHeight;
    if (navbar) cachedNavbarHeight = navbar.offsetHeight;

    // Refresh ScrollTriggers globally to recalculate active trigger offsets on layout resize / orientation shift
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.refresh();
    }
  };

  window.addEventListener('resize', debounce(() => {
    recalcDimensions();
    handleScrollState();
  }, 150));

  // ==========================================
  // 2. NAV COHESION, ACTIVE SCROLL SPY, & BACK-TO-TOP
  // ==========================================
  let isScrolledState = false;

  const handleScrollState = () => {
    // Sanitized coordinate to ignore negative values caused by iOS elastic scroll bouncing
    const scrollY = Math.max(0, window.pageYOffset || window.scrollY);
    const threshold = cachedHeroHeight - cachedNavbarHeight;
    const isPastHero = scrollY >= threshold;

    const isMobileMenuOpen = navMenu && navMenu.classList.contains('active');

    // Default Phase 1 Glass vs Phase 2 Scrolled Solid State Swapper
    if (isPastHero || isMobileMenuOpen) {
      if (!isScrolledState) {
        navbar.classList.add('nav-scrolled-state');
        isScrolledState = true;
      }
    } else {
      if (isScrolledState) {
        navbar.classList.remove('nav-scrolled-state');
        isScrolledState = false;
      }
    }

    // Dynamic visibility check: tells the button when to appear and vanish
    if (backToTopBtn) {
      if (scrollY >= threshold) {
        backToTopBtn.style.display = 'flex';
      } else {
        backToTopBtn.style.display = 'none';
      }
    }
  };

  window.addEventListener('scroll', () => {
    handleScrollState();

    // Slow Moving Background Accents
    const scrollY = Math.max(0, window.pageYOffset || window.scrollY);
    bgGlows.forEach(glow => {
      const speed = parseFloat(glow.getAttribute('data-speed')) || 0.1;
      const transformValue = scrollY * speed;
      glow.style.transform = `translate3d(0, ${transformValue}px, 0)`;
    });
  });

  // Standard non-conflicting action listeners (Registered once on load)
  if (backToTopBtn) {
    const scrollToTop = (e) => {
      e.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: 'smooth' // Smoothly scrolls to the top of the viewport
      });
    };

    // Standard click listener for PC
    backToTopBtn.addEventListener('click', scrollToTop);

    // Low-latency touch listener for mobile screens
    backToTopBtn.addEventListener('touchstart', scrollToTop, { passive: false });
  }

  // Smooth scroll on Navbar Logo click (Prevents browser refresh events on both PC & mobile touchscreens)
  const logoLink = document.querySelector('.nav-logo-link');
  if (logoLink) {
    const handleLogoScroll = (e) => {
      e.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: 'smooth' // Triggers fluid vertical scroll to top of viewport
      });
    };

    logoLink.addEventListener('click', handleLogoScroll);
    logoLink.addEventListener('touchstart', handleLogoScroll, { passive: false });
  }

  // Active Scroll Spy Section Underlining Logic
  const sections = document.querySelectorAll('section[id], header[id]');
  const navObserverOptions = {
    root: null,
    threshold: 0.15, // Highlight when at least 15% of section crosses bounds
    rootMargin: '-80px 0px -50% 0px' // Compensate for navbar height bounds
  };

  const navObserver = new IntersectionObserver((entries) => {
    // Don't update spy highlights if we are locked in mobile loading state
    if (document.body.classList.contains('body-loading') && window.scrollY === 0) return;

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach(link => {
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  }, navObserverOptions);

  sections.forEach(section => navObserver.observe(section));

  // No-Happy-Path Protection: Force Top & Bottom spy clamp fallbacks
  window.addEventListener('scroll', () => {
    const scrollY = Math.max(0, window.pageYOffset || window.scrollY);
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

    if (scrollY === 0) {
      // Force highlight Home at the absolute top
      navLinks.forEach(link => {
        if (link.getAttribute('href') === '#hero') link.classList.add('active');
        else link.classList.remove('active');
      });
    } else if (scrollY >= maxScroll - 10) {
      // Force highlight Services at the absolute bottom
      navLinks.forEach(link => {
        if (link.getAttribute('href') === '#services') link.classList.add('active');
        else link.classList.remove('active');
      });
    }
  });

  // ==========================================
  // 3. MOBILE MENU SCROLL LOCK & DRAWER TRIGGER
  // ==========================================
  const toggleMenu = () => {
    const isActive = navMenu.classList.toggle('active');
    menuToggle.classList.toggle('active');
    navbar.classList.toggle('menu-active-state'); // Add/remove dark-text override class for logo contrast on white drawer background

    if (isActive) {
      document.body.classList.add('body-loading'); // Lock body scroll on mobile active state
      navbar.classList.add('nav-scrolled-state'); // Lock navbar to solid state for visual contrast in mobile menu overlay
    } else {
      document.body.classList.remove('body-loading');
      isScrolledState = !isScrolledState; // Force state updates
      handleScrollState();
    }
  };

  if (menuToggle) {
    menuToggle.addEventListener('click', toggleMenu);
  }

  if (menuClose) {
    menuClose.addEventListener('click', toggleMenu);
  }

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (navMenu.classList.contains('active')) {
        toggleMenu();
      }
    });
  });

  // Reset mobile drawer constraints on large viewport expansion
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && navMenu.classList.contains('active')) {
      menuToggle.classList.remove('active');
      menuClose.classList.remove('active');
      navMenu.classList.remove('active');
      navbar.classList.remove('menu-active-state');
      document.body.classList.remove('body-loading');
      handleScrollState();
    }
  });

  // ==========================================
  // 4. AUTOPLAY HORIZONTAL SLIDER WITH SWIPING
  // ==========================================
  const slider = document.getElementById('auto-slider');
  const track = slider ? slider.querySelector('.slider-track') : null;

  if (slider && track) {
    const originalSlides = Array.from(track.children);
    originalSlides.forEach(slide => {
      const clone = slide.cloneNode(true);
      track.appendChild(clone);
    });

    let scrollSpeed = 1;
    let scrollPosition = 0;
    let isHovered = false;
    let isDragging = false;
    let startX, dragX;

    const animateSlider = () => {
      if (!isHovered && !isDragging) {
        scrollPosition -= scrollSpeed;
        const halfWidth = track.scrollWidth / 2;
        if (Math.abs(scrollPosition) >= halfWidth) {
          scrollPosition = 0;
        }
        track.style.transform = `translate3d(${scrollPosition}px, 0, 0)`;
      }
      requestAnimationFrame(animateSlider);
    };

    slider.addEventListener('mouseenter', () => { isHovered = true; });
    slider.addEventListener('mouseleave', () => { isHovered = false; });

    const startDrag = (e) => {
      isDragging = true;
      startX = (e.touches ? e.touches[0].clientX : e.clientX) - scrollPosition;
    };

    const moveDrag = (e) => {
      if (!isDragging) return;
      dragX = e.touches ? e.touches[0].clientX : e.clientX;
      scrollPosition = dragX - startX;

      const halfWidth = track.scrollWidth / 2;
      if (scrollPosition > 0) scrollPosition = -halfWidth;
      if (Math.abs(scrollPosition) >= halfWidth) scrollPosition = 0;
      track.style.transform = `translate3d(${scrollPosition}px, 0, 0)`;
    };

    const endDrag = () => { isDragging = false; };

    slider.addEventListener('mousedown', startDrag);
    slider.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);

    slider.addEventListener('touchstart', startDrag, { passive: true });
    slider.addEventListener('touchmove', moveDrag, { passive: true });
    window.addEventListener('touchend', endDrag);

    animateSlider();
  }

  // ==========================================
  // 5. POINTER-SAFE 3D TILT EFFECT
  // ==========================================
  const tiltCards = document.querySelectorAll('.tilt-card');
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  if (!isTouchDevice) {
    tiltCards.forEach(card => {
      card.addEventListener('mousemove', (e) => {
        if (e.pointerType === 'touch') return;
        const cardRect = card.getBoundingClientRect();
        const cardWidth = cardRect.width;
        const cardHeight = cardRect.height;

        const mouseX = e.clientX - cardRect.left - cardWidth / 2;
        const mouseY = e.clientY - cardRect.top - cardHeight / 2;

        const rotateX = -(mouseY / (cardHeight / 2)) * 12;
        const rotateY = (mouseX / (cardWidth / 2)) * 12;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      });
    });
  }

  // ==========================================
  // 6. GSAP SCROLLMOTION & DYNAMIC INTERACTION
  // ==========================================
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    const isMobile = window.innerWidth <= 768;

    // A. Desktop Extra-Ordinary Parallax Sequences
    if (!isMobile) {
      // Camera Defocus & Zoom Parallax
      gsap.to('.hero-content', {
        scrollTrigger: {
          trigger: '#hero',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        },
        y: 100,
        scale: 1.05,
        opacity: 0,
        filter: 'blur(12px)',
        ease: 'none'
      });

      gsap.to('.hero-video', {
        scrollTrigger: {
          trigger: '#hero',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        },
        scale: 0.95,
        ease: 'none'
      });

      // Theater Curtain Unfold Effect
      gsap.fromTo('#curtain-wrapper', {
        rotateX: -8,
        transformPerspective: 1000,
        borderRadius: '40px 40px 0px 0px'
      }, {
        scrollTrigger: {
          trigger: '#curtain-wrapper',
          start: 'top bottom',
          end: 'top top',
          scrub: true
        },
        rotateX: 0,
        borderRadius: '0px 0px 0px 0px',
        ease: 'none'
      });

      // Opposite Direction Horizontal Scrub Text Parallax
      gsap.to('#scrub-text-left', {
        scrollTrigger: {
          trigger: '.services-grid-section',
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1
        },
        xPercent: -30,
        ease: 'none'
      });

      gsap.to('#scrub-text-right', {
        scrollTrigger: {
          trigger: '.services-grid-section',
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1
        },
        xPercent: 30,
        ease: 'none'
      });

      // Scroll Velocity-Based Card Skewing (Optimized to prevent multi-selector rendering collisions)
      let clamp = gsap.utils.clamp(-5, 5); // Max skew of 5 degrees

      ScrollTrigger.create({
        onUpdate: (self) => {
          let skew = clamp(self.getVelocity() / -300);
          gsap.to('.service-card, .slide-card', {
            skewY: skew,
            duration: 0.5,
            ease: 'power3.out',
            overwrite: 'auto'
          });
        }
      });
    }

    // B. Staggered 3D entrance on services cards
    gsap.from('.services-grid .service-card', {
      scrollTrigger: {
        trigger: '.services-grid',
        start: 'top 85%',
        once: true
      },
      opacity: 0,
      y: 50,
      rotationY: 15,
      rotationZ: -3,
      scale: 0.9,
      stagger: 0.08,
      duration: 1.2,
      ease: 'power4.out',
      clearProps: 'transform,opacity,rotationY,rotationZ,scale'
    });

    // C. Rolling Statistics Counters (Safe Virtual Object Tweening - Solves DOM NaN% string error)
    let percentObj = { val: 0 };

    gsap.to(percentObj, {
      scrollTrigger: {
        trigger: '#stat-card-percent',
        start: 'top 90%'
      },
      val: 100,
      duration: 2,
      ease: 'power2.out',
      onUpdate: function () {
        const countPercent = document.getElementById('stat-count-percent');
        if (countPercent) {
          countPercent.innerHTML = Math.ceil(percentObj.val) + '%';
        }
      }
    });

    gsap.from('#stat-text-location', {
      scrollTrigger: {
        trigger: '#stat-card-location',
        start: 'top 90%'
      },
      opacity: 0,
      y: 20,
      duration: 1.2,
      ease: 'power3.out'
    });

    // D. Magnetic attractor on Desktop cursor coordinates
    if (!isMobile && !isTouchDevice) {
      const magnetics = document.querySelectorAll('.primary-cta-btn, .nav-cta-btn');
      magnetics.forEach(btn => {
        document.addEventListener('mousemove', (e) => {
          const rect = btn.getBoundingClientRect();
          const x = e.clientX - (rect.left + rect.width / 2);
          const y = e.clientY - (rect.top + rect.height / 2);
          const distance = Math.sqrt(x * x + y * y);

          if (distance < 60) {
            gsap.to(btn, {
              x: x * 0.35,
              y: y * 0.35,
              duration: 0.3,
              ease: 'power2.out'
            });
          } else {
            gsap.to(btn, {
              x: 0,
              y: 0,
              duration: 0.5,
              ease: 'power2.out'
            });
          }
        });
      });
    }
  }

  // ==========================================
  // 6.5. SCROLL FADE-IN (INTERSECTION OBSERVER)
  // ==========================================
  const scrollElements = document.querySelectorAll('.scroll-animate');

  const scrollObserverOptions = {
    root: null,
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
  };

  const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // If the section is on the screen, make it visible!
      if (entry.isIntersecting) {
        entry.target.classList.add('scrolled-in');
      } else {
        // If we scroll back to the very top, reset it so it can fade in again
        if (entry.boundingClientRect.top > 0) {
          entry.target.classList.remove('scrolled-in');
        }
      }
    });
  }, scrollObserverOptions);

  // Tell the observer to watch every single animate-tagged section
  scrollElements.forEach(el => {
    scrollObserver.observe(el);
  });

  // ==========================================
  // 7. LOADING SCREEN DISMISSAL (COHESIVE SYNC)
  // ==========================================
  const hideLoader = () => {
    const loader = document.getElementById('loading-screen');
    if (loader && loader.style.display !== 'none') {
      loader.style.opacity = '0';
      loader.style.visibility = 'hidden';
      setTimeout(() => {
        loader.style.display = 'none';
        document.body.classList.remove('body-loading');

        // Dynamic staggered Hero Content reveal sequence
        if (typeof gsap !== 'undefined') {
          gsap.fromTo('.hero-content > *', {
            opacity: 0,
            y: 15
          }, {
            opacity: 1,
            y: 0,
            stagger: 0.15,
            duration: 1.2,
            ease: 'power4.out'
          });
        }
      }, 500);
    }
  };

  // Safe release on onload or emergency fallback timeout of 1.5s
  window.addEventListener('load', hideLoader);
  setTimeout(hideLoader, 1500);

  // Initialize bounds and navbar positions instantly
  recalcDimensions();
  handleScrollState();
});