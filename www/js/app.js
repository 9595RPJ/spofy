// Main Application Logic for "Spofy – Tu Asistente Musical" (Bulby Edition)
// Implements Splash screen, 01 Inicio, 02 Explorar (with Live Charts & New Releases),
// 03 Playlists de Spofy + Supabase Cloud Catalog, 04 Favoritos & "¿Cómo te sientes hoy?" Mood Picker,
// Bulby Live AI Assistant Chat, and Secret 5-Tap PIN (1234) Admin Unlock.

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

const SPOFY_CURATED_PLAYLISTS = [
  {
    id: 'spofy_pl_estudio',
    name: 'Modo Estudio',
    subtitle: '50 canciones · Concentración',
    emoji: '📚',
    bg: 'linear-gradient(135deg, #2d7a6e 0%, #16443d 100%)',
    query: 'Lo-fi Study Beats'
  },
  {
    id: 'spofy_pl_entreno',
    name: 'Entrenamiento',
    subtitle: '45 canciones · Energía máxima',
    emoji: '🏋️',
    bg: 'linear-gradient(135deg, #c97a4b 0%, #6e3d20 100%)',
    query: 'Workout Hits'
  },
  {
    id: 'spofy_pl_relax',
    name: 'Relax Total',
    subtitle: '60 canciones · Paz interior',
    emoji: '🌿',
    bg: 'linear-gradient(135deg, #3b9c5e 0%, #1b5230 100%)',
    query: 'Acoustic Chill'
  },
  {
    id: 'spofy_pl_viaje',
    name: 'Viaje en Ruta',
    subtitle: '40 canciones · Carretera',
    emoji: '🛣️',
    bg: 'linear-gradient(135deg, #3b7c9c 0%, #193e52 100%)',
    query: 'Junior H'
  }
];

class SpofyApp {
  constructor() {
    this.tracks = [];
    this.playlists = [];
    this.libraryFilter = 'spofy_playlists';
    this.currentBulbyExpr = 'assets/bulby-sing.png';

    // Audio playback state
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.queue = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.shuffle = false;
    this.repeatMode = 'off';
    this.playbackSpeeds = [1, 1.25, 1.5, 2, 0.75];
    this.speedIndex = 0;

    // Upload & Admin PIN state
    this.pendingAudioCoverFile = null;
    this.detectedAudioDuration = 210;
    this.isListenerMode = true; // Clean User View by default
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

    this.playlists = savedPlaylists ? JSON.parse(savedPlaylists) : [];
    this.saveLocalState();
  }

  saveLocalState() {
    localStorage.setItem('ritmo_tracks', JSON.stringify(this.tracks));
    localStorage.setItem('ritmo_playlists', JSON.stringify(this.playlists));
  }

  showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2700);
  }

  formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  setBulbyExpression(exprPath) {
    this.currentBulbyExpr = exprPath;
    ['home-bulby-img', 'mood-bulby-img', 'chat-bulby-avatar'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.src = exprPath;
    });
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

  // Check if a live internet chart song exists in user's Supabase catalog so we play the full track!
  findFullSupabaseMatch(track) {
    if (!track.isPreview) return track;
    const match = this.tracks.find(
      (t) =>
        t.title.toLowerCase() === track.title.toLowerCase() &&
        t.artist.toLowerCase().includes(track.artist.toLowerCase().split(' ')[0])
    );
    return match || track;
  }

  async loadTrack(index, autoPlay = true) {
    if (!this.queue.length) this.queue = [...this.tracks];
    if (index < 0) index = this.queue.length - 1;
    if (index >= this.queue.length) index = 0;
    this.currentIndex = index;

    const rawTrack = this.getCurrentTrack();
    if (!rawTrack) return;
    const track = this.findFullSupabaseMatch(rawTrack);

    const playableUrl = await window.storageEngine.resolvePlayableUrl(track);
    const coverUrl = (await window.storageEngine.resolveCoverUrl(track.coverUrl)) || 'assets/bulby-tree-cover.png';

    if (playableUrl) {
      this.audio.src = playableUrl;
      this.audio.playbackRate = this.playbackSpeeds[this.speedIndex];
    }

    document.getElementById('mini-title').textContent = track.title;
    document.getElementById('mini-artist').textContent = track.album
      ? `${track.artist} · ${track.album}`
      : track.artist;
    document.getElementById('mini-cover').src = coverUrl;

    document.getElementById('fp-title').textContent = track.title;
    document.getElementById('fp-artist').textContent = track.artist;
    document.getElementById('fp-album').textContent = track.isPreview
      ? `${track.album || 'Top Chart'} · Vista Previa 30s 🌐`
      : `${track.album || 'Spofy Cloud'} · Audio Completo ☁️`;
    document.getElementById('fp-cover').src = coverUrl;
    document.getElementById('fp-total-time').textContent = this.formatTime(track.duration || 30);

    this.updateLikeButtons();
    await this.updateOfflineButtonState(track);
    this.renderHomeTracks();
    this.renderFavorites();

    if (autoPlay && playableUrl) {
      try {
        await this.audio.play();
      } catch (err) {
        console.warn('Autoplay note:', err);
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

    miniBtn.style.color = liked ? 'var(--accent-coral)' : 'var(--text-primary)';
    fpBtn.style.color = liked ? 'var(--accent-coral)' : 'var(--text-primary)';
    fpBtn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  }

  async updateOfflineButtonState(track) {
    const btn = document.getElementById('fp-offline-btn');
    const blobId = track.blobId || `offline_${track.id}`;
    const isCached =
      (track.audioUrl && track.audioUrl.startsWith('idb://')) ||
      (await window.storageEngine.hasBlob(blobId));

    if (isCached) {
      btn.textContent = '✓ Disponible Offline';
    } else {
      btn.textContent = '↓ Guardar Offline';
    }
  }

  // ==================== RENDERING SCREENS ====================
  async renderAll() {
    await this.renderHomeTracks();
    await this.renderLibrary();
    await this.renderFavorites();
  }

  async renderHomeTracks() {
    const container = document.getElementById('home-tracks-list');
    const currentId = this.getCurrentTrack()?.id;

    if (!this.tracks.length) {
      container.innerHTML = `<p style="color:var(--text-secondary); font-size:13px;">Aún no has subido canciones a Supabase.</p>`;
      return;
    }

    const htmlRows = await Promise.all(
      this.tracks.map(async (t) => {
        const cover = (await window.storageEngine.resolveCoverUrl(t.coverUrl)) || 'assets/app-icon.png';
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
          <button class="icon-btn btn-row-like" data-like-id="${t.id}" style="color:${t.liked ? 'var(--accent-coral)' : 'var(--text-secondary)'}; font-size:18px;">
            ${t.liked ? '♥' : '♡'}
          </button>
        </div>`;
      })
    );

    container.innerHTML = htmlRows.join('');

    container.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-row-like')) return;
        const id = row.getAttribute('data-track-id');
        this.queue = [...this.tracks];
        const idx = this.queue.findIndex((x) => x.id === id);
        this.loadTrack(idx >= 0 ? idx : 0, true);
      });
    });

    container.querySelectorAll('.btn-row-like').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleTrackLike(btn.getAttribute('data-like-id'));
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
    this.renderFavorites();
    this.showToast(t.liked ? 'Añadido a Favoritos ❤️' : 'Quitado de Favoritos');
  }

  async renderLibrary() {
    const container = document.getElementById('library-list-container');
    const uploadPane = document.getElementById('create-upload-pane');

    if (this.libraryFilter === 'upload') {
      uploadPane.style.display = 'block';
      container.innerHTML = '';
      return;
    }
    uploadPane.style.display = 'none';

    if (this.libraryFilter === 'spofy_playlists') {
      const spofyHtml = SPOFY_CURATED_PLAYLISTS.map(
        (pl) => `
        <div class="suggestion-card spofy-curated-pl" data-query="${pl.query}" data-name="${pl.name}">
          <div class="suggestion-left">
            <div class="suggestion-thumb" style="background:${pl.bg}; display:flex; align-items:center; justify-content:center; font-size:30px;">
              ${pl.emoji}
            </div>
            <div>
              <div class="suggestion-title">${pl.name}</div>
              <div class="suggestion-sub">${pl.subtitle}</div>
            </div>
          </div>
          <button class="play-circle-lime">▶</button>
        </div>`
      ).join('');

      const customHtml = this.playlists
        .map(
          (pl) => `
        <div class="suggestion-card custom-user-pl" data-pl-id="${pl.id}">
          <div class="suggestion-left">
            <img class="suggestion-thumb" src="assets/app-icon.png" alt="${pl.name}" />
            <div>
              <div class="suggestion-title">${pl.name}</div>
              <div class="suggestion-sub">${pl.subtitle || 'Tu Playlist en Spofy'}</div>
            </div>
          </div>
          <button class="play-circle-lime">▶</button>
        </div>`
        )
        .join('');

      container.innerHTML = customHtml + spofyHtml;

      container.querySelectorAll('.spofy-curated-pl').forEach((card) => {
        card.addEventListener('click', () => {
          const name = card.getAttribute('data-name');
          this.queue = [...this.tracks];
          this.loadTrack(0, true);
          this.showToast(`Reproduciendo "${name}" ✨`);
        });
      });

      container.querySelectorAll('.custom-user-pl').forEach((card) => {
        card.addEventListener('click', () => {
          this.queue = [...this.tracks];
          this.loadTrack(0, true);
          this.showToast('Reproduciendo tu playlist 🎧');
        });
      });
      return;
    }

    // Tu Nube (Supabase tracks)
    const rows = await Promise.all(
      this.tracks.map(async (t) => {
        const cover = (await window.storageEngine.resolveCoverUrl(t.coverUrl)) || 'assets/app-icon.png';
        return `
        <div class="list-row" data-lib-track="${t.id}">
          <div class="list-row-left">
            <img class="list-thumb" src="${cover}" alt="${t.title}" />
            <div class="list-meta">
              <div class="list-title">${t.title}</div>
              <div class="list-sub">${t.artist}${t.album ? ` · ${t.album}` : ''} · ${this.formatTime(t.duration)}</div>
            </div>
          </div>
          ${this.isListenerMode ? '' : `<button class="icon-btn btn-delete-track admin-only" data-del-id="${t.id}" title="Eliminar" style="color:var(--accent-coral);">🗑</button>`}
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
          this.showToast('Conserva al menos 1 canción en tu biblioteca');
          return;
        }
        this.tracks = this.tracks.filter((t) => t.id !== id);
        this.saveLocalState();
        this.renderAll();
        this.showToast('Canción eliminada');
      });
    });
  }

  async renderFavorites() {
    const liked = this.tracks.filter((t) => t.liked);
    document.getElementById('liked-count-subtitle').textContent = `${liked.length} ${liked.length === 1 ? 'canción' : 'canciones'}`;
    const container = document.getElementById('favorites-tracks-list');

    if (!liked.length) {
      container.innerHTML = `<p style="font-size:13px; color:var(--text-secondary);">Toca el corazón ♡ en cualquier canción para guardarla aquí.</p>`;
      return;
    }

    const rows = await Promise.all(
      liked.map(async (t) => {
        const cover = (await window.storageEngine.resolveCoverUrl(t.coverUrl)) || 'assets/app-icon.png';
        return `
        <div class="list-row" data-fav-id="${t.id}">
          <div class="list-row-left">
            <img class="list-thumb" src="${cover}" alt="${t.title}" />
            <div class="list-meta">
              <div class="list-title">${t.title}</div>
              <div class="list-sub">${t.artist} · ${t.album || 'Spofy'}</div>
            </div>
          </div>
          <span style="color:var(--accent-coral); font-size:18px;">♥</span>
        </div>`;
      })
    );

    container.innerHTML = rows.join('');
    container.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-fav-id');
        this.queue = [...liked];
        const idx = this.queue.findIndex((x) => x.id === id);
        this.loadTrack(idx >= 0 ? idx : 0, true);
      });
    });
  }

  // ==================== EXPLORE & LIVE CHARTS / NEW RELEASES ====================
  renderTrackResultsList(containerEl, trackList, showRanks = false) {
    if (!trackList || !trackList.length) {
      containerEl.innerHTML = `<p style="font-size:13px; color:var(--text-secondary);">No se encontraron resultados.</p>`;
      return;
    }

    containerEl.innerHTML = trackList
      .map(
        (t, idx) => `
      <div class="list-row" data-live-idx="${idx}">
        <div class="list-row-left">
          ${showRanks ? `<span class="rank-badge">#${t.rank || idx + 1}</span>` : ''}
          <img class="list-thumb" src="${t.coverUrl || 'assets/app-icon.png'}" alt="${t.title}" />
          <div class="list-meta">
            <div class="list-title">${t.title}</div>
            <div class="list-sub">${t.artist} · ${t.releaseDate ? `📅 ${t.releaseDate}` : t.album || t.genre}</div>
          </div>
        </div>
        <button class="play-circle-lime" style="width:32px; height:32px; font-size:12px;">▶</button>
      </div>`
      )
      .join('');

    containerEl.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.getAttribute('data-live-idx'));
        this.queue = [...trackList];
        this.loadTrack(idx, true);
        const chosen = trackList[idx];
        this.showToast(`Reproduciendo "${chosen.title}" – ${chosen.artist} 🎵`);
      });
    });
  }

  async loadExploreTab(mode) {
    const area = document.getElementById('search-results-area');
    const list = document.getElementById('search-results-list');
    const heading = document.getElementById('search-results-heading');
    const genresPane = document.getElementById('explore-genres-pane');

    if (mode === 'genres') {
      area.style.display = 'none';
      genresPane.style.display = 'block';
      return;
    }

    genresPane.style.display = 'none';
    area.style.display = 'block';
    list.innerHTML = `<p style="font-size:13px; color:var(--accent-cream);">🌐 Bulby está consultando información en vivo de internet...</p>`;

    try {
      if (mode === 'top_mx') {
        heading.textContent = '🇲🇽 Top Canciones en México (En Vivo)';
        const chart = await window.bulbyAssistant.fetchTopChart('mx', 15);
        this.renderTrackResultsList(list, chart, true);
      } else if (mode === 'top_global') {
        heading.textContent = '🌍 Top Canciones Mundial (En Vivo)';
        const chart = await window.bulbyAssistant.fetchTopChart('us', 15);
        this.renderTrackResultsList(list, chart, true);
      } else if (mode === 'new_releases') {
        const q = document.getElementById('search-input').value.trim() || 'Junior H';
        heading.textContent = `🆕 Últimos Lanzamientos: ${q}`;
        const releases = await window.bulbyAssistant.searchLatestByArtist(q, 12);
        this.renderTrackResultsList(list, releases, false);
      }
    } catch (e) {
      list.innerHTML = `<p style="font-size:13px; color:var(--accent-coral);">No se pudo conectar al servidor de charts. Revisa tu conexión a internet.</p>`;
    }
  }

  async performSearch(query, forceOnline = false) {
    const q = query.trim();
    const area = document.getElementById('search-results-area');
    const list = document.getElementById('search-results-list');
    const heading = document.getElementById('search-results-heading');
    const genresPane = document.getElementById('explore-genres-pane');

    if (!q) {
      area.style.display = 'none';
      genresPane.style.display = 'block';
      return;
    }

    area.style.display = 'block';
    genresPane.style.display = 'none';

    const localMatches = this.tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q.toLowerCase()) ||
        t.artist.toLowerCase().includes(q.toLowerCase()) ||
        (t.genre && t.genre.toLowerCase().includes(q.toLowerCase()))
    );

    if (localMatches.length && !forceOnline) {
      heading.textContent = `En tu nube Spofy (${localMatches.length})`;
      this.renderTrackResultsList(list, localMatches, false);
      return;
    }

    heading.textContent = `🌐 Lanzamientos en internet: "${q}"`;
    list.innerHTML = `<p style="font-size:13px; color:var(--accent-cream);">🔍 Buscando canciones y estrenos de "${q}" en internet...</p>`;
    try {
      const onlineTracks = await window.bulbyAssistant.searchLatestByArtist(q, 12);
      this.renderTrackResultsList(list, [...localMatches, ...onlineTracks], false);
    } catch (e) {
      this.renderTrackResultsList(list, localMatches, false);
    }
  }

  // ==================== BULBY INTERACTIVE CHAT ====================
  async sendBulbyMessage(questionText) {
    const q = questionText.trim();
    if (!q) return;

    const msgBox = document.getElementById('bulby-chat-messages');
    const tracksBox = document.getElementById('bulby-chat-tracks');

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = q;
    msgBox.appendChild(userBubble);

    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'chat-bubble bulby';
    loadingBubble.textContent = '🎧 Consultando charts y lanzamientos en internet...';
    msgBox.appendChild(loadingBubble);
    msgBox.scrollTop = msgBox.scrollHeight;

    try {
      const res = await window.bulbyAssistant.askBulby(q, this.tracks);
      window.bulbyAssistant.playBulbySound('reply');
      const exprMap = {
        sing: 'assets/bulby-sing.png',
        cool: 'assets/bulby-cool.png',
        love: 'assets/bulby-love.png',
        sleep: 'assets/bulby-sleep.png'
      };
      if (res.mood && exprMap[res.mood]) {
        this.setBulbyExpression(exprMap[res.mood]);
      }

      loadingBubble.innerHTML = res.reply
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/\n/g, '<br/>');

      this.renderTrackResultsList(tracksBox, res.tracks || [], q.toLowerCase().includes('top') || q.toLowerCase().includes('méxico'));
    } catch (err) {
      loadingBubble.textContent = 'Hubo un problema al consultar internet, pero aquí tienes tu música de Supabase.';
    }
    msgBox.scrollTop = msgBox.scrollHeight;
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

  bindUIEvents() {
    // Splash Screen dismissal
    const splash = document.getElementById('splash-overlay');
    if (sessionStorage.getItem('spofy_splash_seen') === '1') {
      splash.classList.add('hidden');
    }
    document.getElementById('btn-start-app').addEventListener('click', () => {
      splash.classList.add('hidden');
      sessionStorage.setItem('spofy_splash_seen', '1');
    });
    document.getElementById('btn-splash-admin-login').addEventListener('click', () => {
      splash.classList.add('hidden');
      sessionStorage.setItem('spofy_splash_seen', '1');
      document.getElementById('pin-modal').classList.add('open');
    });

    // Bottom Navigation
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchScreen(btn.getAttribute('data-target'));
      });
    });

    // 3 Quick Tiles on Home
    document.getElementById('tile-recommended').addEventListener('click', () => {
      this.queue = [...this.tracks];
      this.loadTrack(0, true);
      this.showToast('Reproduciendo Recomendado para ti ✨');
    });
    document.getElementById('tile-favorites').addEventListener('click', () => {
      this.switchScreen('screen-favorites');
    });
    document.getElementById('tile-explore-genres').addEventListener('click', () => {
      this.switchScreen('screen-search');
    });

    document.getElementById('btn-open-mood-from-home').addEventListener('click', () => {
      this.switchScreen('screen-favorites');
    });

    // Sugerencias de Spofy cards
    document.querySelectorAll('#spofy-suggestions-list .suggestion-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.queue = [...this.tracks];
        this.loadTrack(0, true);
        this.showToast('Reproduciendo sugerencia de Bulby 🌿');
      });
    });

    // Bulby Chat Modal open/close & messages
    const openBulbyChat = () => document.getElementById('bulby-chat-modal').classList.add('open');
    const closeBulbyChat = () => document.getElementById('bulby-chat-modal').classList.remove('open');

    document.getElementById('btn-open-bulby-chat').addEventListener('click', openBulbyChat);
    document.getElementById('btn-close-bulby-chat').addEventListener('click', closeBulbyChat);

    document.getElementById('btn-send-bulby-chat').addEventListener('click', () => {
      const inp = document.getElementById('bulby-chat-input');
      this.sendBulbyMessage(inp.value);
      inp.value = '';
    });
    document.getElementById('bulby-chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.sendBulbyMessage(e.target.value);
        e.target.value = '';
      }
    });

    document.querySelectorAll('.bulby-quick-q').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.sendBulbyMessage(chip.getAttribute('data-q'));
      });
    });

    document.getElementById('fp-ask-bulby-track-btn').addEventListener('click', () => {
      const cur = this.getCurrentTrack();
      document.getElementById('full-player-modal').classList.remove('open');
      openBulbyChat();
      if (cur) {
        this.sendBulbyMessage(`¿Qué música nueva sacó ${cur.artist}?`);
      }
    });

    // Explore Screen: Search & Live Charts Tabs
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => this.performSearch(e.target.value, false));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.performSearch(e.target.value, true);
    });
    document.getElementById('btn-search-online').addEventListener('click', () => {
      this.performSearch(searchInput.value || 'Junior H', true);
    });
    document.getElementById('btn-clear-search').addEventListener('click', () => {
      searchInput.value = '';
      this.loadExploreTab('genres');
    });

    document.querySelectorAll('#explore-mode-pills .pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#explore-mode-pills .pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.loadExploreTab(pill.getAttribute('data-explore'));
      });
    });

    document.querySelectorAll('#search-categories-grid .genre-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        const genre = tile.getAttribute('data-genre');
        searchInput.value = genre;
        this.performSearch(genre, true);
      });
    });

    // Mood Picker Cards (04 ¿Cómo te sientes hoy?)
    document.querySelectorAll('#mood-cards-grid .mood-card').forEach((card) => {
      card.addEventListener('click', () => {
        document.querySelectorAll('#mood-cards-grid .mood-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        const expr = card.getAttribute('data-expr');
        const label = card.querySelector('.mood-label').textContent;
        this.setBulbyExpression(expr);
        document.getElementById('mood-bulby-status').textContent = `¡Bulby sintonizó tu mood: ${label}! 🎵`;
        this.queue = [...this.tracks];
        this.loadTrack(0, true);
        this.showToast(`Mood "${label}" activado con Bulby ✨`);
      });
    });

    // Library Filter Pills & Upload Audio
    document.querySelectorAll('#library-filter-pills .pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#library-filter-pills .pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.libraryFilter = pill.getAttribute('data-lib');
        this.renderLibrary();
      });
    });

    document.getElementById('btn-toggle-create-drawer').addEventListener('click', () => {
      const dr = document.getElementById('create-playlist-drawer');
      dr.style.display = dr.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('btn-submit-playlist').addEventListener('click', () => {
      const inp = document.getElementById('playlist-name-input');
      const name = inp.value.trim() || 'Mi Playlist Spofy';
      this.playlists.unshift({
        id: `pl_${Date.now()}`,
        name,
        subtitle: `Playlist · ${this.tracks.length} canciones`,
        trackIds: this.tracks.map((t) => t.id)
      });
      this.saveLocalState();
      inp.value = '';
      document.getElementById('create-playlist-drawer').style.display = 'none';
      this.renderLibrary();
      this.showToast(`Playlist "${name}" creada 🌿`);
    });

    const goUpload = () => {
      this.switchScreen('screen-library');
      document.querySelectorAll('#library-filter-pills .pill').forEach((p) => {
        p.classList.toggle('active', p.getAttribute('data-lib') === 'upload');
      });
      this.libraryFilter = 'upload';
      this.renderLibrary();
    };
    document.getElementById('btn-open-upload-quick').addEventListener('click', goUpload);
    document.getElementById('home-upload-link').addEventListener('click', goUpload);

    // Automatic ID3 / FLAC Metadata Extraction on File Selection
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
      banner.textContent = '🔍 Bulby está leyendo los metadatos del archivo...';

      const meta = await window.AudioMetadataReader.extract(file);

      document.getElementById('audio-title-input').value = meta.title || '';
      document.getElementById('audio-artist-input').value = meta.artist || '';
      document.getElementById('audio-album-input').value = meta.album || '';
      this.detectedAudioDuration = meta.duration || 210;
      document.getElementById('audio-duration-display').value = `${this.formatTime(this.detectedAudioDuration)} (${this.detectedAudioDuration}s)`;

      if (meta.coverBlob) {
        this.pendingAudioCoverFile = new File([meta.coverBlob], 'cover.jpg', {
          type: meta.coverBlob.type || 'image/jpeg'
        });
        const preview = document.getElementById('audio-cover-preview');
        preview.src = meta.coverUrl;
        preview.style.display = 'block';
      }

      banner.innerHTML = `✨ <b>Metadatos detectados por Bulby:</b><br/>
        • <b>Título:</b> ${meta.title || '—'} · <b>Artista:</b> ${meta.artist || '—'}<br/>
        • <b>Álbum:</b> ${meta.album || '—'} · <b>Duración:</b> ${this.formatTime(this.detectedAudioDuration)}`;
    });

    document.getElementById('btn-submit-audio').addEventListener('click', async () => {
      const fileInput = document.getElementById('audio-file-input');
      const file = fileInput.files[0];
      if (!file) {
        this.showToast('Selecciona un archivo de audio (.flac, .mp3, .wav)');
        return;
      }

      const btn = document.getElementById('btn-submit-audio');
      const title = document.getElementById('audio-title-input').value.trim() || file.name;
      const artist = document.getElementById('audio-artist-input').value.trim() || 'Artista';
      const album = document.getElementById('audio-album-input').value.trim() || 'Sencillo';
      const genre = document.getElementById('audio-genre-input').value;
      const duration = this.detectedAudioDuration || 210;

      btn.disabled = true;
      btn.textContent = 'Subiendo a Supabase Cloud...';

      try {
        const audioUpload = await window.storageEngine.uploadFile(file, 'tracks');
        let coverUrl = 'assets/app-icon.png';
        if (this.pendingAudioCoverFile) {
          const coverUpload = await window.storageEngine.uploadFile(this.pendingAudioCoverFile, 'covers');
          coverUrl = coverUpload.url;
        }

        const newTrack = {
          id: `trk_${Date.now()}`,
          title,
          artist,
          album,
          category: 'Música',
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
        this.showToast(`"${title}" subido a Supabase 🎧`);
      } catch (err) {
        this.showToast(`Error: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Subir y guardar en Supabase';
      }
    });

    // Secret 5-tap on Bulby corner avatar to unlock Editor Mode with PIN 1234
    const handleBulbyAvatarTap = () => {
      this.avatarTapCount++;
      clearTimeout(this.avatarTapTimer);
      this.avatarTapTimer = setTimeout(() => {
        if (this.avatarTapCount > 0 && this.avatarTapCount < 5) {
          openBulbyChat();
        }
        this.avatarTapCount = 0;
      }, 450);

      if (this.avatarTapCount >= 5) {
        clearTimeout(this.avatarTapTimer);
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
      this.libraryFilter = 'spofy_playlists';
      this.renderLibrary();
      this.showToast('🔒 Modo Editor bloqueado (Vista Usuario)');
    });

    document.getElementById('user-avatar-btn').addEventListener('click', handleBulbyAvatarTap);
    document.getElementById('search-avatar-btn').addEventListener('click', handleBulbyAvatarTap);

    // Mini-Player & Full-Player Controls
    document.getElementById('mini-open-full').addEventListener('click', () => {
      const modal = document.getElementById('full-player-modal');
      modal.style.transform = '';
      modal.classList.add('open');
    });
    document.getElementById('fp-close-btn').addEventListener('click', () => {
      const modal = document.getElementById('full-player-modal');
      modal.style.transform = '';
      modal.classList.remove('open');
    });

    // Swipe-down from top gesture to minimize Full-Screen Player
    this.initPlayerSwipeDownGesture();

    // Real-time Microphone Voice Recognition for Bulby Chat & Search
    this.initVoiceRecognition();

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
      e.currentTarget.style.color = this.shuffle ? 'var(--accent-lime)' : 'var(--text-primary)';
      this.showToast(this.shuffle ? 'Aleatorio activado 🔀' : 'Aleatorio desactivado');
    });

    document.getElementById('fp-repeat-btn').addEventListener('click', (e) => {
      const modes = ['off', 'all', 'one'];
      this.repeatMode = modes[(modes.indexOf(this.repeatMode) + 1) % modes.length];
      e.currentTarget.style.color = this.repeatMode !== 'off' ? 'var(--accent-lime)' : 'var(--text-primary)';
      const labels = { off: 'Repetir desactivado', all: 'Repetir cola 🔁', one: 'Repetir canción 🔂' };
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
      this.showToast('Guardando audio en memoria Offline...');
      try {
        const blobId = await window.storageEngine.downloadTrackForOffline(track);
        if (typeof blobId === 'string') track.blobId = blobId;
        this.saveLocalState();
        await this.updateOfflineButtonState(track);
        this.showToast('¡Disponible sin internet! 📲');
      } catch (e) {
        this.showToast('Guardado en caché local');
      }
    });

    // Cloud Settings Modal
    const openCloudModal = () => document.getElementById('cloud-modal').classList.add('open');
    const closeCloudModal = () => document.getElementById('cloud-modal').classList.remove('open');

    document.getElementById('btn-cloud-settings').addEventListener('click', openCloudModal);
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
      this.showToast('Configuración de nube guardada ☁️');
    });

    document.getElementById('btn-export-catalog').addEventListener('click', () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        tracks: this.tracks,
        playlists: this.playlists
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `respaldo-spofy-${Date.now()}.json`;
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
          this.showToast('¡Catálogo restaurado! 🎉');
        } catch (err) {
          this.showToast('Archivo inválido');
        }
      };
      reader.readAsText(file);
    });
  }

  // ==================== SWIPE-DOWN TO MINIMIZE FULL PLAYER ====================
  initPlayerSwipeDownGesture() {
    const modal = document.getElementById('full-player-modal');
    let startY = 0;
    let currentDeltaY = 0;
    let isDragging = false;

    const onStart = (clientY, target) => {
      // Do not hijack horizontal range sliders
      if (target && (target.tagName === 'INPUT' || target.closest('#fp-seek-slider'))) return;
      startY = clientY;
      currentDeltaY = 0;
      isDragging = true;
    };

    const onMove = (clientY) => {
      if (!isDragging) return;
      const delta = clientY - startY;
      if (delta > 0) {
        currentDeltaY = delta;
        modal.classList.add('dragging');
        modal.style.transform = `translateY(${delta}px)`;
      }
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      modal.classList.remove('dragging');
      if (currentDeltaY > 95) {
        // Minimize player smoothly
        modal.style.transform = '';
        modal.classList.remove('open');
      } else {
        // Snap back to open state
        modal.style.transform = '';
      }
      currentDeltaY = 0;
    };

    // Touch events (Mobile Android APK)
    modal.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientY, e.target);
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) onMove(e.touches[0].clientY);
    }, { passive: true });

    modal.addEventListener('touchend', onEnd);

    // Mouse drag support (for testing on PC browser)
    const dragZone = document.getElementById('fp-drag-zone');
    if (dragZone) {
      dragZone.addEventListener('mousedown', (e) => onStart(e.clientY, e.target));
      window.addEventListener('mousemove', (e) => {
        if (isDragging) onMove(e.clientY);
      });
      window.addEventListener('mouseup', onEnd);
    }
  }

  // ==================== REAL-TIME VOICE RECOGNITION (MIC) ====================
  initVoiceRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const chatMicBtn = document.getElementById('btn-bulby-mic');
    const searchMicBtn = document.getElementById('btn-search-mic');
    const liveBanner = document.getElementById('voice-live-banner');
    const liveStatus = document.getElementById('voice-live-status');
    const stopVoiceBtn = document.getElementById('btn-stop-voice');

    this.isListeningVoice = false;
    this.activeVoiceTarget = 'chat'; // 'chat' | 'search'

    if (!SpeechRec) {
      const warnNoSpeech = () => this.showToast('Tu navegador no soporta reconocimiento de voz directo');
      if (chatMicBtn) chatMicBtn.addEventListener('click', warnNoSpeech);
      if (searchMicBtn) searchMicBtn.addEventListener('click', warnNoSpeech);
      return;
    }

    this.recognition = new SpeechRec();
    this.recognition.lang = 'es-MX';
    this.recognition.interimResults = true;
    this.recognition.continuous = false;

    let latestTranscript = '';

    const setMicUI = (listening) => {
      this.isListeningVoice = listening;
      if (chatMicBtn) chatMicBtn.classList.toggle('listening', listening && this.activeVoiceTarget === 'chat');
      if (searchMicBtn) searchMicBtn.classList.toggle('listening', listening && this.activeVoiceTarget === 'search');
      if (liveBanner) liveBanner.classList.toggle('active', listening && this.activeVoiceTarget === 'chat');
    };

    this.recognition.onstart = () => {
      latestTranscript = '';
      window.bulbyAssistant.playBulbySound('listen');
      setMicUI(true);
      if (liveStatus) liveStatus.textContent = '🎙️ Escuchando en tiempo real... habla ahora';
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      let finalTxt = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTxt += txt;
        } else {
          interim += txt;
        }
      }
      latestTranscript = (finalTxt || interim).trim();

      if (this.activeVoiceTarget === 'chat') {
        const inp = document.getElementById('bulby-chat-input');
        if (inp) inp.value = latestTranscript;
        if (liveStatus) liveStatus.textContent = `🎙️ "${latestTranscript}"`;
      } else {
        const sInp = document.getElementById('search-input');
        if (sInp) sInp.value = latestTranscript;
      }

      if (finalTxt.trim()) {
        const queryToRun = finalTxt.trim();
        setMicUI(false);
        if (this.activeVoiceTarget === 'chat') {
          document.getElementById('bulby-chat-input').value = '';
          this.sendBulbyMessage(queryToRun);
        } else {
          this.performSearch(queryToRun, true);
        }
      }
    };

    this.recognition.onerror = (e) => {
      setMicUI(false);
      if (e.error === 'not-allowed') {
        this.showToast('Permite el acceso al micrófono 🎙️');
      }
    };

    this.recognition.onend = () => {
      if (this.isListeningVoice && latestTranscript) {
        const q = latestTranscript;
        setMicUI(false);
        if (this.activeVoiceTarget === 'chat') {
          document.getElementById('bulby-chat-input').value = '';
          this.sendBulbyMessage(q);
        } else {
          this.performSearch(q, true);
        }
      } else {
        setMicUI(false);
      }
    };

    const toggleMic = (targetMode) => {
      if (this.isListeningVoice) {
        this.recognition.stop();
        setMicUI(false);
        return;
      }
      this.activeVoiceTarget = targetMode;
      // Pause music briefly while speaking so mic hears clearly
      if (this.isPlaying) {
        this.audio.pause();
      }
      try {
        this.recognition.start();
      } catch (e) {
        console.warn(e);
      }
    };

    if (chatMicBtn) {
      chatMicBtn.addEventListener('click', () => toggleMic('chat'));
    }
    if (searchMicBtn) {
      searchMicBtn.addEventListener('click', () => toggleMic('search'));
    }
    if (stopVoiceBtn) {
      stopVoiceBtn.addEventListener('click', () => {
        this.recognition.stop();
        setMicUI(false);
      });
    }
  }

  applyUserConfigToUI() {
    const cfg = window.storageEngine.config;
    const name = cfg.userName || 'Jaasiel';
    document.getElementById('greeting-name').textContent = `Hola, ${name}`;

    document.getElementById('cfg-username').value = name;
    document.getElementById('cfg-provider').value = cfg.provider || 'supabase';
    document.getElementById('cfg-sb-url').value = cfg.supabaseUrl || '';
    document.getElementById('cfg-sb-key').value = cfg.supabaseAnonKey || '';
    document.getElementById('cfg-sb-bucket').value = cfg.supabaseBucket || 'audios';
    document.getElementById('cfg-cl-name').value = cfg.cloudinaryCloudName || '';
    document.getElementById('cfg-cl-preset').value = cfg.cloudinaryUploadPreset || '';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.spofyApp = new SpofyApp();
  window.spofyApp.init();
});
