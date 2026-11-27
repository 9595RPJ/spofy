// Main Application Logic for "Tu música, a tu ritmo"
// Implements the 4 screens (01 Inicio, 02 Buscar, 03 Tu biblioteca, 04 Crear),
// Full Audio Engine, Playlists, Favorites, Cloud Uploader & Offline Cache.

const DEFAULT_TRACKS = [
  {
    id: 'trk_junior_h_las_noches',
    title: 'LAS NOCHES',
    artist: 'Junior H',
    album: '$AD BOYZ 4 LIFE II',
    category: 'Música',
    genre: 'Pop',
    duration: 226,
    liked: true,
    provider: 'supabase',
    coverUrl: 'https://jmtdskkkximvhbtxgunp.supabase.co/storage/v1/object/public/audios/covers/junior_h_las_noches.jpg',
    audioUrl: 'https://jmtdskkkximvhbtxgunp.supabase.co/storage/v1/object/public/audios/tracks/junior_h_las_noches.flac'
  }
];

const DEFAULT_PLAYLISTS = [
  {
    id: 'pl_1',
    name: '$AD BOYZ 4 LIFE II',
    subtitle: 'Playlist · 1 canción',
    pinned: true,
    coverUrl: 'https://jmtdskkkximvhbtxgunp.supabase.co/storage/v1/object/public/audios/covers/junior_h_las_noches.jpg',
    trackIds: ['trk_junior_h_las_noches']
  }
];

const DEFAULT_RECENT_SEARCHES = [
  {
    id: 'rs_1',
    name: 'Junior H',
    coverUrl: 'https://jmtdskkkximvhbtxgunp.supabase.co/storage/v1/object/public/audios/covers/junior_h_las_noches.jpg'
  }
];

class RitmoApp {
  constructor() {
    this.tracks = [];
    this.playlists = [];
    this.recentSearches = [];
    this.homeFilter = 'all';
    this.libraryFilter = 'playlists';

    // Audio playback state
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.queue = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.shuffle = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.playbackSpeeds = [1, 1.25, 1.5, 2, 0.75];
    this.speedIndex = 0;

    // Create playlist & upload temporary state
    this.selectedTrackIdsForNewPlaylist = new Set();
    this.pendingPlaylistCoverFile = null;
    this.pendingAudioCoverFile = null;
    this.detectedAudioDuration = 210;
    this.isListenerMode = true; // Always start in clean User (Listener) mode by default!
    this.secretPin = '1234';
    this.avatarTapCount = 0;
    this.avatarTapTimer = null;
  }

  async init() {
    document.body.classList.add('listener-mode');
    await window.storageEngine.init();
    this.loadLocalState();
    await this.syncFromSupabaseOnStartup();
    this.bindAudioEvents();
    this.bindUIEvents();
    this.applyUserConfigToUI();
    await this.renderAll();

    if (this.tracks.length > 0) {
      this.queue = [...this.tracks];
      await this.loadTrack(0, false);
    }
  }

  async syncFromSupabaseOnStartup() {
    if (!window.storageEngine.config.supabaseUrl || !window.storageEngine.config.supabaseAnonKey) return;
    try {
      const remoteTracks = await window.storageEngine.fetchTracksFromSupabase();
      if (remoteTracks && remoteTracks.length) {
        const byId = new Map();
        remoteTracks.forEach((rt) => byId.set(rt.id, rt));
        this.tracks.forEach((lt) => {
          if (!byId.has(lt.id)) byId.set(lt.id, lt);
        });
        this.tracks = Array.from(byId.values());
        this.saveLocalState();
      }
    } catch (e) {
      console.warn('Supabase startup sync warning:', e.message);
    }
  }

  loadLocalState() {
    const savedTracks = localStorage.getItem('ritmo_tracks');
    const savedPlaylists = localStorage.getItem('ritmo_playlists');
    const savedSearches = localStorage.getItem('ritmo_recent_searches');

    // Filter out old SoundHelix demo tracks if they were cached in localStorage
    const demoIds = new Set(['trk_1', 'trk_2', 'trk_3', 'trk_4', 'trk_5']);
    if (savedTracks) {
      const parsed = JSON.parse(savedTracks).filter(
        (t) => !demoIds.has(t.id) && !(t.audioUrl && t.audioUrl.includes('soundhelix.com'))
      );
      this.tracks = parsed.length ? parsed : [...DEFAULT_TRACKS];
    } else {
      this.tracks = [...DEFAULT_TRACKS];
    }

    if (!this.tracks.some((t) => t.id === 'trk_junior_h_las_noches')) {
      this.tracks.unshift(DEFAULT_TRACKS[0]);
    }

    if (savedPlaylists) {
      const demoPlIds = new Set(['pl_1', 'pl_2', 'pl_3', 'pl_4']);
      const parsedPl = JSON.parse(savedPlaylists).filter((p) => !demoPlIds.has(p.id) || p.name === '$AD BOYZ 4 LIFE II');
      this.playlists = parsedPl.length ? parsedPl : [...DEFAULT_PLAYLISTS];
    } else {
      this.playlists = [...DEFAULT_PLAYLISTS];
    }

    this.recentSearches = savedSearches
      ? JSON.parse(savedSearches).filter((r) => r.name !== 'The Warning' && r.name !== 'Luis Miguel')
      : [...DEFAULT_RECENT_SEARCHES];
    if (!this.recentSearches.length) this.recentSearches = [...DEFAULT_RECENT_SEARCHES];
    this.saveLocalState();
  }

