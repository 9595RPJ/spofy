// Multi-provider Cloud & Offline Storage Engine (Supabase + Cloudinary + IndexedDB)
// Allows starting locally or on Supabase, and migrating or switching storage providers anytime.

const DB_NAME = 'RitmoPlayerDB';
const DB_VERSION = 1;

class StorageEngine {
  constructor() {
    this.db = null;
    this.config = this.loadCloudConfig();
  }

  loadCloudConfig() {
    const defaultCfg = {
      provider: 'supabase', // 'local' | 'supabase' | 'cloudinary_supabase'
      supabaseUrl: 'https://jmtdskkkximvhbtxgunp.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptdGRza2treGltdmhidHhndW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3NTI2NTYsImV4cCI6MjExMTMyODY1Nn0.pFKROneHRfVrhChjtfgVIjzQjQ9HfPcXZzQkHMnX6Ik',
      supabaseBucket: 'audios',
      cloudinaryCloudName: '',
      cloudinaryUploadPreset: '',
      userName: 'Jaasiel'
    };
    const raw = localStorage.getItem('ritmo_cloud_config');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.supabaseUrl) {
          return { ...defaultCfg, ...parsed, provider: 'supabase', supabaseUrl: defaultCfg.supabaseUrl, supabaseAnonKey: defaultCfg.supabaseAnonKey };
        }
        return { ...defaultCfg, ...parsed };
      } catch (e) {}
    }
    return defaultCfg;
  }

  saveCloudConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem('ritmo_cloud_config', JSON.stringify(this.config));
    return this.config;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('tracks')) {
          db.createObjectStore('tracks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // Save a raw binary Blob in IndexedDB (for offline cache or local uploads)
  async saveBlob(id, blob) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put({ id, blob, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(id);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getBlobUrl(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(URL.createObjectURL(req.result.blob));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  }

  async hasBlob(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').getKey(id);
      req.onsuccess = () => resolve(Boolean(req.result));
      req.onerror = () => resolve(false);
    });
  }

  async deleteBlob(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  // Upload file to active Cloud Provider (Supabase Storage or Cloudinary) + optional local cache
  async uploadFile(file, folder = 'tracks') {
    const fileId = `${folder}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = file.name ? file.name.split('.').pop() : 'mp3';
    const fileName = `${fileId}.${ext}`;

    // Always store a local copy in IndexedDB so playback is instant
    await this.saveBlob(fileId, file);

    // 1. If Cloudinary is configured for media files
    if (
      (this.config.provider === 'cloudinary_supabase' || this.config.provider === 'cloudinary') &&
      this.config.cloudinaryCloudName &&
      this.config.cloudinaryUploadPreset
    ) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', this.config.cloudinaryUploadPreset);
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${this.config.cloudinaryCloudName}/auto/upload`,
        { method: 'POST', body: formData }
      );
      if (!res.ok) throw new Error('Error al subir archivo a Cloudinary');
      const data = await res.json();
      return {
        url: data.secure_url,
        blobId: fileId,
        provider: 'cloudinary'
      };
    }

    // 2. If Supabase Storage is configured
    if (
      (this.config.provider === 'supabase' || this.config.provider === 'cloudinary_supabase') &&
      this.config.supabaseUrl &&
      this.config.supabaseAnonKey
    ) {
      const cleanUrl = this.config.supabaseUrl.replace(/\/$/, '');
      const bucket = this.config.supabaseBucket || 'audios';
      const uploadUrl = `${cleanUrl}/storage/v1/object/${bucket}/${fileName}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          apikey: this.config.supabaseAnonKey,
          Authorization: `Bearer ${this.config.supabaseAnonKey}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: file
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Error en Supabase Storage: ${errText}`);
      }
      const publicUrl = `${cleanUrl}/storage/v1/object/public/${bucket}/${fileName}`;
      return {
        url: publicUrl,
        blobId: fileId,
        provider: 'supabase'
      };
    }

    // 3. Fallback: 100% Local IndexedDB storage (works immediately without keys)
    return {
      url: `idb://${fileId}`,
      blobId: fileId,
      provider: 'local'
    };
  }

  // Sync metadata with Supabase Postgres REST API if configured
  async syncTrackToSupabase(track) {
    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) return;
    try {
      const cleanUrl = this.config.supabaseUrl.replace(/\/$/, '');
      await fetch(`${cleanUrl}/rest/v1/tracks`, {
        method: 'POST',
        headers: {
          apikey: this.config.supabaseAnonKey,
          Authorization: `Bearer ${this.config.supabaseAnonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album || '',
          category: track.category || 'Música',
          genre: track.genre || 'Rock',
          audio_url: track.audioUrl,
          cover_url: track.coverUrl,
          duration: track.duration || 0,
          liked: Boolean(track.liked),
          created_at: track.createdAt || new Date().toISOString()
        })
      });
    } catch (e) {
      console.warn('Supabase track sync skipped:', e.message);
    }
  }

  async fetchTracksFromSupabase() {
    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) return null;
    const cleanUrl = this.config.supabaseUrl.replace(/\/$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/tracks?select=*&order=created_at.desc`, {
      headers: {
        apikey: this.config.supabaseAnonKey,
        Authorization: `Bearer ${this.config.supabaseAnonKey}`
      }
    });
    if (!res.ok) throw new Error('No se pudo conectar a la tabla tracks de Supabase');
    const rows = await res.json();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      album: r.album,
      category: r.category || 'Música',
      genre: r.genre || 'Rock',
      audioUrl: r.audio_url,
      coverUrl: r.cover_url,
      duration: r.duration || 210,
      liked: r.liked,
      provider: 'supabase',
      createdAt: r.created_at
    }));
  }

  // Download a cloud audio track to IndexedDB for offline listening
  async downloadTrackForOffline(track) {
    if (!track.audioUrl || track.audioUrl.startsWith('idb://')) return true;
    const res = await fetch(track.audioUrl);
    const blob = await res.blob();
    const blobId = track.blobId || `offline_${track.id}`;
    await this.saveBlob(blobId, blob);
    return blobId;
  }

  // Resolve playable URL (prefers local cached IndexedDB blob first to save cloud bandwidth!)
  async resolvePlayableUrl(track) {
    if (track.blobId) {
      const localUrl = await this.getBlobUrl(track.blobId);
      if (localUrl) return localUrl;
    }
    if (track.audioUrl && track.audioUrl.startsWith('idb://')) {
      const id = track.audioUrl.replace('idb://', '');
      const localUrl = await this.getBlobUrl(id);
      if (localUrl) return localUrl;
    }
    return track.audioUrl;
  }

  async resolveCoverUrl(coverUrl) {
    if (!coverUrl) return '';
    if (coverUrl.startsWith('idb://')) {
      const id = coverUrl.replace('idb://', '');
      const localUrl = await this.getBlobUrl(id);
      return localUrl || '';
    }
    return coverUrl;
  }
}

window.storageEngine = new StorageEngine();
