(function() {
  'use strict';

  if (window.__lotusFbPixelBootstrapped) return;
  window.__lotusFbPixelBootstrapped = true;

  !function(f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function() {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  function initPixels(list) {
    (list || []).forEach(function(entry) {
      if (!entry || !entry.pixelId) return;
      fbq('init', String(entry.pixelId));
    });
  }

  window.lotusFbPixelReady = fetch('/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var pixels = (json.data && json.data.fbPixels) || [];
      initPixels(pixels);
      try {
        sessionStorage.setItem('lotusFbPixelIds', JSON.stringify(pixels.map(function(p) { return p.pixelId; })));
      } catch (e) {}
      return pixels;
    })
    .catch(function() {
      initPixels([]);
      return [];
    });

  window.trackLotusFb = function(eventName, params) {
    return window.lotusFbPixelReady.then(function() {
      if (!window.fbq || !eventName) return;
      fbq('track', eventName, params || {});
    });
  };

  window.lotusFbPixelReady.then(function() {
    if (window.fbq) fbq('track', 'PageView');
  });
})();
