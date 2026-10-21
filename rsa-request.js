/*
 * RSA service request: form + location popup + platform popup
 * File: rsa-request.js (NEW file, loaded with `defer` by the HTML snippet).
 * Vanilla JS, no dependencies, no analytics, no cookies, no localStorage.
 * Everything is wrapped in an IIFE and namespaced "rsa-request-" / "rsa_".
 *
 * DATA FLOW (privacy summary for the site owner):
 *  1. Location is requested ONLY after the visitor clicks "Share location".
 *  2. Browser geolocation returns coordinates. They are rounded to 2 decimals
 *     (~1 km) and sent to BigDataCloud's free client-side reverse-geocoding
 *     endpoint to obtain a place name. That provider necessarily receives the
 *     rounded coordinates and the visitor's IP address (as any web request does)
 *     and, per its own documentation, uses that pair for its IP-geolocation
 *     accuracy work. No API key or credential is used.
 *     IMPORTANT: always send coordinates to this endpoint. Calling it without
 *     coordinates makes the provider fall back to IP-based lookup, which this
 *     site must not do.
 *  3. Only the resolved place name is stored (sessionStorage). Raw coordinates
 *     are never stored.
 *  4. Form data leaves the browser only when the visitor picks WhatsApp or
 *     email and sends the message themselves.
 *  SITE OWNER TO VERIFY: whether your privacy notice should mention the
 *  geocoding provider and the platforms (WhatsApp / email) used for requests.
 *  sessionStorage is readable by any same-origin script and is not secure
 *  storage; this code makes no confidentiality or legal-compliance claims.
 */

