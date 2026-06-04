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
  window.__LOTUS_GOOGLE_MAPS_KEY_CONFIGURED = !!(GOOGLE_MAPS_KEY && GOOGLE_MAPS_KEY !== '__GOOGLE_MAPS_KEY__');

  function rewriteMapsUrl(input) {
    if (typeof input !== 'string' || !input) return input;
    try {
      var raw = input.indexOf('//') === 0 ? location.protocol + input : input;
      var url = new URL(raw, location.href);
      if (!MAPS_HOST_RE.test(url.host)) return input;
      if (GOOGLE_MAPS_KEY && GOOGLE_MAPS_KEY !== '__GOOGLE_MAPS_KEY__' && url.searchParams.has('key')) {
        url.searchParams.set('key', GOOGLE_MAPS_KEY);
        return url.toString();
      }
      return input;
    } catch (e) {}
    return input;
  }

  function rewriteUrl(input) {
    if (typeof input !== 'string' || !input) return input;
    input = rewriteMapsUrl(input);
    try {
      var raw = input.indexOf('//') === 0 ? location.protocol + input : input;
      var url = new URL(raw, location.href);
      if (MAPS_HOST_RE.test(url.host)) return rewriteMapsUrl(input);
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

  function patchScriptUrl(el) {
    if (!el || String(el.tagName || '').toLowerCase() !== 'script') return;
    var src = el.getAttribute('src') || el.src || '';
    var next = rewriteMapsUrl(src);
    if (next && next !== src) el.setAttribute('src', next);
  }

  var originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (
      String(this.tagName || '').toLowerCase() === 'script' &&
      String(name || '').toLowerCase() === 'src'
    ) {
      value = rewriteMapsUrl(value);
    }
    return originalSetAttribute.call(this, name, value);
  };

  (function patchScriptSrcPrototype() {
    var Ctor = window.HTMLScriptElement;
    var proto = Ctor && Ctor.prototype;
    var holder = proto;
    var desc = null;
    while (holder && !desc) {
      desc = Object.getOwnPropertyDescriptor(holder, 'src');
      holder = Object.getPrototypeOf(holder);
    }
    if (!proto || !desc || !desc.set || !desc.get) return;
    try {
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function() { return desc.get.call(this); },
        set: function(value) { return desc.set.call(this, rewriteMapsUrl(value)); }
      });
    } catch (e) {}
  })();

  var originalCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName) {
    var el = originalCreateElement(tagName);
    if (String(tagName).toLowerCase() === 'script') patchScriptUrl(el);
    return el;
  };

  ['appendChild', 'insertBefore'].forEach(function(method) {
    var original = Node.prototype[method];
    if (!original) return;
    Node.prototype[method] = function() {
      Array.prototype.forEach.call(arguments, patchScriptUrl);
      return original.apply(this, arguments);
    };
  });

  ['append', 'prepend'].forEach(function(method) {
    [Element.prototype, DocumentFragment.prototype].forEach(function(proto) {
      var original = proto && proto[method];
      if (!original) return;
      proto[method] = function() {
        Array.prototype.forEach.call(arguments, patchScriptUrl);
        return original.apply(this, arguments);
      };
    });
  });

  try {
    new MutationObserver(function(records) {
      records.forEach(function(record) {
        Array.prototype.forEach.call(record.addedNodes || [], function(node) {
          patchScriptUrl(node);
          if (node && node.querySelectorAll) {
            Array.prototype.forEach.call(node.querySelectorAll('script[src]'), patchScriptUrl);
          }
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
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
