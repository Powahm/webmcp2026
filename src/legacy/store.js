/* ============================================================
   Store: clips and scripts, persisted in IndexedDB.
   Falls back to memory when IDB is unavailable (private mode,
   sandboxed frames) so nothing above this layer has to care.
   ============================================================ */

export const Store = (() => {
  const DB = "desk-two";
  // Bumped for "aiskills". onupgradeneeded creates any store that is missing,
  // so an existing tab picks the new one up without losing its clips.
  const VERSION = 2;
  const STORES = ["clips", "scripts", "aiskills"];

  let db = null;
  let usable = true;
  // Derived from STORES rather than written out, so adding a store cannot
  // leave the memory fallback missing one. It did exactly that once.
  const memory = Object.fromEntries(STORES.map((name) => [name, new Map()]));
  const listeners = new Map();

  const open = () =>
    new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB, VERSION);
      } catch {
        usable = false;
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        STORES.forEach((name) => {
          if (!req.result.objectStoreNames.contains(name)) {
            req.result.createObjectStore(name, { keyPath: "id" });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { usable = false; resolve(null); };
      req.onblocked = () => { usable = false; resolve(null); };
    });

  const ready = (async () => { db = await open(); })();

  function tx(name, mode) {
    if (!db || !usable) return null;
    try { return db.transaction(name, mode).objectStore(name); }
    catch { return null; }
  }

  function emit(name) {
    (listeners.get(name) || []).forEach((fn) => fn());
  }

  const api = {
    ready,
    get persistent() { return usable && !!db; },

    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => {
        const list = listeners.get(name).filter((f) => f !== fn);
        listeners.set(name, list);
      };
    },

    async all(name) {
      await ready;
      const store = tx(name, "readonly");
      if (!store) return [...memory[name].values()].sort((a, b) => a.created - b.created);
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.created - b.created));
        req.onerror = () => resolve([]);
      });
    },

    async put(name, record) {
      await ready;
      memory[name].set(record.id, record);
      const store = tx(name, "readwrite");
      if (store) {
        await new Promise((resolve) => {
          const req = store.put(record);
          req.onsuccess = resolve;
          req.onerror = resolve;
        });
      }
      emit(name);
      return record;
    },

    async del(name, id) {
      await ready;
      memory[name].delete(id);
      const store = tx(name, "readwrite");
      if (store) {
        await new Promise((resolve) => {
          const req = store.delete(id);
          req.onsuccess = resolve;
          req.onerror = resolve;
        });
      }
      emit(name);
    }
  };

  return api;
})();

/* ---------- clip helpers shared by camera, editor and scripts ---------- */

export const Clips = (() => {
  const urls = new Map();

  /* MediaRecorder webm often reports Infinity until it is forced to seek */
  function measure(video) {
    return new Promise((resolve) => {
      if (Number.isFinite(video.duration) && video.duration > 0) return resolve(video.duration);
      const bail = setTimeout(() => resolve(0), 3000);
      video.currentTime = 1e101;
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        clearTimeout(bail);
        const d = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = 0;
        resolve(d);
      };
    });
  }

  function poster(video) {
    try {
      const canvas = document.createElement("canvas");
      const ratio = video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
      canvas.width = 320;
      canvas.height = Math.round(320 / (ratio || 16 / 9));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return "";
    }
  }

  return {
    url(clip) {
      if (!urls.has(clip.id)) urls.set(clip.id, URL.createObjectURL(clip.blob));
      return urls.get(clip.id);
    },

    release(id) {
      if (urls.has(id)) {
        URL.revokeObjectURL(urls.get(id));
        urls.delete(id);
      }
    },

    /* probe a blob for duration, dimensions and a thumbnail */
    async describe(blob) {
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.src = url;

      const meta = await new Promise((resolve) => {
        const bail = setTimeout(() => resolve(null), 6000);
        video.onloadeddata = () => { clearTimeout(bail); resolve(true); };
        video.onerror = () => { clearTimeout(bail); resolve(null); };
      });

      let duration = 0;
      let thumb = "";
      let width = 0;
      let height = 0;

      if (meta) {
        duration = await measure(video);
        width = video.videoWidth;
        height = video.videoHeight;
        try {
          video.currentTime = Math.min(0.1, duration / 4);
          await new Promise((r) => {
            const bail = setTimeout(r, 1500);
            video.onseeked = () => { clearTimeout(bail); r(); };
          });
        } catch { /* seek unsupported, poster from frame 0 */ }
        thumb = poster(video);
      }

      URL.revokeObjectURL(url);
      return { duration, thumb, width, height };
    },

    async save(blob, { name, kind = "recording" } = {}) {
      const info = await Clips.describe(blob);
      const clip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name || "Untitled clip",
        kind,
        blob,
        created: Date.now(),
        ...info
      };
      await Store.put("clips", clip);
      return clip;
    },

    all: () => Store.all("clips"),

    async remove(id) {
      Clips.release(id);
      await Store.del("clips", id);
    }
  };
})();

/**
 * seconds -> 00:00:07 / 00:01:04 / 01:12:30
 *
 * Fixed width, hours first, so a duration never changes shape as it grows and
 * two durations stacked in a list line up on the same digits. Two hour digits
 * carry a ten hour take, which is longer than anything this app can record in
 * one go, and the pad is unconditional because a column of `9:59` above
 * `10:00` is the misreading this replaced.
 */
export const pad2 = (n) => String(Math.floor(Math.max(0, n))).padStart(2, "0");

export function timecode(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  return `${pad2(whole / 3600)}:${pad2((whole % 3600) / 60)}:${pad2(whole % 60)}`;
}
