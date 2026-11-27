// Client-side Audio Metadata & Embedded Cover Art Extractor
// Supports FLAC (STREAMINFO + VORBIS_COMMENT + PICTURE), MP3 (ID3v2 TIT2/TPE1/TALB/TCON/APIC),
// and fallback HTML5 Audio duration detection.

class AudioMetadataReader {
  static async extract(file) {
    const meta = {
      title: '',
      artist: '',
      album: '',
      genre: '',
      trackNumber: '',
      year: '',
      duration: 0,
      coverBlob: null,
      coverUrl: ''
    };

    try {
      const buffer = await file.slice(0, Math.min(file.size, 6 * 1024 * 1024)).arrayBuffer();
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);

      // 1. Check FLAC ("fLaC")
      if (
        bytes.length > 4 &&
        bytes[0] === 0x66 &&
        bytes[1] === 0x4c &&
        bytes[2] === 0x61 &&
        bytes[3] === 0x43
      ) {
        this.parseFlac(view, bytes, meta);
      }
      // 2. Check ID3v2 ("ID3") for MP3
      else if (
        bytes.length > 10 &&
        bytes[0] === 0x49 &&
        bytes[1] === 0x44 &&
        bytes[2] === 0x33
      ) {
        this.parseID3v2(view, bytes, meta);
      }
    } catch (err) {
      console.warn('Metadata binary parse warning:', err);
    }

    // 3. Always verify or fill duration via HTML5 Audio element
    if (!meta.duration) {
      meta.duration = await this.getAudioElementDuration(file);
    }

    // 4. Fallback title/artist from filename if tags were empty
    if (!meta.title) {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      if (baseName.includes(' - ')) {
        const parts = baseName.split(' - ');
        if (!meta.artist) meta.artist = parts[0].trim();
        meta.title = parts.slice(1).join(' - ').trim();
      } else {
        meta.title = baseName;
      }
    }

    if (meta.coverBlob) {
      meta.coverUrl = URL.createObjectURL(meta.coverBlob);
    }

