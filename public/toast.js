(function () {
  var container = null;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'triToastContainer';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    return container;
  }

  function triToast(message, type) {
    var el = document.createElement('div');
    el.className = 'tri-toast tri-toast-' + (type || 'info');
    el.textContent = message;
    ensureContainer().appendChild(el);
    requestAnimationFrame(function () { el.classList.add('tri-toast-show'); });
    setTimeout(function () {
      el.classList.remove('tri-toast-show');
      setTimeout(function () { el.remove(); }, 300);
    }, 4000);
  }

  window.triToast = triToast;
  window.triToast.success = function (msg) { triToast(msg, 'success'); };
  window.triToast.error = function (msg) { triToast(msg, 'error'); };
  window.triToast.info = function (msg) { triToast(msg, 'info'); };

  var nativeAlert = window.alert;
  window.alert = function (message) {
    if (typeof message === 'string' && message.length) {
      triToast(message, 'info');
    } else {
      nativeAlert(message);
    }
  };
})();
