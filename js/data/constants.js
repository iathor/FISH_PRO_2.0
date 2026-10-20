export const APP_VERSION = '2.0.0';
export const CACHE_VERSION = 'v2.0.0';
export const IMG_SEARCH_DIRS = ['assets/fish/', 'fish/', ''];

export const MAP_LAYERS = {
  topo:  { label: 'Топокарта', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr: '© OpenTopoMap', maxZoom: 17 },
  sat:   { label: 'Спутник',   url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri', maxZoom: 18 },
  carto: { label: 'Схема',     url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: '© CARTO', maxZoom: 18 },
  osm:   { label: 'OSM',       url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap', maxZoom: 18 }
};

export const DEFAULT_LOCATION = {
  lat: 66.0845, lon: 76.6809,
  country: 'Россия', admin1: 'ЯНАО', admin2: 'Новый Уренгой',
  label: 'Новый Уренгой', basinCode: 'arctic_ob_taz'
};

export const ROUTES = [
  { path: '/fish',     title: 'Пазл рыбы',        navLabel: 'Рыбы',      icon: 'fish' },
  { path: '/geo',      title: 'Геолокация',       navLabel: 'Карта',     icon: 'map' },
  { path: '/weather',  title: 'Погода и Луна',    navLabel: 'Погода',    icon: 'weather' },
  { path: '/forecast', title: 'Прогноз клёва',    navLabel: 'Прогноз',   icon: 'forecast' },
  { path: '/calendar', title: 'Годовой календарь',navLabel: 'Календарь', icon: 'calendar' },
  { path: '/log',      title: 'Журнал уловов',    navLabel: 'Журнал',    icon: 'log' }
];

export const THEME_MODES = ['auto', 'dark', 'light'];