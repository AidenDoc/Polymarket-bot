const axios = require('axios');

async function find() {
  let cursor, series = {};
  let pages = 0;
  do {
    const params = { limit: 200, status: 'open' };
    if (cursor) params.cursor = cursor;
    const r = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets', { params });
    for (const m of r.data.markets) {
      const prefix = m.ticker.split('-')[0];
      series[prefix] = (series[prefix] || 0) + 1;
    }
    cursor = r.data.cursor;
    pages++;
    console.log('Page', pages, '- unique series so far:', Object.keys(series).length);
  } while (cursor && pages < 50);
  
  console.log('\nAll series found:');
  Object.entries(series).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(v, k));
}
find().catch(e => console.log(e.message));
