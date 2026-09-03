/* ============================================================
   Store: clips and scripts, persisted in IndexedDB.
   Falls back to memory when IDB is unavailable (private mode,
   sandboxed frames) so nothing above this layer has to care.
   ============================================================ */

export const Store = (() => {
  const DB = "desk-two";
  // Bumped for "libfolders". onupgradeneeded creates any store that is missing,
  // so an existing tab picks the new one up without losing its clips.
  const VERSION = 3;
  const STORES = ["clips", "scripts", "aiskills", "libfolders"];

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

/**
 * What to say about a file whose picture this browser will not draw.
 *
 * Almost always a codec rather than a broken file: .mp4 is a container, and
 * the H.265 inside one straight off a phone or a Mac screen recording is not
 * something most browsers will decode, while the AAC beside it plays happily.
 * That is why it arrives as a black picture with sound rather than as an
 * error. The advice is the useful part -- the file is fine, it needs
 * re-encoding to H.264 or WebM -- so it is written once and used everywhere
 * this comes up.
 */
export function noPictureMessage(names) {
  const list = Array.isArray(names) ? names : [names];
  const what = list.length === 1 ? `“${list[0]}”` : `${list.length} files`;
  return `${what}: sound imported, but this browser cannot decode the picture. Re-encode to H.264 or WebM.`;
}

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

      /**
       * Metadata, not the first frame.
       *
       * `loadedmetadata` is where duration and dimensions arrive, and it comes
       * a long time before `loadeddata` on a big import: an .mp4 written
       * without faststart keeps its index at the end of the file, so nothing
       * decodes until the whole thing has been read. Waiting for a frame here
       * is what used to time an honest hour-long recording out and file it
       * under "zero seconds long".
       */
      const meta = await new Promise((resolve) => {
        const bail = setTimeout(() => resolve("timeout"), 15000);
        video.onloadedmetadata = () => { clearTimeout(bail); resolve("ok"); };
        video.onerror = () => { clearTimeout(bail); resolve("error"); };
      });

      let duration = 0;
      let thumb = "";
      let width = 0;
      let height = 0;
      // Undefined, not false: "we never got far enough to look" is a different
      // answer from "we looked and there is no picture", and only the second
      // one is worth telling somebody their file is unplayable over.
      let hasPicture;

      if (meta === "ok") {
        duration = await measure(video);
        width = video.videoWidth;
        height = video.videoHeight;
        hasPicture = width > 0 && height > 0;
      }

      if (hasPicture) {
        // Now a frame is worth waiting for, because there is one to draw.
        await new Promise((r) => {
          if (video.readyState >= 2) return r();
          const bail = setTimeout(r, 8000);
          video.onloadeddata = () => { clearTimeout(bail); r(); };
        });
        try {
          video.currentTime = Math.min(0.1, duration / 4);
          await new Promise((r) => {
            const bail = setTimeout(r, 1500);
            video.onseeked = () => { clearTimeout(bail); r(); };
          });
        } catch { /* seek unsupported, poster from frame 0 */ }
        thumb = poster(video);
      }

      video.src = "";
      URL.revokeObjectURL(url);
      /**
       * Whether this browser can actually draw the file, as opposed to open it.
       *
       * A container and a codec are different questions. An .mp4 whose video
       * track is H.265, or AV1 on a browser without it, loads and plays its
       * audio perfectly while the picture never arrives: no error fires,
       * because as far as the element is concerned it has a track it can play.
       * The tell is that the video has no dimensions. Recording it here is what
       * lets the rest of the app say so, rather than showing a black rectangle
       * and leaving someone to wonder which of the two of us is broken.
       */
      return { duration, thumb, width, height, hasPicture };
    },

    async save(blob, { name, kind = "recording", folder = null } = {}) {
      const info = await Clips.describe(blob);
      const clip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name || "Untitled clip",
        kind,
        // Which library folder it belongs to, or null for the loose pile at
        // the top. A clip saved while a folder is open lands in that folder,
        // because filing a thing after the fact is the step nobody does.
        folder,
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

/* ---------- library folders ---------- */

/**
 * Folders are records, not a property derived from the clips in them.
 *
 * The cheap version of this reads the distinct folder names off the library and
 * calls that the folder list, which works until someone makes a folder and puts
 * nothing in it yet: it vanishes between one render and the next. A folder you
 * cannot make before you have something to put in it is not a folder, so they
 * are stored, and a clip points at one by id.
 */
export const Folders = (() => {
  const clean = (name) => String(name ?? "").trim().slice(0, 40);

  return {
    all: () => Store.all("libfolders"),

    async add(name) {
      const folder = {
        id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: clean(name) || "New folder",
        created: Date.now(),
      };
      await Store.put("libfolders", folder);
      return folder;
    },

    async rename(id, name) {
      const folder = (await Folders.all()).find((f) => f.id === id);
      if (!folder || !clean(name)) return null;
      folder.name = clean(name);
      await Store.put("libfolders", folder);
      return folder;
    },

    /**
     * Deleting a folder empties it. It does not delete what was in it.
     *
     * Two things share the one word here: the folder, and the footage inside
     * it. Only one of those can be replaced by recording it again, so the
     * clips are unfiled rather than removed, and the person can lose a folder
     * without losing a shoot.
     */
    async remove(id) {
      const clips = await Store.all("clips");
      for (const clip of clips) {
        if (clip.folder !== id) continue;
        clip.folder = null;
        await Store.put("clips", clip);
      }
      await Store.del("libfolders", id);
    },

    async move(clipId, folderId) {
      const clip = (await Store.all("clips")).find((c) => c.id === clipId);
      if (!clip) return null;
      clip.folder = folderId || null;
      await Store.put("clips", clip);
      return clip;
    },
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