    return meta;
  }

  static parseFlac(view, bytes, meta) {
    let offset = 4;
    let isLast = false;
    const decUtf8 = new TextDecoder('utf-8');
    const decAscii = new TextDecoder('ascii');

    while (!isLast && offset + 4 <= bytes.length) {
      const header = bytes[offset];
      isLast = (header & 0x80) !== 0;
      const type = header & 0x7f;
      const len = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 4;
      const blockEnd = offset + len;
      if (blockEnd > bytes.length) break;

      if (type === 0 && len >= 34) {
        // STREAMINFO
        const sr = (bytes[offset + 10] << 12) | (bytes[offset + 11] << 4) | ((bytes[offset + 12] >> 4) & 0x0f);
        const hi = bytes[offset + 13] & 0x0f;
        const lo =
          bytes[offset + 14] * 16777216 +
          (bytes[offset + 15] << 16) +
          (bytes[offset + 16] << 8) +
          bytes[offset + 17];
        const totalSamples = hi * 4294967296 + lo;
        if (sr > 0 && totalSamples > 0) {
          meta.duration = Math.round(totalSamples / sr);
        }
      } else if (type === 4) {
        // VORBIS_COMMENT (little-endian)
        let p = offset;
        const vendorLen = view.getUint32(p, true);
        p += 4 + vendorLen;
        if (p + 4 <= blockEnd) {
          const count = view.getUint32(p, true);
          p += 4;
          for (let i = 0; i < count && p + 4 <= blockEnd; i++) {
            const cLen = view.getUint32(p, true);
            p += 4;
            if (p + cLen > blockEnd) break;
            const str = decUtf8.decode(bytes.subarray(p, p + cLen));
            p += cLen;
            const eq = str.indexOf('=');
            if (eq > 0) {
              const k = str.slice(0, eq).toUpperCase();
              const v = str.slice(eq + 1).trim();
              if (k === 'TITLE' && !meta.title) meta.title = v;
              if ((k === 'ARTIST' || k === 'ALBUMARTIST') && !meta.artist) meta.artist = v;
              if (k === 'ALBUM' && !meta.album) meta.album = v;
              if (k === 'GENRE' && !meta.genre) meta.genre = v;
              if (k === 'DATE' || k === 'YEAR') meta.year = v;
              if (k === 'TRACKNUMBER') meta.trackNumber = v;
            }
          }
        }
      } else if (type === 6 && !meta.coverBlob) {
        // PICTURE (big-endian)
        let p = offset;
        p += 4; // picture type
        const mimeLen = view.getUint32(p, false);
        p += 4;
        const mime = decAscii.decode(bytes.subarray(p, p + mimeLen)) || 'image/jpeg';
        p += mimeLen;
        const descLen = view.getUint32(p, false);
        p += 4 + descLen + 16; // skip width, height, depth, colors
        if (p + 4 <= blockEnd) {
          const dataLen = view.getUint32(p, false);
          p += 4;
          if (dataLen > 0 && p + dataLen <= blockEnd) {
            const imgBytes = bytes.slice(p, p + dataLen);
            meta.coverBlob = new Blob([imgBytes], { type: mime });
          }
        }
      }
      offset = blockEnd;
    }
  }

  static parseID3v2(view, bytes, meta) {
    const version = bytes[3];
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    let offset = 10;
    const limit = Math.min(bytes.length, 10 + tagSize);
    const decAscii = new TextDecoder('ascii');

    while (offset + 10 <= limit) {
      const frameId = decAscii.decode(bytes.subarray(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      let frameSize = 0;
      if (version === 4) {
        frameSize =
          ((bytes[offset + 4] & 0x7f) << 21) |
          ((bytes[offset + 5] & 0x7f) << 14) |
          ((bytes[offset + 6] & 0x7f) << 7) |
          (bytes[offset + 7] & 0x7f);
      } else {
        frameSize = view.getUint32(offset + 4, false);
      }

      offset += 10;
      if (frameSize <= 0 || offset + frameSize > limit) break;

      const content = bytes.subarray(offset, offset + frameSize);

      if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB' || frameId === 'TCON') {
        const text = this.decodeID3Text(content);
        if (frameId === 'TIT2' && !meta.title) meta.title = text;
        if (frameId === 'TPE1' && !meta.artist) meta.artist = text;
        if (frameId === 'TALB' && !meta.album) meta.album = text;
        if (frameId === 'TCON' && !meta.genre) meta.genre = text;
      } else if (frameId === 'APIC' && !meta.coverBlob) {
        const encoding = content[0];
        let p = 1;
        while (p < content.length && content[p] !== 0) p++;
        const mime = decAscii.decode(content.subarray(1, p)) || 'image/jpeg';
        p++; // skip null
        p++; // skip picture type
        // skip description null terminator
        if (encoding === 1 || encoding === 2) {
          while (p + 1 < content.length && !(content[p] === 0 && content[p + 1] === 0)) p += 2;
          p += 2;
        } else {
          while (p < content.length && content[p] !== 0) p++;
          p++;
        }
        if (p < content.length) {
          meta.coverBlob = new Blob([content.slice(p)], { type: mime });
        }
      }

      offset += frameSize;
    }
  }

  static decodeID3Text(bytes) {
    if (!bytes.length) return '';
    const enc = bytes[0];
    const data = bytes.subarray(1);
    let str = '';
    if (enc === 0) str = new TextDecoder('iso-8859-1').decode(data);
    else if (enc === 1) str = new TextDecoder('utf-16').decode(data);
    else if (enc === 2) str = new TextDecoder('utf-16be').decode(data);
    else str = new TextDecoder('utf-8').decode(data);
    return str.replace(/\0/g, '').trim();
  }

  static getAudioElementDuration(file) {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      audio.preload = 'metadata';
      const cleanup = (val) => {
        URL.revokeObjectURL(url);
        resolve(val);
      };
      audio.onloadedmetadata = () => cleanup(Math.round(audio.duration || 0));
      audio.onerror = () => cleanup(210);
      setTimeout(() => cleanup(210), 4000);
      audio.src = url;
    });
  }
}

window.AudioMetadataReader = AudioMetadataReader;
