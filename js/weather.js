// Manila weather from Open-Meteo (free, no key). Shows the current weather in the header, next to "updated ...".
(function () {
  var M = window.Moriyada = window.Moriyada || {};

  M.WEATHER_URL = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=14.5995&longitude=120.9842&timezone=Asia%2FManila' +
    '&current=temperature_2m,relative_humidity_2m,weather_code';

  // Open-Meteo sends a number code; these are the words for it.
  var CODES = {
    0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers',
    95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail'
  };
  M.weatherText = function (code) { return CODES[code] || 'unknown weather'; };

  // Resolves to the raw Open-Meteo reply.
  M.fetchWeather = function () {
    return (M.fetch || fetch)(M.WEATHER_URL).then(function (r) {
      if (!r.ok) throw new Error('weather ' + r.status);
      return r.json();
    });
  };

  // Save today's Manila weather once per day into day_weather (shown on that day's page).
  // Runs from the posting page with the logged-in connection: only the owner may write
  // weather, so visitors can't fill it with fake data. Saves the day's forecast high and
  // overall condition the first time the posting page is opened that day.
  M.WEATHER_DAY_URL = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=14.5995&longitude=120.9842&timezone=Asia%2FManila&forecast_days=1' +
    '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min';

  M.saveTodayWeather = async function (client) {
    var today = M.manilaDate();
    var KEY = 'moriyada-weather-saved';
    try { if (localStorage.getItem(KEY) === today) return 'already saved'; } catch (e) { /* fine */ }
    var have = await M.withTimeout(client.from('day_weather').select('weather_date').eq('weather_date', today).maybeSingle(), 10000, 'weather check');
    if (have.error) throw have.error;
    if (!have.data) {
      var r = await (M.fetch || fetch)(M.WEATHER_DAY_URL);
      if (!r.ok) throw new Error('weather ' + r.status);
      var w = await r.json();
      var d = w.daily || {};
      if (!d.time || d.time[0] !== today) return 'forecast is for another day';
      var res = await M.withTimeout(client.from('day_weather').upsert({
        weather_date: today,
        summary: M.weatherText(d.weather_code[0]),
        temp_c: d.temperature_2m_max[0],
        data: {
          high_c: d.temperature_2m_max[0], low_c: d.temperature_2m_min[0], code: d.weather_code[0],
          saved_at: new Date().toISOString(), current: w.current || null
        }
      }, { onConflict: 'weather_date', ignoreDuplicates: true }), 10000, 'weather save');
      if (res.error) throw res.error;
    }
    try { localStorage.setItem(KEY, today); } catch (e) { /* fine */ }
    return 'saved';
  };

  document.addEventListener('DOMContentLoaded', function () {
    var line = document.getElementById('weather');
    if (!line) return;
    M.fetchWeather().then(function (w) {
      var c = w.current || {};
      line.textContent = 'Manila: ' + Math.round(c.temperature_2m) + '°C, ' +
        M.weatherText(c.weather_code) + ', humidity ' + Math.round(c.relative_humidity_2m) + '%';
    }).catch(function () {
      line.hidden = true;   // no weather is fine; no need to say so
    });
  });
})();
