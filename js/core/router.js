// js/core/router.js
export function createRouter({ routes, defaultPath = '/fish' }) {
  function parseHash() {
    const raw = location.hash.slice(1) || defaultPath;
    const [path, query = ''] = raw.split('?');
    // Принимаем только пути, начинающиеся с "/" — всё прочее (skip-link, пусто)
    // уводим на defaultPath
    const safePath = path.startsWith('/') ? path : defaultPath;
    return { path: safePath, query };
  }

  function findRoute(path) {
    return routes.find(r => r.path === path)
        || routes.find(r => r.path === defaultPath)
        || routes[0];
  }

  function render() {
    const { path, query } = parseHash();
    const route = findRoute(path);
    const main = document.getElementById('main');
    if (!main) return;

    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.toggle('app-nav__item--active', el.dataset.route === route.path);
    });

    try {
      main.innerHTML = '';
      route.render(main, { path, query });
      if (route.title) document.title = `${route.title} • Клёв ПРО`;
    } catch (err) {
      console.error('[router]', err);
      main.innerHTML = '<div class="module-placeholder"><p>Не удалось загрузить раздел.</p></div>';
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function navigate(path) {
    if (location.hash !== '#' + path) location.hash = path;
    else render();
  }

  function start() {
    window.addEventListener('hashchange', render);
    // Всегда рендерим первый раз, даже если hash уже какой-то невалидный
    if (!location.hash || !location.hash.startsWith('#/')) {
      location.hash = defaultPath;
    }
    render();
  }

  return { navigate, render, start };
}