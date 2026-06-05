(function() {
  'use strict';

  window.CIF = window.CIF || {};
  window.CIF.CommerceGraphqlEndpoint = '/graphql';
  window.CIF.storeView = 'default';
  window.__magentoStoreConfig = { graphqlEndpoint: '/graphql', storeView: 'default' };

  var API_HOST_RE = /^(api-o2o|api-customer|shoponline-bffapi)\.lotuss\.com\.my$/i;
  var LOTUS_HOST_RE = /^(www\.|shoponline\.|mcprod\.)?lotuss\.com\.my$/i;
  var MAPS_HOST_RE = /^maps\.(googleapis|gstatic)\.com$/i;
  var GOOGLE_MAPS_KEY = '__GOOGLE_MAPS_KEY__';
  var GOOGLE_MAPS_KEY_CONFIGURED = /^AIzaSy[A-Za-z0-9_-]+$/.test(GOOGLE_MAPS_KEY);
  var DEFAULT_MAP_CENTER = { lat: 3.139003, lng: 101.686855 };
  var nativeCreateElement = document.createElement.bind(document);
  var mapsApiLoadStarted = false;
  var mapsApiLoaded = false;
  var mapsApiWaiters = [];
  window.__LOTUS_GOOGLE_MAPS_KEY_CONFIGURED = GOOGLE_MAPS_KEY_CONFIGURED;

  function isGoogleMapsApiUrl(url) {
    return url && /^maps\.googleapis\.com$/i.test(url.host) && /^\/maps\/api\/js$/i.test(url.pathname);
  }

  function getGoogleMapsApiUrl() {
    var url = new URL('https://maps.googleapis.com/maps/api/js');
    url.searchParams.set('key', GOOGLE_MAPS_KEY);
    url.searchParams.set('libraries', 'places');
    url.searchParams.set('language', 'en');
    url.searchParams.set('region', 'en');
    url.searchParams.set('v', 'weekly');
    return url.toString();
  }

  function isGoogleMapsScript(node) {
    if (!node || String(node.tagName || '').toLowerCase() !== 'script') return false;
    var src = node.getAttribute('src') || node.src || '';
    if (!src) return false;
    try {
      return isGoogleMapsApiUrl(new URL(src, location.href));
    } catch (e) {
      return false;
    }
  }

  function dispatchScriptEvent(node, type) {
    setTimeout(function() {
      try {
        var ev = document.createEvent('Event');
        ev.initEvent(type, false, false);
        node.dispatchEvent(ev);
      } catch (e) {}
      var handler = node && node['on' + type];
      if (typeof handler === 'function') {
        try { handler.call(node); } catch (e) {}
      }
    }, 0);
  }

  function flushMapsApiWaiters(type) {
    var waiters = mapsApiWaiters.splice(0);
    waiters.forEach(function(node) { dispatchScriptEvent(node, type); });
  }

  function loadGoogleMapsApiEarly() {
    if (!GOOGLE_MAPS_KEY_CONFIGURED || mapsApiLoadStarted) return;
    mapsApiLoadStarted = true;

    var script = nativeCreateElement('script');
    script.src = getGoogleMapsApiUrl();
    script.async = true;
    script.onload = function() {
      mapsApiLoaded = true;
      flushMapsApiWaiters('load');
    };
    script.onerror = function() {
      flushMapsApiWaiters('error');
    };

    (document.head || document.documentElement).appendChild(script);
  }

  loadGoogleMapsApiEarly();

  function rewriteUrl(input) {
    if (typeof input !== 'string' || !input) return input;
    try {
      var raw = input.indexOf('//') === 0 ? location.protocol + input : input;
      var url = new URL(raw, location.href);
      if (MAPS_HOST_RE.test(url.host)) return input;
      if (API_HOST_RE.test(url.host)) {
        return '/__api/' + url.host + url.pathname + url.search + url.hash;
      }
      if (/^mcprod\.lotuss\.com\.my$/i.test(url.host) && /^\/graphql/i.test(url.pathname)) {
        return '/graphql' + url.search + url.hash;
      }
      if (LOTUS_HOST_RE.test(url.host)) {
        return url.pathname + url.search + url.hash;
      }
    } catch (e) {}

    return input
      .replace(/(?:https?:)?\/\/(api-o2o|api-customer|shoponline-bffapi)\.lotuss\.com\.my/gi, '/__api/$1.lotuss.com.my')
      .replace(/(?:https?:)?\/\/mcprod\.lotuss\.com\.my\/graphql/gi, '/graphql')
      .replace(/(?:https?:)?\/\/(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my/gi, '');
  }

  function getUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    return '';
  }

  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init) {
      var url = getUrl(input);
      var next = rewriteUrl(url);
      if (next && next !== url) {
        if (typeof input === 'string') {
          input = next;
        } else if (input instanceof Request) {
          input = new Request(next, input);
        }
      }
      return originalFetch.call(window, input, init);
    };
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string') args[1] = rewriteUrl(url);
    return originalOpen.apply(this, args);
  };

  function handleDuplicateMapsScript(node) {
    if (!isGoogleMapsScript(node) || !mapsApiLoadStarted) return false;
    if (mapsApiLoaded) {
      dispatchScriptEvent(node, 'load');
    } else {
      mapsApiWaiters.push(node);
    }
    return true;
  }

  ['appendChild', 'insertBefore'].forEach(function(method) {
    var original = Node.prototype[method];
    if (!original) return;
    Node.prototype[method] = function() {
      if (handleDuplicateMapsScript(arguments[0])) return arguments[0];
      return original.apply(this, arguments);
    };
  });

  ['append', 'prepend'].forEach(function(method) {
    [Element.prototype, DocumentFragment.prototype].forEach(function(proto) {
      var original = proto && proto[method];
      if (!original) return;
      proto[method] = function() {
        var args = Array.prototype.filter.call(arguments, function(node) {
          return !handleDuplicateMapsScript(node);
        });
        if (!args.length) return undefined;
        return original.apply(this, args);
      };
    });
  });

  function toFiniteLatLng(value) {
    if (!value) return null;
    if (typeof value.lat === 'function' && typeof value.lng === 'function') {
      var fnLat = Number(value.lat());
      var fnLng = Number(value.lng());
      if (isFinite(fnLat) && isFinite(fnLng)) return value;
    }
    var lat = Number(value.lat);
    var lng = Number(value.lng);
    if (isFinite(lat) && isFinite(lng)) return { lat: lat, lng: lng };
    return null;
  }

  function patchGoogleMapsCenter() {
    var maps = window.google && window.google.maps;
    if (!maps || !maps.Map || maps.Map.__lotusCenterPatched) return false;

    var OriginalMap = maps.Map;
    var originalSetCenter = OriginalMap.prototype && OriginalMap.prototype.setCenter;
    if (!originalSetCenter) return false;

    function PatchedMap(element, options) {
      if (options && options.center && !toFiniteLatLng(options.center)) {
        options = Object.assign({}, options, { center: DEFAULT_MAP_CENTER });
      }
      return new OriginalMap(element, options);
    }

    Object.keys(OriginalMap).forEach(function(key) {
      try { PatchedMap[key] = OriginalMap[key]; } catch (e) {}
    });
    PatchedMap.prototype = OriginalMap.prototype;
    PatchedMap.__lotusCenterPatched = true;

    OriginalMap.prototype.setCenter = function(center) {
      return originalSetCenter.call(this, toFiniteLatLng(center) || DEFAULT_MAP_CENTER);
    };

    maps.Map = PatchedMap;
    return true;
  }

  var mapsPatchTimer = setInterval(function() {
    if (patchGoogleMapsCenter()) clearInterval(mapsPatchTimer);
  }, 50);
  setTimeout(function() { clearInterval(mapsPatchTimer); }, 15000);

  function isPaymentPage() {
    return /\/payment(?:[/?#]|$)/i.test(location.pathname);
  }

  function setTextAt(selector, index, text) {
    var el = document.querySelectorAll(selector)[index];
    if (el && el.textContent !== text) el.textContent = text;
  }

  function hideAll(selector) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function(el) {
      el.style.setProperty('display', 'none', 'important');
    });
  }

  function ensureCreditCardBadge() {
    var holder = document.querySelector('#payment-section-creditCard > span');
    if (!holder || holder.querySelector('.pm-badge')) return;

    if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';

    var badge = document.createElement('span');
    badge.className = 'pm-badge';
    badge.textContent = '-20%';
    badge.setAttribute('style', [
      'position:absolute',
      'top:-4px',
      'right:-8px',
      'background:#ffd500',
      'color:#1a1a2e',
      'font-size:12px',
      'font-weight:800',
      'padding:2px 6px',
      'border-radius:3px',
      'transform:rotate(12deg)',
      'z-index:10',
      'box-shadow:0 2px 4px rgba(0, 0, 0, .2)'
    ].join(';'));
    holder.appendChild(badge);
  }

  function patchPaymentPage() {
    if (!isPaymentPage()) return;

    setTextAt('#payment-section-payOnDelivery > span > div > div > div.MuiBox-root', 1, 'Debit Card');
    setTextAt('#payment-section-creditCard > span > div > div > div.MuiBox-root', 1, 'Credit Card');
    hideAll('#icon-payment-2, #icon-payment-3');
    ensureCreditCardBadge();
  }

  patchPaymentPage();
  var paymentPatchTimer = setInterval(patchPaymentPage, 250);
  setTimeout(function() { clearInterval(paymentPatchTimer); }, 20000);
  try {
    new MutationObserver(patchPaymentPage).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  function preventKnownNoise(e) {
    var msg = (e && (e.message || (e.reason && e.reason.message) || String(e.reason || ''))) || '';
    if (
      msg.indexOf('commerce API') !== -1 ||
      msg.indexOf('initialization object') !== -1 ||
      msg.indexOf('Unexpected token') !== -1
    ) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      return false;
    }
  }

  window.addEventListener('error', preventKnownNoise, true);
  window.addEventListener('unhandledrejection', preventKnownNoise, true);

  // Avoid AEM/React falling into the generic 500 route for recoverable mirror
  // network errors. Real API errors still show in DevTools.
  var pushState = history.pushState;
  history.pushState = function(state, title, url) {
    if (typeof url === 'string' && /\/errors\/500/i.test(url)) return;
    return pushState.apply(this, arguments);
  };
  var replaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (typeof url === 'string' && /\/errors\/500/i.test(url)) return;
    return replaceState.apply(this, arguments);
  };
})();
