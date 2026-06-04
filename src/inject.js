(function(){
  'use strict';
  window.CIF = window.CIF || {};
  window.CIF.CommerceGraphqlEndpoint = '/graphql';
  window.CIF.storeView = 'default';
  window.__magentoStoreConfig = { graphqlEndpoint: '/graphql', storeView: 'default' };

  window.addEventListener('error', function(e) {
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
})();