(function () {
  'use strict';

  /* =====================================================================
   * CONFIGURATION
   * ===================================================================== */

  // Public business WhatsApp number, digits only with country code.
  // Source: footer link https://wa.me/8801313295051 on index.html.
  var RSA_WHATSAPP_NUMBER = '8801313295051';

  // No public business email address was found on the site or in index.html.
  // >>> SITE OWNER: enter the real business email here, e.g. 'name@yourdomain.com'.
  // Until then the Email option shows a friendly message instead of opening a draft.
  var RSA_BUSINESS_EMAIL = '';

  // Service names exactly as listed in the site footer ("Our Services").
  var RSA_SERVICES = [
    'Car Rental',
    'House Rental',
    'Van Rental',
    'Marketing Services',
    'Deep Cleaning',
    'House Interior',
    'AC Rental',
    'Pest Control',
    'Property Management'
  ];

  // Third-party reverse-geocoding endpoint (see data-flow notes above).
  var RSA_GEOCODE_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

  var KEYS = {
    location: 'rsa_location',
    status: 'rsa_location_status',
    request: 'rsa_service_request',
    popupHandled: 'rsa_location_popup_handled'
  };

  var LIMITS = { name: 80, location: 100 };
  var GEO_TIMEOUT_MS = 10000;      // browser geolocation timeout
  var GEO_GUARD_MS = 25000;        // overall guard (covers an unanswered permission prompt)
  var GEOCODE_TIMEOUT_MS = 8000;   // reverse-geocoding request timeout
  var VALID_STATUSES = ['resolved', 'declined', 'denied', 'unavailable', 'timeout', 'unresolved'];

  var HINTS = {
    base: 'Type your area or city. You can edit this at any time.',
    detected: 'Filled in from your device\u2019s location. Feel free to edit it.',
    denied: 'Location permission wasn\u2019t granted. Please type your location.',
    failed: 'We couldn\u2019t work out your location. Please type it in.',
    kept: 'We kept what you typed instead of the detected location.'
  };

  /* =====================================================================
   * SMALL HELPERS
   * ===================================================================== */

  function byId(id) {
    return document.getElementById(id);
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // Control characters, zero-width and bidi-override characters.
  var UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

  function cleanText(value, maxLen) {
    if (typeof value !== 'string') return '';
    var s = value.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > maxLen) {
      s = s.slice(0, maxLen).replace(/[\uD800-\uDBFF]$/, '').trim();
    }
    return s;
  }

  function sanitizeServices(list) {
    if (!Array.isArray(list)) return [];
    // Keep only known service names, de-duplicated, in the website's own order.
    return RSA_SERVICES.filter(function (name) {
      return list.indexOf(name) !== -1;
    });
  }

  /* =====================================================================
   * SESSION STORAGE (with in-memory fallback when unavailable)
   * ===================================================================== */

  var memoryStore = {};
  var sessionStore = (function () {
    try {
      var s = window.sessionStorage;
      var probe = 'rsa_request_probe';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (e) {
      return null;
    }
  })();

  function storeGet(key) {
    try {
      if (sessionStore) {
        var v = sessionStore.getItem(key);
        return typeof v === 'string' ? v : null;
      }
    } catch (e) { /* fall through to memory */ }
    return has(memoryStore, key) ? memoryStore[key] : null;
  }

  function storeSet(key, value) {
    try {
      if (sessionStore) {
        sessionStore.setItem(key, value);
        return;
      }
    } catch (e) { /* quota/security error: keep in memory for this page view */ }
    memoryStore[key] = value;
  }

  function storeRemove(key) {
    try {
      if (sessionStore) sessionStore.removeItem(key);
    } catch (e) { /* ignore */ }
    delete memoryStore[key];
  }

  /* =====================================================================
   * VALIDATION
   * ===================================================================== */

  var HAS_LETTER_OR_DIGIT = /[A-Za-z0-9\u00C0-\uFFFF]/;

  function validateText(raw, maxLen, emptyMsg, shortMsg) {
    var value = cleanText(raw, maxLen);
    if (!value) return { ok: false, value: '', msg: emptyMsg };
    if (value.length < 2 || !HAS_LETTER_OR_DIGIT.test(value)) {
      return { ok: false, value: value, msg: shortMsg };
    }
    return { ok: true, value: value, msg: '' };
  }

  function buildMessage(data) {
    return 'Service Request\n\n' +
      'Name: ' + data.name + '\n\n' +
      'Location: ' + data.location + '\n\n' +
      'Preferred Services: ' + data.services.join(', ');
  }

  // Only ever builds https://wa.me/<digits>?text=<encoded>
  function buildWhatsAppUrl(message) {
    try {
      if (!/^[1-9]\d{7,14}$/.test(RSA_WHATSAPP_NUMBER)) return '';
      var url = 'https://wa.me/' + RSA_WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
      var parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'wa.me') return '';
      return url;
    } catch (e) {
      return '';
    }
  }

  // Only ever builds mailto:<validated address>?subject=...&body=...
  function buildMailtoUrl(message) {
    try {
      var address = typeof RSA_BUSINESS_EMAIL === 'string' ? RSA_BUSINESS_EMAIL.trim() : '';
      if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(address)) return '';
      var body = message.replace(/\n/g, '\r\n'); // RFC 6068 line breaks
      return 'mailto:' + address +
        '?subject=' + encodeURIComponent('Service Request') +
        '&body=' + encodeURIComponent(body);
    } catch (e) {
      return '';
    }
  }

  function openExternal(url, newTab) {
    var a = document.createElement('a');
    a.href = url;
    if (newTab) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* =====================================================================
   * REVERSE GEOCODING (third party, see header comment)
   * ===================================================================== */

  function buildLocality(d) {
    if (!d || typeof d !== 'object') return '';
    var primary = cleanText(d.city, 60) || cleanText(d.locality, 60);
    var region = cleanText(d.principalSubdivision, 60);
    var country = cleanText(d.countryName, 60);
    var parts = [];
    if (primary) parts.push(primary);
    if (region && region.toLowerCase() !== primary.toLowerCase()) parts.push(region);
    if (!parts.length && country) parts.push(country);
    return cleanText(parts.join(', '), LIMITS.location);
  }

  function roundCoord(n) {
    return typeof n === 'number' && isFinite(n) ? n.toFixed(2) : '';
  }

  function reverseGeocode(lat, lon) {
    return new Promise(function (resolve, reject) {
      if (typeof fetch !== 'function') {
        reject(new Error('fetch unavailable'));
        return;
      }
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = window.setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('timeout'));
      }, GEOCODE_TIMEOUT_MS);

      var url = RSA_GEOCODE_ENDPOINT +
        '?latitude=' + encodeURIComponent(lat) +
        '&longitude=' + encodeURIComponent(lon) +
        '&localityLanguage=en';

      fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',        // no cookies
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer', // do not disclose the page URL
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) throw new Error('bad status');
          return res.json();
        })
        .then(function (data) {
          window.clearTimeout(timer);
          resolve(buildLocality(data));
        })
        .catch(function (err) {
          window.clearTimeout(timer);
          reject(err);
        });
    });
  }

  /* =====================================================================
   * DIALOG MANAGER (focus handling, Escape, Tab containment, scroll lock)
   * ===================================================================== */

  var dialogState = { active: null, opener: null, onDismiss: null };

  function getFocusable(root) {
    var nodes = root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    return Array.prototype.slice.call(nodes);
  }

  function openDialog(overlay, onDismiss) {
    if (!overlay || dialogState.active) return false;
    var current = document.activeElement;
    dialogState.opener = current && current !== document.body ? current : null;
    dialogState.active = overlay;
    dialogState.onDismiss = onDismiss;
    overlay.hidden = false;
    document.documentElement.classList.add('rsa-request-scroll-lock');
    var dialog = overlay.querySelector('.rsa-request-dialog');
    if (dialog) {
      try { dialog.focus({ preventScroll: true }); } catch (e) { dialog.focus(); }
    }
    return true;
  }

  function closeDialog(restoreFocus) {
    var overlay = dialogState.active;
    if (!overlay) return;
    overlay.hidden = true;
    dialogState.active = null;
    dialogState.onDismiss = null;
    document.documentElement.classList.remove('rsa-request-scroll-lock');
    var opener = dialogState.opener;
    dialogState.opener = null;
    if (restoreFocus !== false && opener && document.contains(opener) && typeof opener.focus === 'function') {
      try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  var dialogKeysBound = false;
  function bindDialogKeys() {
    if (dialogKeysBound) return;
    dialogKeysBound = true;
    document.addEventListener('keydown', function (e) {
      var overlay = dialogState.active;
      if (!overlay) return;

      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        if (typeof dialogState.onDismiss === 'function') dialogState.onDismiss();
        return;
      }

      if (e.key === 'Tab') {
        var items = getFocusable(overlay);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        var first = items[0];
        var last = items[items.length - 1];
        var current = document.activeElement;
        var dialog = overlay.querySelector('.rsa-request-dialog');
        if (e.shiftKey) {
          if (current === first || current === dialog || !overlay.contains(current)) {
            e.preventDefault();
            last.focus();
          }
        } else if (current === last || !overlay.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  function bindBackdropDismiss(overlay, handler) {
    var pressedOnBackdrop = false;
    overlay.addEventListener('pointerdown', function (e) {
      pressedOnBackdrop = e.target === overlay;
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && pressedOnBackdrop) handler();
      pressedOnBackdrop = false;
    });
  }

  function setBox(el, message) {
    if (!el) return;
    el.textContent = message || '';
    if (message) {
      el.classList.add('rsa-request-status--visible');
    } else {
      el.classList.remove('rsa-request-status--visible');
    }
  }

  /* =====================================================================
   * INITIALISATION
   * ===================================================================== */

  function init() {
    var form = byId('rsa-request-form');
    var nameInput = byId('rsa-request-name');
    var locInput = byId('rsa-request-location');
    var locHint = byId('rsa-request-location-hint');
    var nameError = byId('rsa-request-name-error');
    var locError = byId('rsa-request-location-error');
    var servicesSet = byId('rsa-request-services');
    var servicesList = byId('rsa-request-services-list');
    var servicesCount = byId('rsa-request-services-count');
    var servicesError = byId('rsa-request-services-error');
    var submitBtn = byId('rsa-request-submit');
    var resetBtn = byId('rsa-request-reset');
    var formStatus = byId('rsa-request-status');

    var locOverlay = byId('rsa-request-location-popup');
    var locShare = byId('rsa-request-location-share');
    var locDecline = byId('rsa-request-location-decline');
    var locClose = byId('rsa-request-location-close');
    var locPopupStatus = byId('rsa-request-location-popup-status');

    var platOverlay = byId('rsa-request-platform-popup');
    var platWhatsApp = byId('rsa-request-platform-whatsapp');
    var platEmail = byId('rsa-request-platform-email');
    var platCancel = byId('rsa-request-platform-cancel');
    var platClose = byId('rsa-request-platform-close');
    var platStatus = byId('rsa-request-platform-status');

    if (!form || !nameInput || !locInput || !servicesList || !locOverlay || !platOverlay ||
        !locShare || !locDecline || !locClose || !platWhatsApp || !platEmail || !platCancel || !platClose) {
      return;
    }
    // Prevent duplicate initialisation / duplicate event listeners.
    if (form.getAttribute('data-rsa-request-bound') === 'true') return;
    form.setAttribute('data-rsa-request-bound', 'true');

    // Move popups to <body> so no ancestor transform/overflow can clip them.
    document.body.appendChild(locOverlay);
    document.body.appendChild(platOverlay);

    var state = {
      locationEdited: false,
      locationStatus: '',
      geoRequestId: 0,
      geoGuardTimer: null
    };

    /* ---------- Service chips ---------- */
    var checkboxes = [];
    while (servicesList.firstChild) servicesList.removeChild(servicesList.firstChild);
    RSA_SERVICES.forEach(function (label, i) {
      var li = document.createElement('li');
      li.className = 'rsa-request-chip';

      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'rsa-request-service-' + i;
      input.name = 'rsa-request-services';
      input.className = 'rsa-request-chip-input';

      var lab = document.createElement('label');
      lab.className = 'rsa-request-chip-label';
      lab.htmlFor = input.id;
      lab.textContent = label;

      li.appendChild(input);
      li.appendChild(lab);
      servicesList.appendChild(li);
      checkboxes.push(input);
    });

    function getSelectedServices() {
      var picked = [];
      checkboxes.forEach(function (box, i) {
        if (box.checked) picked.push(RSA_SERVICES[i]);
      });
      return picked;
    }

    function updateCount() {
      var n = getSelectedServices().length;
      servicesCount.textContent = n === 0 ? 'None selected. Choose at least one.' : n + ' selected';
    }

    /* ---------- Errors & hints ---------- */
    function showFieldError(input, errEl, message) {
      errEl.textContent = message;
      input.setAttribute('aria-invalid', 'true');
    }

    function clearFieldError(input, errEl) {
      errEl.textContent = '';
      input.removeAttribute('aria-invalid');
    }

    function setServicesError(message) {
      servicesError.textContent = message || '';
      if (message) {
        servicesSet.classList.add('rsa-request-is-invalid');
      } else {
        servicesSet.classList.remove('rsa-request-is-invalid');
      }
    }

    function refreshHint() {
      var msg = HINTS.base;
      var stored = cleanText(storeGet(KEYS.location) || '', LIMITS.location);
      if (!state.locationEdited) {
        if (state.locationStatus === 'resolved' && stored && locInput.value === stored) {
          msg = HINTS.detected;
        } else if (state.locationStatus === 'denied') {
          msg = HINTS.denied;
        } else if (state.locationStatus === 'unavailable' || state.locationStatus === 'timeout' ||
                   state.locationStatus === 'unresolved') {
          msg = HINTS.failed;
        }
      }
      if (locHint) locHint.textContent = msg;
    }

    function setLocationStatus(status) {
      if (VALID_STATUSES.indexOf(status) === -1) return;
      state.locationStatus = status;
      storeSet(KEYS.status, status);
    }

    /* ---------- Persistence ---------- */
    function saveRequest() {
      var payload = {
        name: cleanText(nameInput.value, LIMITS.name),
        location: cleanText(locInput.value, LIMITS.location),
        services: getSelectedServices(),
        locationEdited: state.locationEdited === true
      };
      try {
        storeSet(KEYS.request, JSON.stringify(payload));
      } catch (e) { /* ignore */ }
    }

    function loadRequest() {
      var out = { name: '', location: '', services: [], locationEdited: false };
      var raw = storeGet(KEYS.request);
      if (!raw) return out;
      var data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        storeRemove(KEYS.request); // corrupted
        return out;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        storeRemove(KEYS.request);
        return out;
      }
      out.name = cleanText(data.name, LIMITS.name);
      out.location = cleanText(data.location, LIMITS.location);
      out.services = sanitizeServices(data.services);
      out.locationEdited = data.locationEdited === true;
      return out;
    }

    /* ---------- Restore saved session state ---------- */
    (function restore() {
      var saved = loadRequest();
      nameInput.value = saved.name;
      locInput.value = saved.location;
      state.locationEdited = saved.locationEdited;
      checkboxes.forEach(function (box, i) {
        box.checked = saved.services.indexOf(RSA_SERVICES[i]) !== -1;
      });

      var storedLocation = cleanText(storeGet(KEYS.location) || '', LIMITS.location);
      if (!locInput.value && !state.locationEdited && storedLocation) {
        locInput.value = storedLocation;
      }

      var savedStatus = storeGet(KEYS.status);
      state.locationStatus = VALID_STATUSES.indexOf(savedStatus) !== -1 ? savedStatus : '';
      updateCount();
      refreshHint();
    })();

    /* ---------- Form validation ---------- */
    function validateAll(showErrors) {
      var nameResult = validateText(nameInput.value, LIMITS.name,
        'Please enter your name.', 'Please enter a valid name (at least 2 characters).');
      var locResult = validateText(locInput.value, LIMITS.location,
        'Please enter your location.', 'Please enter a valid location (at least 2 characters).');
      var services = getSelectedServices();
      var servicesOk = services.length > 0;

      if (showErrors) {
        if (nameResult.ok) clearFieldError(nameInput, nameError);
        else showFieldError(nameInput, nameError, nameResult.msg);

        if (locResult.ok) clearFieldError(locInput, locError);
        else showFieldError(locInput, locError, locResult.msg);

        setServicesError(servicesOk ? '' : 'Please select at least one service.');

        if (!nameResult.ok) nameInput.focus();
        else if (!locResult.ok) locInput.focus();
        else if (!servicesOk && checkboxes.length) checkboxes[0].focus();
      }

      if (!nameResult.ok || !locResult.ok || !servicesOk) return null;
      return { name: nameResult.value, location: locResult.value, services: services };
    }

    /* ---------- Form events ---------- */
    nameInput.addEventListener('input', function () {
      clearFieldError(nameInput, nameError);
      setBox(formStatus, '');
      saveRequest();
    });

    locInput.addEventListener('input', function () {
      state.locationEdited = true; // manual edits always win over detection
      clearFieldError(locInput, locError);
      setBox(formStatus, '');
      saveRequest();
      refreshHint();
    });

    servicesList.addEventListener('change', function () {
      updateCount();
      setServicesError('');
      setBox(formStatus, '');
      saveRequest();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setBox(formStatus, '');
      var data = validateAll(true);
      if (!data) return;
      saveRequest();
      openPlatformDialog();
    });

    resetBtn.addEventListener('click', function () {
      nameInput.value = '';
      locInput.value = '';
      checkboxes.forEach(function (box) { box.checked = false; });
      state.locationEdited = false;
      state.locationStatus = '';
      storeRemove(KEYS.request);
      storeRemove(KEYS.location);
      storeRemove(KEYS.status);
      clearFieldError(nameInput, nameError);
      clearFieldError(locInput, locError);
      setServicesError('');
      updateCount();
      refreshHint();
      setBox(formStatus, 'Your saved details were cleared from this tab\u2019s session.');
      nameInput.focus();
    });

    /* ---------- Location popup ---------- */
    function resetShareButton() {
      locShare.disabled = false;
      locShare.removeAttribute('aria-busy');
      var label = locShare.querySelector('.rsa-request-btn-label');
      if (label) label.textContent = 'Share location';
    }

    function endGeoRequest() {
      state.geoRequestId += 1; // invalidates any in-flight callbacks
      if (state.geoGuardTimer) {
        window.clearTimeout(state.geoGuardTimer);
        state.geoGuardTimer = null;
      }
    }

    function declineLocation() {
      endGeoRequest();
      setLocationStatus('declined');
      setBox(locPopupStatus, '');
      resetShareButton();
      closeDialog(true);
      refreshHint();
    }

    function applyDetectedLocation(locality) {
      storeSet(KEYS.location, locality); // locality only, never coordinates
      if (!state.locationEdited) {
        locInput.value = locality;
        clearFieldError(locInput, locError);
        saveRequest();
      } else if (locHint) {
        locHint.textContent = HINTS.kept;
        return;
      }
      refreshHint();
    }

    function finishGeo(id, status, locality) {
      if (id !== state.geoRequestId) return; // dismissed or superseded
      endGeoRequest();
      setLocationStatus(status);
      if (status === 'resolved' && locality) applyDetectedLocation(locality);
      setBox(locPopupStatus, '');
      resetShareButton();
      closeDialog(true);
      refreshHint();
    }

    function shareLocation() {
      if (locShare.disabled) return;
      var id = state.geoRequestId + 1;
      state.geoRequestId = id;

      if (!('geolocation' in navigator) || !window.isSecureContext) {
        finishGeo(id, 'unavailable', '');
        return;
      }

      locShare.disabled = true;
      locShare.setAttribute('aria-busy', 'true');
      var label = locShare.querySelector('.rsa-request-btn-label');
      if (label) label.textContent = 'Locating\u2026';
      setBox(locPopupStatus, 'Waiting for your browser\u2019s permission\u2026 You can decline at any time.');

      state.geoGuardTimer = window.setTimeout(function () {
        finishGeo(id, 'timeout', '');
      }, GEO_GUARD_MS);

      try {
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            if (id !== state.geoRequestId) return;
            var lat = '';
            var lon = '';
            try {
              lat = roundCoord(pos.coords.latitude);
              lon = roundCoord(pos.coords.longitude);
            } catch (e) { /* handled below */ }
            if (!lat || !lon) {
              finishGeo(id, 'unresolved', '');
              return;
            }
            setBox(locPopupStatus, 'Finding your place name\u2026');
            reverseGeocode(lat, lon).then(
              function (locality) {
                finishGeo(id, locality ? 'resolved' : 'unresolved', locality);
              },
              function () {
                finishGeo(id, 'unresolved', '');
              }
            );
            // lat/lon go out of scope here; they are never stored.
          },
          function (err) {
            var code = err && err.code;
            finishGeo(id, code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable', '');
          },
          { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 300000 }
        );
      } catch (e) {
        finishGeo(id, 'unavailable', '');
      }
    }

    function showLocationPopup() {
      if (dialogState.active) return;
      resetShareButton();
      setBox(locPopupStatus, '');
      // Mark as handled when shown so it appears at most once per session.
      storeSet(KEYS.popupHandled, '1');
      openDialog(locOverlay, declineLocation);
    }

    locShare.addEventListener('click', shareLocation);
    locDecline.addEventListener('click', declineLocation);
    locClose.addEventListener('click', declineLocation);
    bindBackdropDismiss(locOverlay, declineLocation);

    /* ---------- Platform popup ---------- */
    function cancelPlatform() {
      setBox(platStatus, '');
      closeDialog(true);
    }

    function openPlatformDialog() {
      setBox(platStatus, '');
      openDialog(platOverlay, cancelPlatform);
    }

    function choosePlatform(kind) {
      // Re-validate and re-read from the form itself, never from storage.
      var data = validateAll(false);
      if (!data) {
        closeDialog(true);
        validateAll(true);
        return;
      }
      var message = buildMessage(data);

      if (kind === 'whatsapp') {
        var waUrl = buildWhatsAppUrl(message);
        if (!waUrl) {
          setBox(platStatus, 'WhatsApp isn\u2019t available right now. Please try email or call us instead.');
          return;
        }
        openExternal(waUrl, true);
        closeDialog(true);
        setBox(formStatus, 'WhatsApp should open with your message ready. Please review it and press send there. Nothing is sent until you do.');
      } else {
        var mailUrl = buildMailtoUrl(message);
        if (!mailUrl) {
          setBox(platStatus, 'Email isn\u2019t set up on this site yet. Please choose WhatsApp instead.');
          return;
        }
        openExternal(mailUrl, false);
        closeDialog(true);
        setBox(formStatus, 'Your email app should open with a draft ready. Please review and send it yourself. If nothing opens, your device may not have a default email app set up.');
      }
    }

    platWhatsApp.addEventListener('click', function () { choosePlatform('whatsapp'); });
    platEmail.addEventListener('click', function () { choosePlatform('email'); });
    platCancel.addEventListener('click', cancelPlatform);
    platClose.addEventListener('click', cancelPlatform);
    bindBackdropDismiss(platOverlay, cancelPlatform);

    bindDialogKeys();

    /* ---------- First-visit location popup (once per session) ---------- */
    if (storeGet(KEYS.popupHandled) !== '1') {
      var afterLoad = function () {
        var body = document.body;
        var finished = false;
        var observer = null;
        var fallbackTimer = null;

        var finish = function () {
          if (finished) return;
          finished = true;
          if (observer) observer.disconnect();
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          window.setTimeout(showLocationPopup, 400);
        };

        // The site hides content with body.body-loading while its intro runs.
        // Wait until that class is removed so the popup doesn't appear over it.
        if (!body.classList.contains('body-loading')) {
          finish();
          return;
        }
        if ('MutationObserver' in window) {
          observer = new MutationObserver(function () {
            if (!body.classList.contains('body-loading')) finish();
          });
          observer.observe(body, { attributes: true, attributeFilter: ['class'] });
        }
        fallbackTimer = window.setTimeout(finish, 10000);
      };

      if (document.readyState === 'complete') {
        afterLoad();
      } else {
        window.addEventListener('load', afterLoad, { once: true });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();