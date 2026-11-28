// Bulby Music Assistant Engine
// Connects to live public Music APIs (Apple Music / iTunes Charts & Search API)
// to answer questions about Mexico Top Charts, Global Top Charts, and New Releases by any Artist/Band.

class BulbyAssistant {
  constructor() {
    this.cachedCharts = {
      mx: null,
      us: null
    };
  }

  // Fetch live Top Songs Chart for a country ('mx' = Mexico, 'us' = Global/International)
  async fetchTopChart(country = 'mx', limit = 15) {
    try {
      // iTunes RSS Top Songs feed (supports CORS directly in browser & Android WebView)
      const rssUrl = `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/json`;
      const res = await fetch(rssUrl);
      if (!res.ok) throw new Error('RSS fetch error');
      const data = await res.json();
      const entries = data?.feed?.entry || [];

      const tracks = entries.map((e, idx) => {
        const imgs = e['im:image'] || [];
        const rawCover = imgs.length ? imgs[imgs.length - 1].label : '';
        const hiResCover = rawCover.replace(/\/\d+x\d+bb\./, '/600x600bb.');

        // Extract 30-sec audio preview link if included in RSS links
        let previewUrl = '';
        if (Array.isArray(e.link)) {
          const audioLink = e.link.find((l) => l?.attributes?.type?.includes('audio') || l?.attributes?.rel === 'enclosure');
          if (audioLink?.attributes?.href) previewUrl = audioLink.attributes.href;
        }

        const relDate = e['im:releaseDate']?.attributes?.label || e['im:releaseDate']?.label || '';

        return {
          rank: idx + 1,
          id: `chart_${country}_${e.id?.attributes?.['im:id'] || idx}`,
          title: e['im:name']?.label || 'Canción',
          artist: e['im:artist']?.label || 'Artista',
          album: e['im:collection']?.['im:name']?.label || 'Top Chart',
          genre: e.category?.attributes?.label || 'Pop',
          coverUrl: hiResCover,
          audioUrl: previewUrl,
          releaseDate: relDate,
          isPreview: true,
          country: country.toUpperCase()
        };
      });

      this.cachedCharts[country] = tracks;
      return tracks;
    } catch (err) {
      console.warn('Fallback to iTunes Search chart query:', err);
      return this.searchLatestByArtist(country === 'mx' ? 'Junior H Peso Pluma' : 'Top Hits 2026', limit);
    }
  }

  // Search latest releases or top tracks by a specific artist/band from the internet
  async searchLatestByArtist(artistQuery, limit = 12) {
    const q = encodeURIComponent(artistQuery.trim());
    const url = `https://itunes.apple.com/search?term=${q}&country=mx&entity=song&limit=35`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo consultar el catálogo en línea');
    const data = await res.json();
    const results = data.results || [];

    // Sort by newest releaseDate first so Bulby shows the freshest releases
    results.sort((a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0));

    const seen = new Set();
    const clean = [];
    for (const r of results) {
      const key = `${(r.trackName || '').toLowerCase()}_${(r.artistName || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const d = r.releaseDate ? new Date(r.releaseDate) : null;
      const formattedDate = d
        ? d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';

      clean.push({
        id: `live_${r.trackId || Math.random().toString(36).slice(2)}`,
        title: r.trackName || 'Canción',
        artist: r.artistName || artistQuery,
        album: r.collectionName || 'Sencillo',
        genre: r.primaryGenreName || 'Música',
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 30,
        coverUrl: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
        audioUrl: r.previewUrl || '',
        releaseDate: formattedDate,
        rawReleaseDate: r.releaseDate || '',
        isPreview: true
      });
      if (clean.length >= limit) break;
    }

    return clean;
  }

  // Process a natural-language question sent to Bulby in the chat modal
  async askBulby(userText, localTracks = []) {
    const text = userText.trim();
    const lower = text.toLowerCase();

    // 1. Check if asking for Mexico Top Charts
    if (
      lower.includes('méxico') ||
      lower.includes('mexico') ||
      lower.includes('top mx') ||
      (lower.includes('más sonadas') && !lower.includes('mundial'))
    ) {
      const chart = await this.fetchTopChart('mx', 10);
      return {
        mood: 'cool',
        reply: `🇲🇽 ¡Aquí tienes el **Top 10 de las canciones más escuchadas en México hoy** en vivo desde internet! Toca cualquiera para escuchar su adelanto (o la versión completa si está en tu Supabase):`,
        tracks: chart
      };
    }

    // 2. Check if asking for Global / World Charts
    if (
      lower.includes('mundial') ||
      lower.includes('global') ||
      lower.includes('mundo') ||
      lower.includes('chart') ||
      lower.includes('top')
    ) {
      const chart = await this.fetchTopChart('us', 10);
      return {
        mood: 'sing',
        reply: `🌍 ¡Este es el **Top 10 Global / Internacional** en tendencia ahora mismo! Puedes reproducir cualquier pista:`,
        tracks: chart
      };
    }

    // 3. Check if asking for New Music / Latest Releases by an Artist or Band
    let artistTarget = text
      .replace(/¿|\?/g, '')
      .replace(/qu[eé]\s+(m[uú]sica\s+)?(nueva|nuevo)\s+(sac[oó]|tiene|lanz[oó])/i, '')
      .replace(/nuevos?\s+lanzamientos?\s+de/i, '')
      .replace(/canciones\s+(nuevas|de)/i, '')
      .replace(/recomi[eé]ndame\s+(algo\s+de|m[uú]sica\s+de)?/i, '')
      .replace(/busca\s+a?/i, '')
      .trim();

    if (!artistTarget || artistTarget.length < 2) {
      artistTarget = 'Junior H';
    }

    const latest = await this.searchLatestByArtist(artistTarget, 8);
    if (latest.length > 0) {
      const newest = latest[0];
      return {
        mood: 'love',
        reply: `✨ Busqué en internet lo más reciente de **${newest.artist}**.\nSu lanzamiento más nuevo registrado es **"${newest.title}"** (Álbum/Sencillo: *${newest.album}* · ${newest.releaseDate || 'Reciente'}). ¡Aquí tienes sus últimos lanzamientos para escuchar!`,
        tracks: latest
      };
    }

    return {
      mood: 'sing',
      reply: `🎵 No encontré resultados exactos en línea para "${text}", ¡pero puedes preguntarme por el **Top México**, **Top Mundial**, o poner el nombre de cualquier artista o banda (por ejemplo: *"¿Qué música nueva sacó Junior H?"* o *"The Warning"*)!`,
      tracks: localTracks.slice(0, 4)
    };
  }
}

window.bulbyAssistant = new BulbyAssistant();