  saveLocalState() {
    localStorage.setItem('ritmo_tracks', JSON.stringify(this.tracks));
    localStorage.setItem('ritmo_playlists', JSON.stringify(this.playlists));
    localStorage.setItem('ritmo_recent_searches', JSON.stringify(this.recentSearches));
  }

  showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // ==================== AUDIO ENGINE ====================
  bindAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      const cur = this.audio.currentTime || 0;
      const dur = this.audio.duration || (this.getCurrentTrack()?.duration || 200);
      const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

      document.getElementById('mini-progress-fill').style.width = `${pct}%`;
      document.getElementById('fp-seek-slider').value = pct;
      document.getElementById('fp-current-time').textContent = this.formatTime(cur);
      document.getElementById('fp-total-time').textContent = this.formatTime(dur);
    });

    this.audio.addEventListener('ended', () => {
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.nextTrack();
      }
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayIcons();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayIcons();
    });
  }

  getCurrentTrack() {
    return this.queue[this.currentIndex] || this.tracks[0];
  }

  async loadTrack(index, autoPlay = true) {
    if (!this.queue.length) this.queue = [...this.tracks];
    if (index < 0) index = this.queue.length - 1;
    if (index >= this.queue.length) index = 0;
    this.currentIndex = index;

    const track = this.getCurrentTrack();
    if (!track) return;

    const playableUrl = await window.storageEngine.resolvePlayableUrl(track);
    const coverUrl = (await window.storageEngine.resolveCoverUrl(track.coverUrl)) ||
      'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=600&q=80';

    this.audio.src = playableUrl;
    this.audio.playbackRate = this.playbackSpeeds[this.speedIndex];

    // Update Mini-Player & Full-Player UI
    document.getElementById('mini-title').textContent = track.title;
    document.getElementById('mini-artist').textContent = track.album ? `${track.artist} · ${track.album}` : track.artist;
    document.getElementById('mini-cover').src = coverUrl;

    document.getElementById('fp-title').textContent = track.title;
    document.getElementById('fp-artist').textContent = track.artist;
    const fpAlbum = document.getElementById('fp-album');
    if (fpAlbum) {
      fpAlbum.textContent = track.album ? `Álbum: ${track.album} · ${this.formatTime(track.duration)}` : '';
    }
    document.getElementById('fp-cover').src = coverUrl;
    document.getElementById('fp-total-time').textContent = this.formatTime(track.duration || 210);

    this.updateLikeButtons();
    await this.updateOfflineButtonState(track);
    this.renderHomeTracks();

    if (autoPlay) {
      try {
        await this.audio.play();
      } catch (err) {
        console.warn('Autoplay blocked until user gesture:', err);
      }
    }
  }

  async togglePlay() {
    if (!this.audio.src && this.tracks.length) {
      await this.loadTrack(0, true);
      return;
    }
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch (e) {
        this.showToast('Toca de nuevo para reproducir');
      }
    } else {
      this.audio.pause();
    }
  }

  async nextTrack() {
    if (!this.queue.length) return;
    if (this.shuffle && this.queue.length > 1) {
      let rand = Math.floor(Math.random() * this.queue.length);
      if (rand === this.currentIndex) rand = (rand + 1) % this.queue.length;
      await this.loadTrack(rand, true);
    } else {
      await this.loadTrack((this.currentIndex + 1) % this.queue.length, true);
    }
  }

  async prevTrack() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    await this.loadTrack((this.currentIndex - 1 + this.queue.length) % this.queue.length, true);
  }

  updatePlayIcons() {
    const playSvg = '<polygon points="6 4 20 12 6 20 6 4"/>';
    const pauseSvg = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    document.getElementById('mini-play-icon').innerHTML = this.isPlaying ? pauseSvg : playSvg;
    document.getElementById('fp-play-icon').innerHTML = this.isPlaying ? pauseSvg : playSvg;
  }

  updateLikeButtons() {
    const track = this.getCurrentTrack();
    const liked = Boolean(track && track.liked);
    const miniBtn = document.getElementById('mini-like-btn');
    const fpBtn = document.getElementById('fp-like-btn');

    miniBtn.style.color = liked ? 'var(--accent-red)' : 'var(--text-primary)';
    miniBtn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');

    fpBtn.style.color = liked ? 'var(--accent-red)' : 'var(--text-primary)';
    fpBtn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  }

  async updateOfflineButtonState(track) {
    const btn = document.getElementById('fp-offline-btn');
    const blobId = track.blobId || `offline_${track.id}`;
    const isCached = (track.audioUrl && track.audioUrl.startsWith('idb://')) ||
      (await window.storageEngine.hasBlob(blobId));

    if (isCached) {
      btn.classList.add('cached');
      btn.textContent = '✓ Disponible Offline';
    } else {
      btn.classList.remove('cached');
      btn.textContent = '↓ Guardar Offline';
    }
  }

  // ==================== RENDERING SCREENS ====================
  async renderAll() {
    this.renderHomeRecentCards();
    await this.renderHomeTracks();
    this.renderRecentSearches();
    await this.renderLibrary();
    this.renderPlaylistTrackPicker();
  }

  renderHomeRecentCards() {
    const container = document.getElementById('home-recent-cards');
    const cards = [
      {
        title: 'Mix de los 90',
        img: 'https://images.unsplash.com/photo-1594623930572-300a3011d9ae?auto=format&fit=crop&w=500&q=80',
        genre: 'Pop'
      },
      {
        title: 'Rock en español',
        img: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=500&q=80',
        genre: 'Rock'
      }
    ];
    container.innerHTML = cards
      .map(
        (c, i) => `
      <div class="square-card" data-card-idx="${i}">
        <img src="${c.img}" alt="${c.title}" />
        <div class="square-card-overlay">
          <span class="square-card-title">${c.title}</span>
        </div>
      </div>`
      )
      .join('');

    container.querySelectorAll('.square-card').forEach((el, idx) => {
      el.addEventListener('click', () => {
        const g = cards[idx].genre;
        const filtered = this.tracks.filter((t) => t.genre === g);
        this.queue = filtered.length ? filtered : [...this.tracks];
        this.loadTrack(0, true);
        this.showToast(`Reproduciendo ${cards[idx].title}`);
      });
    });
  }

  async renderHomeTracks() {
    const container = document.getElementById('home-tracks-list');
    const currentId = this.getCurrentTrack()?.id;
    const filtered = this.tracks.filter((t) => {
      if (this.homeFilter === 'all') return true;
      return t.category === this.homeFilter;
    });

    if (!filtered.length) {
      container.innerHTML = `<p style="color:var(--text-secondary); font-size:13px; padding:12px 0;">No hay audios en esta categoría. ¡Sube uno en la pestaña Crear!</p>`;
      return;
    }

    const htmlRows = await Promise.all(
      filtered.map(async (t) => {
        const cover = (await window.storageEngine.resolveCoverUrl(t.coverUrl)) ||
          'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=300&q=80';
        const isCurrent = t.id === currentId;
        return `
        <div class="list-row" data-track-id="${t.id}">
          <div class="list-row-left">
            <img class="list-thumb" src="${cover}" alt="${t.title}" />
            <div class="list-meta">
              <div class="list-title ${isCurrent ? 'playing' : ''}">${t.title}</div>
              <div class="list-sub">${t.artist}${t.album ? ` · ${t.album}` : ''} · ${this.formatTime(t.duration)}</div>
            </div>
          </div>
          <div class="list-actions">
            <button class="icon-btn btn-row-like" data-like-id="${t.id}" title="Me gusta" style="color:${t.liked ? 'var(--accent-red)' : 'var(--text-secondary)'}">
              ${t.liked ? '♥' : '♡'}
            </button>
          </div>
        </div>`;
      })
    );

    container.innerHTML = htmlRows.join('');

    container.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-row-like')) return;
        const id = row.getAttribute('data-track-id');
        this.queue = [...filtered];
        const idx = this.queue.findIndex((x) => x.id === id);
        this.loadTrack(idx >= 0 ? idx : 0, true);
      });
    });

    container.querySelectorAll('.btn-row-like').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-like-id');
        this.toggleTrackLike(id);
      });
    });
  }

  toggleTrackLike(trackId) {
    const t = this.tracks.find((x) => x.id === trackId);
    if (!t) return;
    t.liked = !t.liked;
    this.saveLocalState();
    window.storageEngine.syncTrackToSupabase(t);
    this.updateLikeButtons();
    this.renderHomeTracks();
    this.renderLibrary();
    this.showToast(t.liked ? 'Añadido a Tus me gusta ❤️' : 'Eliminado de Tus me gusta');
  }

  renderRecentSearches() {
    const container = document.getElementById('recent-searches-list');
    if (!this.recentSearches.length) {
      container.innerHTML = `<p style="font-size:13px; color:var(--text-muted);">Sin búsquedas recientes</p>`;
      return;
    }

    container.innerHTML = this.recentSearches
      .map(
        (item) => `
      <div class="list-row" data-search-term="${item.name}">
        <div class="list-row-left">
          <img class="list-thumb circle" src="${item.coverUrl}" alt="${item.name}" />
          <div class="list-meta">
            <div class="list-title">${item.name}</div>
          </div>
        </div>
        <button class="icon-btn btn-remove-recent" data-remove-id="${item.id}" style="color:var(--text-secondary);">✕</button>
      </div>`
      )
      .join('');

    container.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-recent')) return;
        const term = row.getAttribute('data-search-term');
        const input = document.getElementById('search-input');
        input.value = term;
        this.performSearch(term);
      });
    });

    container.querySelectorAll('.btn-remove-recent').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-remove-id');
        this.recentSearches = this.recentSearches.filter((x) => x.id !== id);
        this.saveLocalState();
        this.renderRecentSearches();
      });
    });
  }

  async performSearch(query) {
    const q = query.trim().toLowerCase();
    const area = document.getElementById('search-results-area');
    const list = document.getElementById('search-results-list');

    if (!q) {
      area.style.display = 'none';
      return;
    }

    area.style.display = 'block';
    const matches = this.tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        (t.genre && t.genre.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q))
    );

    if (!matches.length) {
      list.innerHTML = `<p style="font-size:13px; color:var(--text-secondary);">No se encontraron canciones para "${query}"</p>`;
      return;
    }

    const rows = await Promise.all(
      matches.map(async (t) => {
        const cover = (await window.storageEngine.resolveCoverUrl(t.coverUrl)) ||
          'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=300&q=80';
        return `
        <div class="list-row" data-result-id="${t.id}">
          <div class="list-row-left">
            <img class="list-thumb" src="${cover}" alt="${t.title}" />
            <div class="list-meta">
              <div class="list-title">${t.title}</div>
              <div class="list-sub">${t.artist} · ${t.genre}</div>
            </div>
          </div>
        </div>`;
      })
    );

    list.innerHTML = rows.join('');
    list.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-result-id');
        const trk = this.tracks.find((x) => x.id === id);
        if (trk) {
          if (!this.recentSearches.some((r) => r.name.toLowerCase() === trk.artist.toLowerCase())) {
            this.recentSearches.unshift({
              id: `rs_${Date.now()}`,
              name: trk.artist,
              coverUrl: trk.coverUrl
            });
            this.saveLocalState();
            this.renderRecentSearches();
          }
          this.queue = [...matches];
          const idx = this.queue.findIndex((x) => x.id === id);
          this.loadTrack(idx >= 0 ? idx : 0, true);
        }
      });
    });
  }

  async renderLibrary() {
    const likedTracks = this.tracks.filter((t) => t.liked);
    document.getElementById('liked-count-subtitle').textContent =
      `Tu colección favorita · ${likedTracks.length} canciones`;

    const container = document.getElementById('library-list-container');

    if (this.libraryFilter === 'playlists') {
      const rows = await Promise.all(
        this.playlists.map(async (pl) => {
          const cover = (await window.storageEngine.resolveCoverUrl(pl.coverUrl)) ||
            'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=400&q=80';
          return `
          <div class="list-row" data-playlist-id="${pl.id}">
            <div class="list-row-left">
              <img class="list-thumb" src="${cover}" alt="${pl.name}" />
              <div class="list-meta">
                <div class="list-title">${pl.name}</div>
                <div class="list-sub">${pl.subtitle || `Playlist · ${pl.trackIds?.length || 0} canciones`}</div>
              </div>
            </div>
            <div class="list-actions">
              ${pl.pinned ? '<span style="color:var(--text-secondary); font-size:13px; margin-right:6px;">📌</span>' : ''}
              <span style="color:var(--text-secondary); font-weight:800;">⋯</span>
            </div>
          </div>`;
        })
      );
      container.innerHTML = rows.join('');

      container.querySelectorAll('.list-row').forEach((row) => {
        row.addEventListener('click', () => {
          const plId = row.getAttribute('data-playlist-id');
          const pl = this.playlists.find((x) => x.id === plId);
          if (!pl) return;
          const plTracks = this.tracks.filter((t) => (pl.trackIds || []).includes(t.id));
          this.queue = plTracks.length ? plTracks : [...this.tracks];
          this.loadTrack(0, true);
          this.showToast(`Reproduciendo "${pl.name}"`);
        });
      });
      return;
    }

    if (this.libraryFilter === 'artists') {
      const artistsMap = new Map();
      this.tracks.forEach((t) => {
        if (!artistsMap.has(t.artist)) {
          artistsMap.set(t.artist, { name: t.artist, coverUrl: t.coverUrl, count: 1 });
        } else {
          artistsMap.get(t.artist).count++;
        }
      });
      const artists = Array.from(artistsMap.values());
      container.innerHTML = artists
        .map(
          (a) => `
        <div class="list-row" data-artist-name="${a.name}">
          <div class="list-row-left">
            <img class="list-thumb circle" src="${a.coverUrl}" alt="${a.name}" />
            <div class="list-meta">
              <div class="list-title">${a.name}</div>
              <div class="list-sub">Artista · ${a.count} canciones</div>
            </div>
          </div>
        </div>`
        )
        .join('');

      container.querySelectorAll('.list-row').forEach((row) => {
        row.addEventListener('click', () => {
          const name = row.getAttribute('data-artist-name');
          this.queue = this.tracks.filter((t) => t.artist === name);
          this.loadTrack(0, true);
          this.showToast(`Reproduciendo a ${name}`);
        });
      });
      return;
    }

    // Tracks or Albums
    const rows = await Promise.all(
      this.tracks.map(async (t) => {
        const cover = (await window.storageEngine.resolveCoverUrl(t.coverUrl)) ||
          'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=300&q=80';
        return `
        <div class="list-row" data-lib-track="${t.id}">
          <div class="list-row-left">
            <img class="list-thumb" src="${cover}" alt="${t.title}" />
            <div class="list-meta">
              <div class="list-title">${t.title}</div>
              <div class="list-sub">${t.artist}${t.album ? ` · ${t.album}` : ''} · ${this.formatTime(t.duration)}</div>
            </div>
          </div>
          ${this.isListenerMode ? '' : `<button class="icon-btn btn-delete-track admin-only" data-del-id="${t.id}" title="Eliminar" style="color:var(--text-muted);">🗑</button>`}
        </div>`;
      })
    );
    container.innerHTML = rows.join('');

    container.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-track')) return;
        const id = row.getAttribute('data-lib-track');
        this.queue = [...this.tracks];
        const idx = this.queue.findIndex((x) => x.id === id);
        this.loadTrack(idx >= 0 ? idx : 0, true);
      });
    });

    container.querySelectorAll('.btn-delete-track').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-del-id');
        if (this.tracks.length <= 1) {
          this.showToast('Debes conservar al menos 1 audio');
          return;
        }
        this.tracks = this.tracks.filter((t) => t.id !== id);
        this.saveLocalState();
        this.renderAll();
        this.showToast('Audio eliminado');
      });
    });
  }

  renderPlaylistTrackPicker() {
    const box = document.getElementById('playlist-track-selector');
    box.innerHTML = this.tracks
      .map((t) => {
        const checked = this.selectedTrackIdsForNewPlaylist.has(t.id);
        return `
        <div class="list-row" data-pick-id="${t.id}" style="padding:6px;">
          <div class="list-row-left">
            <input type="checkbox" ${checked ? 'checked' : ''} style="accent-color:var(--accent-red);" />
            <div class="list-meta">
              <div class="list-title" style="font-size:13px;">${t.title}</div>
              <div class="list-sub" style="font-size:11px;">${t.artist}</div>
            </div>
          </div>
        </div>`;
      })
      .join('');

    box.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-pick-id');
        if (this.selectedTrackIdsForNewPlaylist.has(id)) {
          this.selectedTrackIdsForNewPlaylist.delete(id);
        } else {
          this.selectedTrackIdsForNewPlaylist.add(id);
        }
        document.getElementById('picked-tracks-label').textContent =
          this.selectedTrackIdsForNewPlaylist.size > 0
            ? `${this.selectedTrackIdsForNewPlaylist.size} canciones seleccionadas`
            : 'Añadir canciones';
        this.renderPlaylistTrackPicker();
      });
    });
  }

  // ==================== UI EVENTS & NAVIGATION ====================
  switchScreen(targetId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const target = document.getElementById(targetId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
    });
  }

  switchCreateSubTab(mode) {
    const isPlaylist = mode === 'playlist';
    document.getElementById('tab-mode-playlist').classList.toggle('active', isPlaylist);
    document.getElementById('tab-mode-upload').classList.toggle('active', !isPlaylist);
    document.getElementById('create-playlist-pane').style.display = isPlaylist ? 'block' : 'none';
    document.getElementById('create-upload-pane').style.display = isPlaylist ? 'none' : 'block';
  }

  bindUIEvents() {
    // Bottom Navigation
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchScreen(btn.getAttribute('data-target'));
      });
    });

    // Home Filter Pills (Para ti | Música | Podcasts)
    document.querySelectorAll('#home-filter-pills .pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#home-filter-pills .pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.homeFilter = pill.getAttribute('data-filter');
        this.renderHomeTracks();
      });
    });

    // Featured Mix Play
    document.getElementById('featured-mix-card').addEventListener('click', () => {
      this.queue = [...this.tracks];
      this.loadTrack(0, true);
      this.showToast('Reproduciendo Tu mix de hoy 🔥');
    });

    // Discover something new
    document.getElementById('discover-banner-btn').addEventListener('click', () => {
      this.queue = [...this.tracks];
      const randIdx = Math.floor(Math.random() * this.queue.length);
      this.loadTrack(randIdx, true);
      this.showToast('Descubriendo música para ti 🎸');
    });

    // Quick upload buttons
    const goUpload = () => {
      this.switchScreen('screen-create');
      this.switchCreateSubTab('upload');
    };
    document.getElementById('btn-open-upload-quick').addEventListener('click', goUpload);
    document.getElementById('home-upload-link').addEventListener('click', goUpload);

    // Search Input & Genre Cards
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => this.performSearch(e.target.value));
    document.getElementById('btn-clear-search').addEventListener('click', () => {
      searchInput.value = '';
      this.performSearch('');
    });

    document.querySelectorAll('#search-categories-grid .category-card').forEach((card) => {
      card.addEventListener('click', () => {
        const genre = card.getAttribute('data-genre');
        searchInput.value = genre;
        this.performSearch(genre);
      });
    });

    // Library Filter Pills
    document.querySelectorAll('#library-filter-pills .pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#library-filter-pills .pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.libraryFilter = pill.getAttribute('data-lib');
        this.renderLibrary();
      });
    });

    document.getElementById('liked-songs-banner').addEventListener('click', () => {
      const liked = this.tracks.filter((t) => t.liked);
      if (!liked.length) {
        this.showToast('Aún no tienes canciones en Tus me gusta');
        return;
      }
      this.queue = liked;
      this.loadTrack(0, true);
      this.showToast('Reproduciendo Tus me gusta ❤️');
    });

    document.getElementById('lib-search-btn').addEventListener('click', () => this.switchScreen('screen-search'));
    document.getElementById('lib-add-btn').addEventListener('click', () => this.switchScreen('screen-create'));

    // Create Tabs (Playlist vs Upload Audio)
    document.getElementById('tab-mode-playlist').addEventListener('click', () => this.switchCreateSubTab('playlist'));
    document.getElementById('tab-mode-upload').addEventListener('click', () => this.switchCreateSubTab('upload'));

    // Create Playlist Form
    document.getElementById('collab-switch').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('on');
    });

    document.getElementById('btn-pick-playlist-tracks').addEventListener('click', () => {
      const el = document.getElementById('playlist-track-selector');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('playlist-cover-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.pendingPlaylistCoverFile = file;
      const preview = document.getElementById('playlist-cover-preview');
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    });

    document.getElementById('btn-submit-playlist').addEventListener('click', async () => {
      const nameInput = document.getElementById('playlist-name-input');
      const name = nameInput.value.trim() || 'Mi nueva playlist';
      let coverUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=500&q=80';

      if (this.pendingPlaylistCoverFile) {
        try {
          const uploaded = await window.storageEngine.uploadFile(this.pendingPlaylistCoverFile, 'covers');
          coverUrl = uploaded.url;
        } catch (err) {
          console.warn(err);
        }
      }

      const trackIds = this.selectedTrackIdsForNewPlaylist.size
        ? Array.from(this.selectedTrackIdsForNewPlaylist)
        : this.tracks.map((t) => t.id);

      const newPl = {
        id: `pl_${Date.now()}`,
        name,
        subtitle: `Playlist · ${trackIds.length} canciones`,
        pinned: false,
        coverUrl,
        trackIds
      };

      this.playlists.unshift(newPl);
      this.saveLocalState();
      nameInput.value = '';
      this.pendingPlaylistCoverFile = null;
      document.getElementById('playlist-cover-preview').style.display = 'none';
      this.selectedTrackIdsForNewPlaylist.clear();
      document.getElementById('picked-tracks-label').textContent = 'Añadir canciones';

      await this.renderLibrary();
      this.switchScreen('screen-library');
      this.showToast(`Playlist "${name}" creada 🎉`);
    });

    // Upload Audio Form
    document.getElementById('audio-cover-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.pendingAudioCoverFile = file;
      const preview = document.getElementById('audio-cover-preview');
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    });

    document.getElementById('audio-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const banner = document.getElementById('audio-meta-detected-banner');
      banner.classList.add('visible');
      banner.textContent = '🔍 Leyendo metadatos del archivo de audio...';

      const meta = await window.AudioMetadataReader.extract(file);

      document.getElementById('audio-title-input').value = meta.title || '';
      document.getElementById('audio-artist-input').value = meta.artist || '';
      document.getElementById('audio-album-input').value = meta.album || '';
      this.detectedAudioDuration = meta.duration || 210;
      document.getElementById('audio-duration-display').value = `${this.formatTime(this.detectedAudioDuration)} (${this.detectedAudioDuration} seg)`;

      if (meta.coverBlob) {
        this.pendingAudioCoverFile = new File([meta.coverBlob], 'cover.jpg', { type: meta.coverBlob.type || 'image/jpeg' });
        const preview = document.getElementById('audio-cover-preview');
        preview.src = meta.coverUrl;
        preview.style.display = 'block';
      }

      banner.innerHTML = `✨ <b>Datos leídos automáticamente del archivo:</b><br/>
        • <b>Título:</b> ${meta.title || '—'}<br/>
        • <b>Artista:</b> ${meta.artist || '—'}<br/>
        • <b>Álbum:</b> ${meta.album || '—'}<br/>
        • <b>Duración:</b> ${this.formatTime(this.detectedAudioDuration)} ${meta.coverBlob ? '· 🖼️ Portada incrustada extraída' : ''}`;
    });

    document.getElementById('btn-submit-audio').addEventListener('click', async () => {
      const fileInput = document.getElementById('audio-file-input');
      const file = fileInput.files[0];
      if (!file) {
        this.showToast('Selecciona un archivo de audio (.flac, .mp3, .wav, .m4a)');
        return;
      }

      const btn = document.getElementById('btn-submit-audio');
      const title = document.getElementById('audio-title-input').value.trim() || file.name;
      const artist = document.getElementById('audio-artist-input').value.trim() || window.storageEngine.config.userName || 'Jaasiel';
      const album = document.getElementById('audio-album-input').value.trim() || 'Sencillo';
      const category = document.getElementById('audio-category-input').value;
      const genre = document.getElementById('audio-genre-input').value;
      const duration = this.detectedAudioDuration || 210;

      btn.disabled = true;
      btn.textContent = 'Subiendo a Supabase Cloud...';

      try {
        const audioUpload = await window.storageEngine.uploadFile(file, 'tracks');
        let coverUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80';
        if (this.pendingAudioCoverFile) {
          const coverUpload = await window.storageEngine.uploadFile(this.pendingAudioCoverFile, 'covers');
          coverUrl = coverUpload.url;
        }

        const newTrack = {
          id: `trk_${Date.now()}`,
          title,
          artist,
          album,
          category,
          genre,
          audioUrl: audioUpload.url,
          blobId: audioUpload.blobId,
          coverUrl,
          duration,
          liked: true,
          provider: audioUpload.provider,
          createdAt: new Date().toISOString()
        };

        await window.storageEngine.syncTrackToSupabase(newTrack);

        this.tracks.unshift(newTrack);
        this.queue = [...this.tracks];
        this.saveLocalState();

        // Reset form
        fileInput.value = '';
        document.getElementById('audio-title-input').value = '';
        document.getElementById('audio-artist-input').value = '';
        document.getElementById('audio-album-input').value = '';
        document.getElementById('audio-duration-display').value = '';
        document.getElementById('audio-meta-detected-banner').classList.remove('visible');
        this.pendingAudioCoverFile = null;
        document.getElementById('audio-cover-preview').style.display = 'none';

        await this.renderAll();
        await this.loadTrack(0, true);
        this.switchScreen('screen-home');
        this.showToast(`"${title}" subido y reproduciendo 🎧`);
      } catch (err) {
        this.showToast(`Error: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Subir y guardar audio';
      }
    });

    // Secret 5-tap on Avatar J to open PIN (1234) unlock modal
    const handleAvatarSecretTap = () => {
      if (!this.isListenerMode) {
        document.getElementById('cloud-modal').classList.add('open');
        return;
      }
      this.avatarTapCount++;
      clearTimeout(this.avatarTapTimer);
      this.avatarTapTimer = setTimeout(() => {
        this.avatarTapCount = 0;
      }, 2200);

      if (this.avatarTapCount >= 5) {
        this.avatarTapCount = 0;
        const pinInput = document.getElementById('admin-pin-input');
        pinInput.value = '';
        document.getElementById('pin-modal').classList.add('open');
        setTimeout(() => pinInput.focus(), 100);
      }
    };

    const unlockEditorWithPin = () => {
      const pinInput = document.getElementById('admin-pin-input');
      if (pinInput.value.trim() === this.secretPin) {
        this.isListenerMode = false;
        document.body.classList.remove('listener-mode');
        document.getElementById('pin-modal').classList.remove('open');
        this.renderLibrary();
        this.showToast('🔓 Modo Editor desbloqueado');
      } else {
        pinInput.value = '';
        this.showToast('❌ PIN incorrecto');
      }
    };

    document.getElementById('btn-submit-pin').addEventListener('click', unlockEditorWithPin);
    document.getElementById('admin-pin-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') unlockEditorWithPin();
    });
    document.getElementById('btn-close-pin-modal').addEventListener('click', () => {
      document.getElementById('pin-modal').classList.remove('open');
    });

    document.getElementById('btn-lock-admin-mode').addEventListener('click', () => {
      this.isListenerMode = true;
      document.body.classList.add('listener-mode');
      this.switchCreateSubTab('playlist');
      this.renderLibrary();
      this.showToast('🔒 Modo Editor bloqueado (Vista Usuario)');
    });
    this._handleAvatarSecretTap = handleAvatarSecretTap;

    // Mini-Player & Full-Player Controls
    document.getElementById('mini-open-full').addEventListener('click', () => {
      document.getElementById('full-player-modal').classList.add('open');
    });
    document.getElementById('fp-close-btn').addEventListener('click', () => {
      document.getElementById('full-player-modal').classList.remove('open');
    });

    document.getElementById('mini-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlay();
    });
    document.getElementById('fp-play-btn').addEventListener('click', () => this.togglePlay());
    document.getElementById('fp-next-btn').addEventListener('click', () => this.nextTrack());
    document.getElementById('fp-prev-btn').addEventListener('click', () => this.prevTrack());

    document.getElementById('mini-like-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = this.getCurrentTrack();
      if (cur) this.toggleTrackLike(cur.id);
    });
    document.getElementById('fp-like-btn').addEventListener('click', () => {
      const cur = this.getCurrentTrack();
      if (cur) this.toggleTrackLike(cur.id);
    });

    document.getElementById('fp-seek-slider').addEventListener('input', (e) => {
      const dur = this.audio.duration || 200;
      this.audio.currentTime = (Number(e.target.value) / 100) * dur;
    });

    document.getElementById('fp-shuffle-btn').addEventListener('click', (e) => {
      this.shuffle = !this.shuffle;
      e.currentTarget.style.color = this.shuffle ? 'var(--accent-red)' : 'var(--text-primary)';
      this.showToast(this.shuffle ? 'Modo aleatorio activado 🔀' : 'Modo aleatorio desactivado');
    });

    document.getElementById('fp-repeat-btn').addEventListener('click', (e) => {
      const modes = ['off', 'all', 'one'];
      this.repeatMode = modes[(modes.indexOf(this.repeatMode) + 1) % modes.length];
      e.currentTarget.style.color = this.repeatMode !== 'off' ? 'var(--accent-red)' : 'var(--text-primary)';
      const labels = { off: 'Repetir desactivado', all: 'Repetir toda la cola 🔁', one: 'Repetir esta canción 🔂' };
      this.showToast(labels[this.repeatMode]);
    });

    document.getElementById('fp-speed-btn').addEventListener('click', (e) => {
      this.speedIndex = (this.speedIndex + 1) % this.playbackSpeeds.length;
      const spd = this.playbackSpeeds[this.speedIndex];
      this.audio.playbackRate = spd;
      e.currentTarget.textContent = `${spd}x Velocidad`;
      this.showToast(`Velocidad: ${spd}x`);
    });

    document.getElementById('fp-offline-btn').addEventListener('click', async () => {
      const track = this.getCurrentTrack();
      if (!track) return;
      this.showToast('Descargando audio en memoria Offline...');
      try {
        const blobId = await window.storageEngine.downloadTrackForOffline(track);
        if (typeof blobId === 'string') track.blobId = blobId;
        this.saveLocalState();
        await this.updateOfflineButtonState(track);
        this.showToast('¡Guardado para escuchar sin internet! 📲');
      } catch (e) {
        this.showToast('Guardado en caché local');
      }
    });

    document.getElementById('fp-add-to-playlist-btn').addEventListener('click', () => {
      document.getElementById('full-player-modal').classList.remove('open');
      this.switchScreen('screen-create');
      this.switchCreateSubTab('playlist');
    });

    // Cloud & Migration Modal
    const openCloudModal = () => document.getElementById('cloud-modal').classList.add('open');
    const closeCloudModal = () => document.getElementById('cloud-modal').classList.remove('open');

    document.getElementById('btn-cloud-settings').addEventListener('click', openCloudModal);
    document.getElementById('user-avatar-btn').addEventListener('click', () => this._handleAvatarSecretTap());
    document.getElementById('search-avatar-btn').addEventListener('click', () => this._handleAvatarSecretTap());
    document.getElementById('btn-open-cloud-from-create').addEventListener('click', openCloudModal);
    document.getElementById('btn-close-cloud-modal').addEventListener('click', closeCloudModal);

    document.getElementById('btn-save-cloud-cfg').addEventListener('click', async () => {
      window.storageEngine.saveCloudConfig({
        userName: document.getElementById('cfg-username').value.trim() || 'Jaasiel',
        provider: document.getElementById('cfg-provider').value,
        supabaseUrl: document.getElementById('cfg-sb-url').value.trim(),
        supabaseAnonKey: document.getElementById('cfg-sb-key').value.trim(),
        supabaseBucket: document.getElementById('cfg-sb-bucket').value.trim() || 'audios',
        cloudinaryCloudName: document.getElementById('cfg-cl-name').value.trim(),
        cloudinaryUploadPreset: document.getElementById('cfg-cl-preset').value.trim()
      });

      this.applyUserConfigToUI();
      closeCloudModal();

      // If Supabase credentials are provided, try syncing cloud catalog
      if (window.storageEngine.config.supabaseUrl && window.storageEngine.config.supabaseAnonKey) {
        try {
          const remoteTracks = await window.storageEngine.fetchTracksFromSupabase();
          if (remoteTracks && remoteTracks.length) {
            const existingIds = new Set(this.tracks.map((t) => t.id));
            remoteTracks.forEach((rt) => {
              if (!existingIds.has(rt.id)) this.tracks.unshift(rt);
            });
            this.saveLocalState();
            await this.renderAll();
          }
        } catch (e) {
          console.warn('Initial Supabase fetch note:', e.message);
        }
      }
      this.showToast('Configuración de nube actualizada ☁️');
    });

    // Export / Import Full Catalog JSON (for 1-click migration between cloud providers)
    document.getElementById('btn-export-catalog').addEventListener('click', () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        tracks: this.tracks,
        playlists: this.playlists
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `respaldo-tu-musica-${Date.now()}.json`;
      a.click();
      this.showToast('Respaldo descargado 📦');
    });

    document.getElementById('input-import-catalog').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (Array.isArray(data.tracks)) this.tracks = data.tracks;
          if (Array.isArray(data.playlists)) this.playlists = data.playlists;
          this.saveLocalState();
          await this.renderAll();
          closeCloudModal();
          this.showToast('¡Catálogo restaurado con éxito! 🎉');
        } catch (err) {
          this.showToast('Archivo de respaldo inválido');
        }
      };
      reader.readAsText(file);
    });
  }

  applyUserConfigToUI() {
    const cfg = window.storageEngine.config;
    const name = cfg.userName || 'Jaasiel';
    const initial = name.charAt(0).toUpperCase();

    document.getElementById('greeting-name').textContent = `Hola, ${name}`;
    document.getElementById('user-avatar-btn').textContent = initial;
    document.getElementById('search-avatar-btn').textContent = initial;

    document.getElementById('cfg-username').value = name;
    document.getElementById('cfg-provider').value = cfg.provider || 'local';
    document.getElementById('cfg-sb-url').value = cfg.supabaseUrl || '';
    document.getElementById('cfg-sb-key').value = cfg.supabaseAnonKey || '';
    document.getElementById('cfg-sb-bucket').value = cfg.supabaseBucket || 'audios';
    document.getElementById('cfg-cl-name').value = cfg.cloudinaryCloudName || '';
    document.getElementById('cfg-cl-preset').value = cfg.cloudinaryUploadPreset || '';

    const labels = {
      local: '📱 Guardando en Memoria Local / Offline',
      supabase: '🟢 Guardando en Supabase Cloud (1 GB)',
      cloudinary_supabase: '🚀 Guardando en Cloudinary (10+ GB) + Supabase DB'
    };
    document.getElementById('upload-destination-label').textContent = labels[cfg.provider] || labels.local;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.ritmoApp = new RitmoApp();
  window.ritmoApp.init();
});
