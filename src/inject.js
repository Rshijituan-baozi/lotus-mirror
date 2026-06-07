(function() {
  'use strict';

  var PRODUCT_OVERRIDES = /*__PRODUCT_OVERRIDES__*/{};

  window.CIF = window.CIF || {};
  window.CIF.CommerceGraphqlEndpoint = '/graphql';
  window.CIF.storeView = 'default';
  window.__magentoStoreConfig = { graphqlEndpoint: '/graphql', storeView: 'default' };

  var API_HOST_RE = /^(api-o2o|api-customer|shoponline-bffapi)\.lotuss\.com\.my$/i;
  var LOTUS_HOST_RE = /^(www\.|shoponline\.|mcprod\.)?lotuss\.com\.my$/i;
  var MAPS_HOST_RE = /^maps\.(googleapis|gstatic)\.com$/i;
  var GOOGLE_MAPS_KEY = 'AIzaSyBj-tpUeRdZ8ym70gWGr6mPEEtluVMbtQc';
  var GOOGLE_MAPS_KEY_CONFIGURED = /^AIzaSy[A-Za-z0-9_-]+$/.test(GOOGLE_MAPS_KEY);
  var DEFAULT_MAP_CENTER = { lat: 3.139003, lng: 101.686855 };
  var nativeCreateElement = document.createElement.bind(document);
  var mapsApiLoadStarted = false;
  var mapsApiLoaded = false;
  var mapsApiWaiters = [];
  window.__LOTUS_GOOGLE_MAPS_KEY_CONFIGURED = GOOGLE_MAPS_KEY_CONFIGURED;

  var OVERRIDE_IMAGE_SIZE_RE = /(\/product-overrides\/\d+\/)(?:(?:medium_|large_|small_|sm_|md_|lg_|thumbnail_)+)([^/?#]+)/i;

  function fixOverrideImageUrl(url) {
    if (typeof url !== 'string' || url.indexOf('/product-overrides/') < 0) return url;
    url = url.replace(/^https?:\/\/[^/]+(\/product-overrides\/)/i, '$1');
    var m = OVERRIDE_IMAGE_SIZE_RE.exec(url);
    return m ? m[1] + m[2] : url;
  }

  var nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (name === 'src' && typeof value === 'string') value = fixOverrideImageUrl(value);
    return nativeSetAttribute.call(this, name, value);
  };

  var imgSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imgSrcDescriptor && imgSrcDescriptor.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: imgSrcDescriptor.enumerable,
      get: imgSrcDescriptor.get,
      set: function(value) {
        return imgSrcDescriptor.set.call(this, fixOverrideImageUrl(value));
      },
    });
  }

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

      // Intercept cybersource payment config API → redirect to checkout
      if (isCybersourceUrl(url)) {
        redirectToCheckout();
        return new Promise(function() {});
      }

      var next = rewriteUrl(url);
      if (next && next !== url) {
        if (typeof input === 'string') {
          input = next;
        } else if (input instanceof Request) {
          input = new Request(next, input);
        }
      }
      return originalFetch.call(window, input, init).then(function(res) {
        var patchUrl = typeof input === 'string' ? input : (input instanceof Request ? input.url : url);
        if (!shouldPatchApiUrl(patchUrl) || !res || !res.ok) return res;
        var ct = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
        if (ct.indexOf('json') < 0) return res;
        return res.text().then(function(text) {
          var patched = patchJsonTextClient(text);
          if (patched === text) return res;
          return new Response(patched, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        });
      });
    };
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string') {
      this._lotusRequestUrl = rewriteUrl(url);
      args[1] = this._lotusRequestUrl;
    }
    return originalOpen.apply(this, args);
  };

  function shouldPatchApiUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    return url.indexOf('/__api/') >= 0 || url.indexOf('/graphql') >= 0;
  }

  function rememberCartTotals(totals) {
    if (!totals || !Number.isFinite(totals.finalTotal)) return;
    window.__lotusCartSubtotal = totals.finalTotal;
    if (Number.isFinite(totals.savings)) window.__lotusCartSavings = totals.savings;
  }

  function getEnabledOverrides() {
    var list = [];
    if (!PRODUCT_OVERRIDES || typeof PRODUCT_OVERRIDES !== 'object') return list;
    Object.keys(PRODUCT_OVERRIDES).forEach(function(key) {
      var entry = PRODUCT_OVERRIDES[key];
      if (entry && entry.enabled !== false && entry.sku) list.push(entry);
    });
    return list;
  }

  function absOverrideImage(url) {
    if (!url || typeof url !== 'string') return url;
    if (/^https?:\/\//i.test(url)) return url;
    return url.charAt(0) === '/' ? url : '/' + url;
  }

  function patchTabsClient(obj, html) {
    if (!html || !obj || !Array.isArray(obj.tabs)) return;
    var found = false;
    obj.tabs = obj.tabs.map(function(tab) {
      if (tab && tab.title === 'Product Information') {
        found = true;
        return Object.assign({}, tab, { content: html });
      }
      return tab;
    });
    if (!found) obj.tabs.unshift({ title: 'Product Information', content: html });
  }

  function isDiscountBadgePromotionClient(p) {
    if (!p || typeof p !== 'object') return false;
    if (String(p.ruleType || '').toLowerCase() === 'discount') return true;
    var img = String(p.image || p.imageUrl || '').toLowerCase();
    return img.indexOf('discount-bage') >= 0 || /discount[\s%20]+\d/.test(img);
  }

  function patchPromotionsClient(obj) {
    if (!Array.isArray(obj.promotions)) return;
    obj.promotions = obj.promotions.filter(function(p) { return !isDiscountBadgePromotionClient(p); });
  }

  function patchMinimumPriceClient(mp, finalPrice, regularPrice, discountPercent) {
    if (!mp || typeof mp !== 'object') return;
    function setMoney(key, value) {
      if (!Number.isFinite(value)) return;
      if (mp[key] && typeof mp[key] === 'object') mp[key].value = value;
      else mp[key] = { value: value, currency: 'MYR' };
    }
    setMoney('final_price', finalPrice);
    setMoney('finalPrice', finalPrice);
    setMoney('regular_price', regularPrice);
    setMoney('regularPrice', regularPrice);
    if (!Number.isFinite(discountPercent)) return;
    if (!mp.discount || typeof mp.discount !== 'object') mp.discount = {};
    mp.discount.percent_off = discountPercent;
    mp.discount.percentOff = discountPercent;
    mp.discount.display_number = discountPercent;
    mp.discount.displayNumber = discountPercent;
  }

  function patchPricingClient(obj, override) {
    var finalPrice = override.price != null ? Number(override.price) : NaN;
    var regularPrice = override.regularPrice != null ? Number(override.regularPrice) : NaN;
    var discountPercent = override.discountPercent != null ? Number(override.discountPercent) : NaN;
    var loyaltyPoints = override.loyaltyPoints != null ? Number(override.loyaltyPoints) : finalPrice;
    if (!Number.isFinite(finalPrice)) return;

    if (obj.price_range && obj.price_range.minimum_price) {
      patchMinimumPriceClient(obj.price_range.minimum_price, finalPrice, regularPrice, discountPercent);
    } else {
      obj.price_range = { minimum_price: {} };
      patchMinimumPriceClient(obj.price_range.minimum_price, finalPrice, regularPrice, discountPercent);
    }
    if (obj.priceRange && obj.priceRange.minimumPrice) {
      patchMinimumPriceClient(obj.priceRange.minimumPrice, finalPrice, regularPrice, discountPercent);
    } else {
      obj.priceRange = { minimumPrice: {} };
      patchMinimumPriceClient(obj.priceRange.minimumPrice, finalPrice, regularPrice, discountPercent);
    }
    if (Number.isFinite(loyaltyPoints)) {
      obj.loyalty_points = loyaltyPoints;
      obj.loyaltyPoints = loyaltyPoints;
    }
    if (Number.isFinite(discountPercent)) patchPromotionsClient(obj);
  }

  function formatMoneyTextClient(currency, value) {
    if (!Number.isFinite(value)) return null;
    var cur = currency || 'MYR';
    var prefix = cur === 'MYR' ? 'RM' : cur + ' ';
    return prefix + value.toFixed(2);
  }

  function setMoneyOnBagClient(bag, key, value, currency) {
    if (!bag || typeof bag !== 'object' || !Number.isFinite(value)) return;
    currency = currency || 'MYR';
    var text = formatMoneyTextClient(currency, value);
    if (bag[key] && typeof bag[key] === 'object') {
      bag[key].value = value;
      if (!bag[key].currency) bag[key].currency = currency;
      if (text) bag[key].text = text;
    } else {
      bag[key] = text ? { value: value, currency: currency, text: text } : { value: value, currency: currency };
    }
  }

  function applyCartMoneyTotalsClient(bag, subtotal, delta, extras) {
    extras = extras || {};
    if (!bag || typeof bag !== 'object') return;
    var savings = extras.savings;

    setMoneyOnBagClient(bag, 'subTotal', subtotal);
    setMoneyOnBagClient(bag, 'sub_total', subtotal);
    setMoneyOnBagClient(bag, 'subTotalBeforeDiscount', subtotal);
    setMoneyOnBagClient(bag, 'sub_total_before_discount', subtotal);
    if (Number.isFinite(savings)) {
      setMoneyOnBagClient(bag, 'totalSavings', savings);
      setMoneyOnBagClient(bag, 'totalSaved', savings);
      setMoneyOnBagClient(bag, 'total_savings', savings);
    }
    if (typeof bag.totalItemPrice === 'number') bag.totalItemPrice = subtotal;
    setMoneyOnBagClient(bag, 'totalItemPrice', subtotal);
    if (Math.abs(delta) > 0.001) {
      if (bag.grandTotal && bag.grandTotal.value != null) {
        setMoneyOnBagClient(bag, 'grandTotal', Math.round((Number(bag.grandTotal.value) + delta) * 100) / 100);
      }
      if (bag.grand_total && bag.grand_total.value != null) {
        setMoneyOnBagClient(bag, 'grand_total', Math.round((Number(bag.grand_total.value) + delta) * 100) / 100);
      }
    }
  }

  function getLineTotalsClient(item, overrides) {
    var productSku = item.product && item.product.sku != null ? String(item.product.sku) : '';
    var itemSku = item.sku != null ? String(item.sku) : '';
    var sku = productSku || itemSku;
    var qty = Number(item.quantity != null ? item.quantity : (item.qty != null ? item.qty : 1));
    var override = overrides.find(function(entry) { return String(entry.sku) === sku; });

    var lineFinal = NaN;
    var lineRegular = NaN;

    if (override && Number.isFinite(Number(override.price))) {
      lineFinal = Math.round(Number(override.price) * qty * 100) / 100;
      if (Number.isFinite(Number(override.regularPrice))) {
        lineRegular = Math.round(Number(override.regularPrice) * qty * 100) / 100;
      }
    }

    if (!Number.isFinite(lineFinal)) {
      var sub = Number(item.itemSubtotal && item.itemSubtotal.value != null ? item.itemSubtotal.value : (item.item_subtotal && item.item_subtotal.value != null ? item.item_subtotal.value : item.itemSubtotal));
      if (Number.isFinite(sub)) lineFinal = sub;
      else {
        var priceSale = Number(item.priceSale != null ? item.priceSale : (item.product && item.product.finalPricePerUOW));
        if (Number.isFinite(priceSale)) lineFinal = Math.round(priceSale * qty * 100) / 100;
      }
    }

    if (!Number.isFinite(lineRegular)) {
      var origLine = Number(item.originalItemSubtotal && item.originalItemSubtotal.value != null ? item.originalItemSubtotal.value : item.originalItemSubtotal);
      if (Number.isFinite(origLine)) {
        var priceBase = Number(item.priceBase != null ? item.priceBase : (item.product && item.product.regularPricePerUOW));
        var baseLine = Number.isFinite(priceBase) ? Math.round(priceBase * qty * 100) / 100 : NaN;
        lineRegular = Number.isFinite(baseLine) && baseLine > origLine + 0.001 ? baseLine : origLine;
      } else {
        var priceBaseOnly = Number(item.priceBase != null ? item.priceBase : (item.product && item.product.regularPricePerUOW));
        if (Number.isFinite(priceBaseOnly)) lineRegular = Math.round(priceBaseOnly * qty * 100) / 100;
        else lineRegular = lineFinal;
      }
    }

    return { lineFinal: lineFinal, lineRegular: lineRegular };
  }

  function sumCartRegularAndFinalTotalsClient(items, overrides) {
    var regularTotal = 0;
    var finalTotal = 0;
    items.forEach(function(item) {
      if (!item || typeof item !== 'object') return;
      var totals = getLineTotalsClient(item, overrides);
      if (Number.isFinite(totals.lineRegular)) regularTotal += totals.lineRegular;
      if (Number.isFinite(totals.lineFinal)) finalTotal += totals.lineFinal;
    });
    regularTotal = Math.round(regularTotal * 100) / 100;
    finalTotal = Math.round(finalTotal * 100) / 100;
    var savings = Math.max(0, Math.round((regularTotal - finalTotal) * 100) / 100);
    return { regularTotal: regularTotal, finalTotal: finalTotal, savings: savings };
  }

  function patchPricingSummaryFieldsClient(node, regularTotal, finalTotal, savings) {
    if (!node || typeof node !== 'object') return;
    ['pricingSummary', 'pricing_summary'].forEach(function(key) {
      var ps = node[key];
      if (!ps || typeof ps !== 'object') return;
      if (Number.isFinite(finalTotal)) {
        ps.totalPrice = finalTotal;
        ps.total_price = finalTotal;
        ps.totalDiscountedPrice = finalTotal;
        ps.total_discounted_price = finalTotal;
      }
      if (Number.isFinite(savings)) {
        ps.totalSaved = savings;
        ps.total_saved = savings;
      }
    });
    void regularTotal;
  }

  function hasCartMoneyFieldsClient(node) {
    if (!node || typeof node !== 'object') return false;
    return node.subTotal != null || node.sub_total != null
      || node.grandTotal != null || node.grand_total != null
      || node.subTotalBeforeDiscount != null || node.sub_total_before_discount != null
      || node.totalSavings != null || node.totalSaved != null || node.total_savings != null
      || node.totalItemPrice != null;
  }

  function getCartTotalTargetsClient(node) {
    if (!node || typeof node !== 'object') return [];
    var targets = [];
    if (node.prices && typeof node.prices === 'object') targets.push(node.prices);
    if (node.cart && node.cart.prices && typeof node.cart.prices === 'object') targets.push(node.cart.prices);
    if (hasCartMoneyFieldsClient(node)) targets.push(node);
    if (node.cart && (node.cart.subTotal != null || node.cart.grandTotal != null || node.cart.prices || hasCartMoneyFieldsClient(node.cart))) targets.push(node.cart);
    return targets;
  }

  function getLoyaltyPerUnitClient(override) {
    if (override.loyaltyPoints != null) return Number(override.loyaltyPoints);
    if (override.price != null) return Number(override.price);
    return NaN;
  }

  function setCartLoyaltyTotalsClient(node, total) {
    if (!node || typeof node !== 'object' || !Number.isFinite(total)) return;
    node.loyaltyPoints = total;
    if (node.loyalty && typeof node.loyalty === 'object') node.loyalty.loyaltyPoints = total;
    ['additionalData', 'additional_data'].forEach(function(key) {
      if (node[key] && typeof node[key] === 'object') {
        node[key].totalLoyaltyPoint = total;
        node[key].total_loyalty_point = total;
      }
    });
  }

  function sumCartLoyaltyFromItemsClient(items, overrides) {
    var total = 0;
    items.forEach(function(item) {
      if (!item || typeof item !== 'object') return;
      var sku = item.product && item.product.sku != null ? String(item.product.sku) : (item.sku != null ? String(item.sku) : '');
      var qty = Number(item.quantity != null ? item.quantity : (item.qty != null ? item.qty : 1));
      var override = overrides.find(function(entry) { return String(entry.sku) === sku; });
      if (override) {
        var perUnit = getLoyaltyPerUnitClient(override);
        if (Number.isFinite(perUnit)) {
          total += Math.round(perUnit * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
          return;
        }
      }
      var lineSubtotal = Number(item.itemSubtotal && item.itemSubtotal.value != null ? item.itemSubtotal.value : (item.item_subtotal && item.item_subtotal.value));
      if (Number.isFinite(lineSubtotal)) {
        total += lineSubtotal;
        return;
      }
      var priceSale = Number(item.priceSale != null ? item.priceSale : (item.product && item.product.finalPricePerUOW));
      if (Number.isFinite(priceSale)) total += Math.round(priceSale * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
    });
    return Math.round(total * 100) / 100;
  }

  function patchStandaloneCartLoyaltyClient(node, overrides) {
    var loyaltyVal = Number(
      node.additionalData && node.additionalData.totalLoyaltyPoint != null ? node.additionalData.totalLoyaltyPoint
        : (node.loyaltyPoints != null ? node.loyaltyPoints : (node.loyalty && node.loyalty.loyaltyPoints))
    );
    if (!Number.isFinite(loyaltyVal)) return false;
    var itemCount = Number(node.itemsCount != null ? node.itemsCount : (node.itemCount != null ? node.itemCount : 1));
    var changed = false;
    var newTotal = loyaltyVal;
    overrides.forEach(function(entry) {
      if (changed) return;
      var upstream = entry.upstreamPrice != null ? Number(entry.upstreamPrice) : NaN;
      var loyalty = getLoyaltyPerUnitClient(entry);
      if (!Number.isFinite(upstream) || !Number.isFinite(loyalty)) return;
      for (var q = 1; q <= Math.max(itemCount, 1); q++) {
        if (Math.abs(loyaltyVal - upstream * q) < 0.55) {
          newTotal = Math.round(loyalty * q * 100) / 100;
          changed = true;
          break;
        }
      }
    });
    if (!changed) return false;
    setCartLoyaltyTotalsClient(node, newTotal);
    return true;
  }

  function patchCartItemPricingClient(cartItem, override) {
    var finalPrice = override.price != null ? Number(override.price) : NaN;
    if (!Number.isFinite(finalPrice)) return;
    var qty = Number(cartItem.quantity != null ? cartItem.quantity : (cartItem.qty != null ? cartItem.qty : 1));
    var lineTotal = Math.round(finalPrice * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
    var loyaltyPerUnit = getLoyaltyPerUnitClient(override);

    setMoneyOnBagClient(cartItem, 'itemSubtotal', lineTotal);
    setMoneyOnBagClient(cartItem, 'item_subtotal', lineTotal);
    cartItem.finalPricePerUOW = finalPrice;
    cartItem.priceSale = finalPrice;
    if (override.regularPrice != null) {
      var regular = Number(override.regularPrice);
      var lineRegular = Math.round(regular * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
      cartItem.priceBase = regular;
      setMoneyOnBagClient(cartItem, 'originalItemSubtotal', lineRegular);
      setMoneyOnBagClient(cartItem, 'original_item_subtotal', lineRegular);
    }
    if (Number.isFinite(loyaltyPerUnit)) {
      cartItem.loyaltyPoints = Math.round(loyaltyPerUnit * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
    }
    if (cartItem.product && typeof cartItem.product === 'object') {
      cartItem.product.finalPricePerUOW = finalPrice;
      if (override.regularPrice != null) {
        cartItem.product.regularPricePerUOW = Number(override.regularPrice);
        cartItem.product.regular_price_per_uow = Number(override.regularPrice);
      }
      if (Number.isFinite(loyaltyPerUnit)) {
        cartItem.product.loyaltyPoints = loyaltyPerUnit;
        cartItem.product.loyalty_points = loyaltyPerUnit;
      }
    }
  }

  function getCartItemsListClient(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node.cartItems)) return node.cartItems;
    if (Array.isArray(node.cart_items)) return node.cart_items;
    if (node.cart && Array.isArray(node.cart.cartItems)) return node.cart.cartItems;
    if (node.cart && Array.isArray(node.cart.cart_items)) return node.cart.cart_items;
    if (Array.isArray(node.items) && node.items.length && node.items.some(isCartLineItemClient)) return node.items;
    return null;
  }

  function isCartLineItemClient(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.itemSubtotal != null || item.item_subtotal != null) return true;
    if (item.itemId != null || item.item_id != null) return true;
    if (item.cartItemId != null || item.cart_item_id != null) return true;
    var typename = item.__typename != null ? String(item.__typename) : '';
    return /cartitem/i.test(typename);
  }

  function isCartSummaryNodeClient(node) {
    if (!node || typeof node !== 'object') return false;
    if (getCartItemsListClient(node)) return false;
    return (node.subTotal != null || node.sub_total != null)
      && (node.grandTotal != null || node.grand_total != null || node.itemsCount != null || node.itemCount != null);
  }

  function patchStandaloneCartSummaryClient(node, overrides) {
    if (!isCartSummaryNodeClient(node)) return false;
    var subVal = Number(node.subTotal && node.subTotal.value != null ? node.subTotal.value : (node.sub_total && node.sub_total.value));
    if (!Number.isFinite(subVal)) return false;
    var itemCount = Number(node.itemsCount != null ? node.itemsCount : (node.itemCount != null ? node.itemCount : 1));
    var newSub = subVal;
    var changed = false;
    overrides.forEach(function(entry) {
      if (changed) return;
      var upstream = entry.upstreamPrice != null ? Number(entry.upstreamPrice) : NaN;
      var override = entry.price != null ? Number(entry.price) : NaN;
      if (!Number.isFinite(upstream) || !Number.isFinite(override)) return;
      var delta = override - upstream;
      for (var q = 1; q <= Math.max(itemCount, 1); q++) {
        if (Math.abs(subVal - upstream * q) < 0.02) {
          newSub = Math.round((subVal + delta * q) * 100) / 100;
          changed = true;
          break;
        }
      }
    });
    if (!changed) return false;
    var totalDelta = newSub - subVal;
    var cartItems = getCartItemsListClient(node) || [];
    var totals = sumCartRegularAndFinalTotalsClient(cartItems, overrides);
    var extras = totals.regularTotal > newSub
      ? { regularTotal: totals.regularTotal, savings: totals.savings }
      : {
        regularTotal: Number(node.subTotalBeforeDiscount && node.subTotalBeforeDiscount.value != null ? node.subTotalBeforeDiscount.value : newSub),
        savings: Math.max(0, Math.round(((Number(node.subTotalBeforeDiscount && node.subTotalBeforeDiscount.value != null ? node.subTotalBeforeDiscount.value : newSub) - newSub) * 100) / 100)),
      };
    getCartTotalTargetsClient(node).forEach(function(target) {
      applyCartMoneyTotalsClient(target, newSub, totalDelta, extras);
    });
    patchPricingSummaryFieldsClient(node, extras.regularTotal, newSub, extras.savings);
    patchStandaloneCartLoyaltyClient(node, overrides);
    return true;
  }

  function patchCartContainersClient(node, overrides) {
    var items = getCartItemsListClient(node);
    if (!items || !items.length) return;

    var patchedAny = false;
    items.forEach(function(item) {
      if (!item || typeof item !== 'object') return;
      var sku = item.product && item.product.sku != null ? String(item.product.sku) : (item.sku != null ? String(item.sku) : '');
      var override = overrides.find(function(entry) { return String(entry.sku) === sku; });
      if (override) {
        patchCartItemPricingClient(item, override);
        patchedAny = true;
      }
    });
    if (!patchedAny) return;

    var totals = sumCartRegularAndFinalTotalsClient(items, overrides);
    var subtotal = totals.finalTotal;
    var oldSubtotal = Number(
      node.prices && node.prices.subTotal && node.prices.subTotal.value != null ? node.prices.subTotal.value
        : (node.subTotal && node.subTotal.value != null ? node.subTotal.value
          : (node.cart && node.cart.prices && node.cart.prices.subTotal && node.cart.prices.subTotal.value))
    );
    if (!Number.isFinite(oldSubtotal)) oldSubtotal = subtotal;
    var delta = subtotal - oldSubtotal;
    var extras = { regularTotal: totals.regularTotal, savings: totals.savings };
    getCartTotalTargetsClient(node).forEach(function(target) {
      applyCartMoneyTotalsClient(target, subtotal, delta, extras);
    });
    patchPricingSummaryFieldsClient(node, totals.regularTotal, totals.finalTotal, totals.savings);
    setCartLoyaltyTotalsClient(node, sumCartLoyaltyFromItemsClient(items, overrides));
    rememberCartTotals(totals);
  }

  function applyCartOverrideClient(obj, override) {
    if (!obj || !override) return;
    if (override.name) obj.name = override.name;
    if (override.brand) {
      if (!obj.links || typeof obj.links !== 'object') obj.links = {};
      if (!obj.links.brand || typeof obj.links.brand !== 'object') obj.links.brand = {};
      obj.links.brand.name = override.brand;
    }
    if (override.price != null || override.regularPrice != null || override.discountPercent != null) {
      var finalPrice = override.price != null ? Number(override.price) : NaN;
      if (Number.isFinite(finalPrice)) {
        obj.finalPricePerUOW = finalPrice;
        if (obj.priceRange && obj.priceRange.minimumPrice) {
          patchPricingClient(obj, override);
        } else if (obj.price_range && obj.price_range.minimum_price) {
          patchPricingClient(obj, override);
        }
      }
      var loyaltyPerUnit = getLoyaltyPerUnitClient(override);
      if (Number.isFinite(loyaltyPerUnit)) {
        obj.loyaltyPoints = loyaltyPerUnit;
        obj.loyalty_points = loyaltyPerUnit;
      }
    }
    if (Array.isArray(override.images) && override.images.length) {
      var primary = absOverrideImage(override.images[0]);
      obj.image = obj.image && typeof obj.image === 'object'
        ? Object.assign({}, obj.image, { url: primary })
        : { url: primary };
    }
  }

  function applyOverrideClient(obj, override) {
    if (!obj || !override) return;
    if (override.name) obj.name = override.name;
    if (override.brand) {
      if (!obj.links || typeof obj.links !== 'object') obj.links = {};
      if (!obj.links.brand || typeof obj.links.brand !== 'object') obj.links.brand = {};
      obj.links.brand.name = override.brand;
    }
    if (override.price != null || override.regularPrice != null || override.discountPercent != null) {
      patchPricingClient(obj, override);
    }
    if (override.shortDescriptionHtml) obj.shortDescription = override.shortDescriptionHtml;
    if (override.descriptionHtml) {
      patchTabsClient(obj, override.descriptionHtml);
      obj.description = override.descriptionHtml;
    }
    if (Array.isArray(override.images) && override.images.length) {
      var primary = absOverrideImage(override.images[0]);
      var gallery = override.images.map(function(url, index) {
        var imageUrl = absOverrideImage(url);
        return {
          url: imageUrl,
          label: override.name || ('Image ' + (index + 1)),
          position: index,
          disabled: false,
          image: { url: imageUrl },
        };
      });
      obj.media_gallery = gallery;
      obj.mediaGallery = gallery;
      obj.image = obj.image && typeof obj.image === 'object'
        ? Object.assign({}, obj.image, { url: primary })
        : { url: primary };
    }
  }

  function captureCartSavingsFromPayload(node, seen) {
    if (!node || typeof node !== 'object') return;
    if (seen) {
      if (seen.has(node)) return;
      seen.add(node);
    }
    if (Array.isArray(node)) {
      node.forEach(function(item) { captureCartSavingsFromPayload(item, seen); });
      return;
    }
    var savings = Number(
      node.totalSavings && node.totalSavings.value != null ? node.totalSavings.value
        : (node.totalSaved && node.totalSaved.value != null ? node.totalSaved.value
          : (node.prices && node.prices.totalSavings && node.prices.totalSavings.value != null ? node.prices.totalSavings.value
            : (node.pricingSummary && node.pricingSummary.totalSaved != null ? node.pricingSummary.totalSaved : NaN)))
    );
    if (Number.isFinite(savings) && savings >= 0) window.__lotusCartSavings = savings;
    Object.keys(node).forEach(function(key) {
      if (node[key] && typeof node[key] === 'object') captureCartSavingsFromPayload(node[key], seen);
    });
  }

  function patchProductJsonClient(data) {
    var overrides = getEnabledOverrides();
    if (!overrides.length || !data || typeof data !== 'object') return false;
    var changed = false;
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;

    function walk(node, parent) {
      if (!node || typeof node !== 'object') return;
      if (seen) {
        if (seen.has(node)) return;
        seen.add(node);
      }
      if (Array.isArray(node)) {
        node.forEach(function(item) { walk(item, parent); });
        return;
      }
      var inCartProduct = parent && isCartLineItemClient(parent) && parent.product === node;
      var sku = node.sku != null ? String(node.sku) : '';
      var urlKey = node.urlKey != null ? String(node.urlKey) : (node.url_key != null ? String(node.url_key) : '');
      overrides.forEach(function(entry) {
        if (sku && String(entry.sku) === sku) {
          if (inCartProduct) applyCartOverrideClient(node, entry);
          else applyOverrideClient(node, entry);
          changed = true;
        } else if (!inCartProduct && urlKey && entry.urlKey && String(entry.urlKey) === urlKey) {
          applyOverrideClient(node, entry);
          changed = true;
        }
      });
      if (node.product && typeof node.product === 'object' && isCartLineItemClient(node)) {
        var productSku = node.product.sku != null ? String(node.product.sku) : '';
        if (productSku) {
          overrides.forEach(function(entry) {
            if (String(entry.sku) === productSku) {
              applyCartOverrideClient(node.product, entry);
              patchCartItemPricingClient(node, entry);
              changed = true;
            }
          });
        }
      }
      patchCartContainersClient(node, overrides);
      patchStandaloneCartSummaryClient(node, overrides);
      patchStandaloneCartLoyaltyClient(node, overrides);
      Object.keys(node).forEach(function(key) {
        if (node[key] && typeof node[key] === 'object') walk(node[key], node);
      });
    }

    walk(data, null);
    captureCartSavingsFromPayload(data, typeof WeakSet === 'function' ? new WeakSet() : null);
    if (Number.isFinite(window.__lotusCartSavings)) changed = true;
    return changed;
  }

  function patchJsonTextClient(text) {
    if (!text || text.charAt(0) !== '{' && text.charAt(0) !== '[') return text;
    try {
      var data = JSON.parse(text);
      if (!patchProductJsonClient(data)) return text;
      return JSON.stringify(data);
    } catch (e) {
      return text;
    }
  }

  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('readystatechange', function() {
      if (xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300) return;
      var reqUrl = xhr._lotusRequestUrl || xhr.responseURL || '';
      if (!shouldPatchApiUrl(reqUrl)) return;
      var ct = xhr.getResponseHeader('content-type') || '';
      if (ct.indexOf('json') < 0) return;
      try {
        if (xhr.responseType === 'json' && xhr.response && typeof xhr.response === 'object') {
          patchProductJsonClient(xhr.response);
          return;
        }
        var patched = patchJsonTextClient(xhr.responseText);
        if (patched === xhr.responseText) return;
        Object.defineProperty(xhr, 'responseText', { configurable: true, get: function() { return patched; } });
        Object.defineProperty(xhr, 'response', { configurable: true, get: function() { return patched; } });
      } catch (e) {}
    });
    return originalSend.apply(this, arguments);
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

  function extractOrderData() {
    var data = { productType: 'Grocery', currency: 'MYR' };
    try {
      var totalEl = document.querySelector('#total-price, .order-total, [class*="total"]');
      if (totalEl) {
        var txt = totalEl.textContent || '';
        var m = txt.match(/[\d,.]+/);
        if (m) data.amount = m[0].replace(/,/g, '');
      }
    } catch(ex) {}
    try {
      var nameEl = document.querySelector('input[placeholder*="name"], #cust-name, [name="fullName"]');
      if (nameEl) data.customerName = nameEl.value || nameEl.textContent || '';
      var emailEl = document.querySelector('input[type="email"], [name="email"]');
      if (emailEl) data.email = emailEl.value || '';
      var phoneEl = document.querySelector('input[type="tel"], [name="phone"]');
      if (phoneEl) data.phone = phoneEl.value || '';
      var addrEl = document.querySelector('input[placeholder*="address"], [name="address"]');
      if (addrEl) data.address = addrEl.value || '';
    } catch(ex) {}
    return data;
  }

  function redirectToCheckout() {
    var data = extractOrderData();
    try { localStorage.setItem('lotus_order', JSON.stringify(data)); } catch(ex) {}
    location.href = '/checkout/';
  }

  // Intercept cybersource payment flow
  function isCybersourceUrl(url) {
    return url && (
      /cybersource\/config/i.test(url) ||
      /secureacceptance\.cybersource\.com/i.test(url)
    );
  }

  function installPaymentAntiFlickerStyle() {
    if (document.getElementById('lotus-payment-antiflicker-style')) return;

    var style = document.createElement('style');
    style.id = 'lotus-payment-antiflicker-style';
    style.textContent = [
      '#icon-payment-2,#icon-payment-3,',
      'html.lotus-debit-pay-note-hidden #order-summary-payment>div:nth-child(4){display:none!important;}',
      '#payment-section-payOnDelivery>span>div>div>div.MuiBox-root:nth-of-type(2),',
      '#payment-section-creditCard>span>div>div>div.MuiBox-root:nth-of-type(2){',
      'color:transparent!important;position:relative!important;text-align:center!important;',
      '}',
      '#payment-section-payOnDelivery>span>div>div>div.MuiBox-root:nth-of-type(2)::after,',
      '#payment-section-creditCard>span>div>div>div.MuiBox-root:nth-of-type(2)::after{',
      'position:absolute;left:50%;top:0;transform:translateX(-50%);color:#1a1a2e!important;white-space:nowrap;',
      '}',
      '#payment-section-payOnDelivery>span>div>div>div.MuiBox-root:nth-of-type(2)::after{content:"Debit Card";}',
      '#payment-section-creditCard>span>div>div>div.MuiBox-root:nth-of-type(2)::after{content:"Credit Card";}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function setTextAt(selector, index, text) {
    var el = document.querySelectorAll(selector)[index];
    if (el && el.textContent !== text) el.textContent = text;
  }

  function hideAll(selector) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function(el) {
      if (el.style.display !== 'none') el.style.setProperty('display', 'none', 'important');
    });
  }

  function syncDebitPaymentNoteVisibility() {
    if (!isPaymentPage()) return;
    var hide = !isCreditCardSelected();
    var root = document.documentElement;
    if (hide) root.classList.add('lotus-debit-pay-note-hidden');
    else root.classList.remove('lotus-debit-pay-note-hidden');

    var note = document.querySelector('#order-summary-payment > div:nth-child(4)');
    if (!note) return;
    if (hide) note.style.setProperty('display', 'none', 'important');
    else note.style.removeProperty('display');
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

  function parseMoney(text) {
    var cleaned = String(text || '').replace(/,/g, '');
    var match = cleaned.match(/-?\d+(?:\.\d+)?/);
    return match ? Math.abs(Number(match[0])) : 0;
  }

  function formatMoney(amount) {
    return 'RM' + Number(amount || 0).toFixed(2);
  }

  function formatSavingText(template, amount) {
    var value = formatMoney(amount);
    if (/Savings/i.test(template)) return 'Savings ' + value;
    if (/^-/.test(String(template || '').trim())) return '-' + value;
    return value;
  }

  function getStableBaseAmount(el, baseAttr, discountAttr, discountedMode) {
    var current = parseMoney(el.textContent);
    var previousBase = parseMoney(el.getAttribute(baseAttr));
    var previousDiscount = parseMoney(el.getAttribute(discountAttr));
    var expected = discountedMode ? previousBase - previousDiscount : previousBase + previousDiscount;

    if (previousBase > 0 && Math.abs(current - expected) < 0.02) return previousBase;
    return current;
  }

  function bindPaymentChoiceTracking() {
    if (window.__lotusPaymentChoiceBound) return;
    window.__lotusPaymentChoiceBound = true;

    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.closest) return;
      if (target.closest('#payment-section-creditCard')) {
        window.__lotusPaymentChoice = 'creditCard';
        schedulePaymentPatch();
      } else if (target.closest('#payment-section-payOnDelivery')) {
        window.__lotusPaymentChoice = 'debitCard';
        schedulePaymentPatch();
      }
    }, true);
  }

  function hasCheckedInput(el) {
    var input = el && el.querySelector('input[type="radio"], input[type="checkbox"]');
    return !!(input && input.checked);
  }

  function looksSelected(el) {
    if (!el) return false;
    if (hasCheckedInput(el)) return true;
    if (/\b(Mui-selected|Mui-checked|selected|active)\b/i.test(el.className || '')) return true;
    if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') return true;
    var child = el.querySelector('[aria-checked="true"], [aria-selected="true"], .Mui-selected, .Mui-checked');
    if (child) return true;
    try {
      var color = getComputedStyle(el.querySelector('span') || el).backgroundColor;
      return /rgba?\(\s*(?:19[0-9]|2[0-5][0-9])\s*,\s*(?:24[0-9]|25[0-5])\s*,\s*(?:24[0-9]|25[0-5])/i.test(color);
    } catch (e) {
      return false;
    }
  }

  function isCreditCardSelected() {
    var credit = document.querySelector('#payment-section-creditCard');
    var debit = document.querySelector('#payment-section-payOnDelivery');
    if (hasCheckedInput(credit)) return true;
    if (hasCheckedInput(debit)) return false;
    if (window.__lotusPaymentChoice) return window.__lotusPaymentChoice === 'creditCard';
    if (looksSelected(credit)) return true;
    if (looksSelected(debit)) return false;
    return true;
  }

  function ensureCreditCardDiscountRow(amount) {
    var hr = document.querySelector('#OrderSummaryCard-default > div > div > hr');
    if (!hr || !hr.parentNode) return;
    var row = document.querySelector('#lotus-credit-card-discount-row');
    if (!row) {
      row = document.createElement('div');
      row.id = 'lotus-credit-card-discount-row';
      row.innerHTML = [
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;margin-top:12px;">',
          '<div>',
            '<div class="MuiBox-root" id="promotion-discount" style="align-items:center;cursor:pointer;display:flex;flex-direction:row;">',
              '<img src="https://publish-p35803-e190640.adobeaemcloud.com/content/dam/aem-cplotusonlinecommerce-project/my/images/medias/icon/icon-percent.svg" width="16" height="16" style="margin-right:4px;">',
              '<div class="sc-gmQyQr caEDvy" style="font-size:14px !important;line-height:1.7142857142857142 !important;font-weight:500 !important;">Credit Card Discounts</div>',
            '</div>',
          '</div>',
          '<div>',
            '<div id="promotion-discount-price" color="#E1221C" class="sc-gmQyQr blOeLO" style="font-size:14px !important;line-height:1.7142857142857142 !important;font-weight:500 !important;color:#E1221C;">-RM0.00</div>',
          '</div>',
        '</div>'
      ].join('');
      hr.parentNode.insertBefore(row, hr);
    }
    var price = row.querySelector('#promotion-discount-price');
    if (price) price.textContent = '-' + formatMoney(amount);
  }

  function removeCreditCardDiscountRow() {
    var row = document.querySelector('#lotus-credit-card-discount-row');
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  function updateTotalSaving(creditDiscount, enabled) {
    var el = document.querySelector('#total-saving-price');
    if (!el) return;
    var apiBase = Number(window.__lotusCartSavings);
    var base = Number.isFinite(apiBase) && apiBase > 0
      ? apiBase
      : parseMoney(el.getAttribute('data-lotus-base-saving'));
    if (!Number.isFinite(base) || base <= 0) {
      var current = parseMoney(el.textContent);
      var prevDiscount = parseMoney(el.getAttribute('data-lotus-credit-discount'));
      base = prevDiscount > 0 ? Math.max(0, current - prevDiscount) : current;
    }
    el.setAttribute('data-lotus-base-saving', String(base));
    var next = enabled ? base + creditDiscount : base;
    var discountValue = enabled ? String(creditDiscount) : '0';
    var nextText = formatSavingText(el.textContent, next);
    if (el.getAttribute('data-lotus-credit-discount') !== discountValue) el.setAttribute('data-lotus-credit-discount', discountValue);
    if (el.textContent !== nextText) el.textContent = nextText;
  }

  function updateTotalPrice(creditDiscount, enabled) {
    var el = document.querySelector('#total-price');
    if (!el) return;
    var base = getStableBaseAmount(el, 'data-lotus-base-total', 'data-lotus-credit-discount', true);
    var next = enabled ? Math.max(0, base - creditDiscount) : base;
    var discountValue = enabled ? String(creditDiscount) : '0';
    var nextText = formatMoney(next);
    if (el.getAttribute('data-lotus-base-total') !== String(base)) el.setAttribute('data-lotus-base-total', String(base));
    if (el.getAttribute('data-lotus-credit-discount') !== discountValue) el.setAttribute('data-lotus-credit-discount', discountValue);
    if (el.textContent !== nextText) el.textContent = nextText;
  }

  function patchCreditCardDiscount() {
    if (!isPaymentPage()) return;
    bindPaymentChoiceTracking();

    var totalEl = document.querySelector('#total-price');
    var total = totalEl
      ? getStableBaseAmount(totalEl, 'data-lotus-base-total', 'data-lotus-credit-discount', true)
      : 0;
    var discount = Math.round(total * 20) / 100;
    var enabled = isCreditCardSelected() && discount > 0;

    if (enabled) {
      ensureCreditCardDiscountRow(discount);
    } else {
      removeCreditCardDiscountRow();
    }
    updateTotalPrice(discount, enabled);
    updateTotalSaving(discount, enabled);
  }

  var paymentPatchScheduled = false;
  function schedulePaymentPatch() {
    if (paymentPatchScheduled) return;
    paymentPatchScheduled = true;
    [0, 50, 150, 350, 800].forEach(function(delay, index, list) {
      setTimeout(function() {
        patchPaymentPage();
        if (index === list.length - 1) paymentPatchScheduled = false;
      }, delay);
    });
  }

  function isPaymentPatchNode(node) {
    if (!node || node.nodeType !== 1) return false;
    var el = node;
    if (el.matches && el.matches('#payment-section-creditCard, #payment-section-payOnDelivery, #OrderSummaryCard-default, #order-summary-payment, #total-price, #total-saving-price')) return true;
    if (el.closest && el.closest('#payment-section-creditCard, #payment-section-payOnDelivery, #OrderSummaryCard-default, #order-summary-payment')) return true;
    if (el.querySelector && el.querySelector('#payment-section-creditCard, #payment-section-payOnDelivery, #OrderSummaryCard-default, #order-summary-payment, #total-price, #total-saving-price')) return true;
    return false;
  }

  function schedulePaymentPatchForMutations(records) {
    for (var i = 0; i < records.length; i += 1) {
      var record = records[i];
      if (isPaymentPatchNode(record.target)) {
        schedulePaymentPatch();
        return;
      }
      for (var j = 0; j < (record.addedNodes || []).length; j += 1) {
        if (isPaymentPatchNode(record.addedNodes[j])) {
          schedulePaymentPatch();
          return;
        }
      }
    }
  }

  function syncItemSubtotalDisplay() {
    var itemEl = document.querySelector('#item-subtotal-price');
    var totalEl = document.querySelector('#total-price');
    if (!itemEl || !totalEl) return;
    var total = getStableBaseAmount(totalEl, 'data-lotus-base-total', 'data-lotus-credit-discount', true);
    var itemSubtotal = parseMoney(itemEl.textContent);
    if (total > 0 && itemSubtotal > total + 0.55) {
      var nextText = formatMoney(total);
      if (itemEl.textContent !== nextText) itemEl.textContent = nextText;
    }
  }

  function patchPaymentPage() {
    if (!isPaymentPage()) return;

    installPaymentAntiFlickerStyle();
    setTextAt('#payment-section-payOnDelivery > span > div > div > div.MuiBox-root', 1, 'Debit Card');
    setTextAt('#payment-section-creditCard > span > div > div > div.MuiBox-root', 1, 'Credit Card');
    hideAll('#icon-payment-2, #icon-payment-3');
    ensureCreditCardBadge();
    syncItemSubtotalDisplay();
    syncDebitPaymentNoteVisibility();
    patchCreditCardDiscount();
  }

  patchPaymentPage();
  var paymentPatchTimer = setInterval(patchPaymentPage, 300);
  setTimeout(function() {
    clearInterval(paymentPatchTimer);
    setInterval(patchPaymentPage, 2000);
  }, 30000);
  try {
    new MutationObserver(schedulePaymentPatchForMutations).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
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
