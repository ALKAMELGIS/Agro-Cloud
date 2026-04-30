
const search = async () => {
  try {
    const response = await fetch('/api/stac/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox: [55.2, 25.2, 55.3, 25.3],
        datetime: '2024-01-01T00:00:00Z/2024-01-31T23:59:59Z',
        limit: 1
      })
    });
    const data = await response.json();
    console.log(JSON.stringify(data.features[0].assets, null, 2));
  } catch (e) {
    console.error(e);
  }
};

search();
