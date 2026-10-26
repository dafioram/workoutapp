// database.js

const DB_NAME = "WorkoutAppDB";
const DB_VERSION = 4;

const EXERCISE_SOURCE =
    "https://dafioram.github.io/exercise-data/static/exercises.json";

const EXERCISE_META_SOURCE =
    "https://dafioram.github.io/exercise-data/static/version.json";

// Exercise image paths in the library are relative to the exercise-data site
const EXERCISE_DATA_BASE = "https://dafioram.github.io/exercise-data/";

// True inside the Android app (Capacitor). The web app keeps IndexedDB.
const NATIVE = window.Capacitor?.isNativePlatform?.() === true;
if (NATIVE) document.documentElement.classList.add("native");

// Workouts saved before this fix stored UTC time without the "Z", which
// JS then read back as local time. Treat any timestamp without a zone as UTC.
function parseTimestamp(ts) {
    if (!ts) return new Date(NaN);
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(ts);
    return new Date(hasZone ? ts : ts + "Z");
}

function toStoredExercise(ex) {
    return {
        ...ex,
        image: ex.image ? new URL(ex.image, EXERCISE_DATA_BASE).href : "",
        active: ex.active !== false ? 1 : 0,
        ab_workout: ex.ab_workout ? 1 : 0,
        tv_friendly: ex.tv_friendly ? 1 : 0,
        is_mobility: ex.is_mobility ? 1 : 0
    };
}

// Ask the browser not to evict our data under storage pressure.
// Safari can still clear data for sites not added to the home screen,
// so export (history page) remains the real backup.
async function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch (err) {
        console.warn("Persistent storage request failed", err);
        return false;
    }
}

// --- STORAGE ---
// The rest of this file only uses the operations below. Each backend
// implements all of them:
//   exercises: getAll(), replaceAll(list)
//   workouts:  getAll(), add(workout) -> id, addMany(list), remove(id)
//   settings:  get(key), set(key, value)

// Browsers: IndexedDB
function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 1. Store: Exercises
            if (!db.objectStoreNames.contains("exercises")) {
                const exStore = db.createObjectStore("exercises", { keyPath: "id" });
                exStore.createIndex("active", "active", { unique: false });
                exStore.createIndex("type", "type", { unique: false });
                exStore.createIndex("ab_workout", "ab_workout", { unique: false });
            }

            // 2. Store: Workouts (We don't need a junction table in IndexedDB!)
            if (!db.objectStoreNames.contains("workouts")) {
                const wkStore = db.createObjectStore("workouts", { keyPath: "id", autoIncrement: true });
                wkStore.createIndex("timestamp", "timestamp", { unique: false });
            }

            // 3. Store: Settings
            if (!db.objectStoreNames.contains("settings")) {
                db.createObjectStore("settings", { keyPath: "key" });
            }

            // v4: the app no longer has users. Drop the username index and the
            // username stored on older workouts (from the multi-user server version).
            if (event.oldVersion > 0 && event.oldVersion < 4) {
                const wkStore = event.target.transaction.objectStore("workouts");
                if (wkStore.indexNames.contains("username")) {
                    wkStore.deleteIndex("username");
                }
                wkStore.openCursor().onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) return;
                    if ("username" in cursor.value) {
                        const { username, ...rest } = cursor.value;
                        cursor.update(rest);
                    }
                    cursor.continue();
                };
            }
        };

        request.onsuccess = (event) => {
            const db = event.target.result;
            // Let a newer version of the app (e.g. in another tab) upgrade the database
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

const dbPromise = NATIVE ? null : openIndexedDB();

const indexedDBStorage = {
    exercises: {
        async getAll() {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("exercises", "readonly");
                const request = tx.objectStore("exercises").getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        async replaceAll(list) {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("exercises", "readwrite");
                const store = tx.objectStore("exercises");

                const clearRequest = store.clear();

                clearRequest.onerror = () => {
                    reject(clearRequest.error);
                };

                for (const ex of list) {
                    store.put(ex);
                }

                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }
    },

    workouts: {
        async getAll() {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("workouts", "readonly");
                const request = tx.objectStore("workouts").getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        async add(workout) {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("workouts", "readwrite");
                const request = tx.objectStore("workouts").add(workout);

                tx.oncomplete = () => resolve(request.result);
                tx.onerror = () => {
                    console.error("Workout transaction failed", tx.error);
                    reject(tx.error);
                };
            });
        },

        async addMany(list) {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("workouts", "readwrite");
                const store = tx.objectStore("workouts");
                list.forEach(w => store.add(w));
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        },

        async remove(id) {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("workouts", "readwrite");
                tx.objectStore("workouts").delete(id);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }
    },

    settings: {
        async get(key) {
            const db = await dbPromise;
            return new Promise((resolve) => {
                const tx = db.transaction("settings", "readonly");
                const request = tx.objectStore("settings").get(key);
                request.onsuccess = () => {
                    resolve(request.result ? request.result.value : null);
                };
            });
        },

        async set(key, value) {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction("settings", "readwrite");
                tx.objectStore("settings").put({ key, value });
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        }
    }
};

// Android: Capacitor Preferences. It stores strings only, so each list is one
// JSON value. Writes are queued so two saves can't overwrite each other.
const preferencesStorage = (() => {
    const prefs = () => window.Capacitor.Plugins.Preferences;

    let queue = Promise.resolve();
    const queued = (fn) => {
        const run = queue.then(fn);
        queue = run.catch(() => {});
        return run;
    };

    const read = async (key) => {
        const { value } = await prefs().get({ key });
        return value === null || value === undefined ? null : JSON.parse(value);
    };
    const write = (key, value) => prefs().set({ key, value: JSON.stringify(value) });
    const nextId = (list) => list.reduce((max, w) => Math.max(max, w.id || 0), 0) + 1;

    return {
        exercises: {
            async getAll() {
                return (await read("exercises")) || [];
            },
            replaceAll(list) {
                return queued(() => write("exercises", list));
            }
        },

        workouts: {
            async getAll() {
                return (await read("workouts")) || [];
            },
            add(workout) {
                return queued(async () => {
                    const list = (await read("workouts")) || [];
                    const id = nextId(list);
                    list.push({ ...workout, id });
                    await write("workouts", list);
                    return id;
                });
            },
            addMany(workouts) {
                return queued(async () => {
                    if (workouts.length === 0) return;
                    const list = (await read("workouts")) || [];
                    let id = nextId(list);
                    for (const w of workouts) list.push({ ...w, id: id++ });
                    await write("workouts", list);
                });
            },
            remove(id) {
                return queued(async () => {
                    const list = (await read("workouts")) || [];
                    await write("workouts", list.filter(w => w.id !== id));
                });
            }
        },

        settings: {
            get(key) {
                return read("setting:" + key);
            },
            set(key, value) {
                return queued(() => write("setting:" + key, value));
            }
        }
    };
})();

const storage = NATIVE ? preferencesStorage : indexedDBStorage;

// A fetch that gives up after `ms`, so a weak signal ("connected" but no
// data getting through) can't leave the app waiting indefinitely.
async function fetchWithTimeout(url, options = {}, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function getRemoteExerciseVersion() {
    const response = await fetchWithTimeout(EXERCISE_META_SOURCE, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("Failed to load exercise version");
    }

    const data = await response.json();

    if (!data.exercisesVersion) {
        throw new Error("Invalid exercise version response");
    }

    return data.exercisesVersion;
}

// --- SEEDING LOGIC ---
async function initDB() {
    // Opens IndexedDB on the web, so a failure is reported here
    await dbPromise;

    requestPersistentStorage();

    const existing = await storage.exercises.getAll();

    // First install requires download
    if (existing.length === 0) {
        try {
            const remoteVersion = await getRemoteExerciseVersion();
            await reloadExercises();
            await setSetting("exerciseVersion", remoteVersion);
            // Just downloaded; the next page doesn't need to check again
            sessionStorage.setItem("exerciseUpdateCheckedAt", String(Date.now()));
        }
        catch(err) {
            console.error(
                "Unable to download initial exercise database",
                err
            );
            throw err;
        }

        return;
    }

    // Existing database: the app is ready now. Check for a newer exercise
    // library in the background so pages never wait on the network.
    checkForExerciseUpdate();
}

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function checkForExerciseUpdate() {
    // Moving between pages shouldn't re-check every time
    const lastCheck = Number(sessionStorage.getItem("exerciseUpdateCheckedAt")) || 0;
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    sessionStorage.setItem("exerciseUpdateCheckedAt", String(Date.now()));

    try {
        const remoteVersion = await getRemoteExerciseVersion();
        const localVersion = await getSetting("exerciseVersion");

        if (remoteVersion !== localVersion) {
            await reloadExercises();
            await setSetting("exerciseVersion", remoteVersion);
            window.dispatchEvent(new Event("exercises-updated"));
        }
    } catch (err) {
        sessionStorage.removeItem("exerciseUpdateCheckedAt");
        console.warn("Skipping exercise update check (offline or slow network).", err);
    }
}

async function replaceExercises(exercises) {
    return storage.exercises.replaceAll(exercises.map(toStoredExercise));
}

// --- READ OPERATIONS ---
async function getAllExercises(workoutType = "any") {
    let exercises = (await storage.exercises.getAll()).filter(ex => ex.active === 1);

    if (workoutType === "core") {
        exercises = exercises.filter(ex => ex.ab_workout === 1);
    } else if (workoutType === "mobility") {
        exercises = exercises.filter(ex => ex.is_mobility === 1);
    } else if (workoutType === "tv") {
        exercises = exercises.filter(ex => ex.tv_friendly === 1);
    } else if (workoutType === "cardio") {
        exercises = exercises.filter(ex => ex.type === "cardio");
    }
    return exercises;
}

async function reloadExercises() {
    const response = await fetchWithTimeout(EXERCISE_SOURCE, {}, 15000);

    if (!response.ok) {
        throw new Error("Failed to load exercises.json");
    }

    const exercises = await response.json();

    if (!Array.isArray(exercises) || exercises.length === 0) {
        throw new Error("Invalid exercise library");
    }

    return replaceExercises(exercises);
}

async function updateExerciseLibrary(version) {
	await reloadExercises();
	await setSetting("exerciseVersion", version);
}

async function getDBStatus() {
    if (NATIVE) return { backend: "capacitor-preferences" };

    const db = await dbPromise;
    return {
        version: db.version,
        stores: [...db.objectStoreNames]
    };
}

async function getExerciseMap() {
    const exercises = await getAllExercises("any");
    return exercises.reduce((map, ex) => {
        map[ex.id] = ex;
        return map;
    }, {});
}

// All saved workouts, newest first
async function getWorkouts() {
    const workouts = await getAllWorkouts();
    return workouts.sort((a, b) =>
        parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp)
    );
}

async function getSetting(key) {
    return storage.settings.get(key);
}

async function setSetting(key, value) {
    return storage.settings.set(key, value);
}

// --- WRITE OPERATIONS ---
// Resolves with the saved workout (including its new id)
async function insertWorkout(exercises, numSets, exDuration, restDuration, setRest, location = "home", rpe = 5, notes = "") {
    const workoutData = {
        timestamp: new Date().toISOString(),
        num_sets: Number(numSets),
        exercise_duration: Number(exDuration),
        rest_duration: Number(restDuration),
        set_rest: Number(setRest),
        location,
        rpe,
        notes,
        exercises: exercises.map((ex, idx) => ({
            id: ex.id,
            name: ex.name || `Unknown (${ex.id})`,
            muscle: ex.muscle || "Other",
            order_index: idx
        }))
    };

    const id = await storage.workouts.add(workoutData);
    return { ...workoutData, id };
}

// --- BACKUP ---
async function getAllWorkouts() {
    return storage.workouts.getAll();
}

async function deleteWorkout(id) {
    return storage.workouts.remove(id);
}

// Adds workouts from a backup, skipping any already stored
// (same time). Returns { added, skipped }.
async function importWorkouts(workouts) {
    const keyOf = (w) => parseTimestamp(w.timestamp).getTime();
    const existing = new Set((await getAllWorkouts()).map(keyOf));

    const toAdd = [];
    let skipped = 0;
    for (const w of workouts) {
        const valid = w && typeof w.timestamp === "string"
            && !isNaN(parseTimestamp(w.timestamp))
            && Array.isArray(w.exercises);
        if (!valid || existing.has(keyOf(w))) {
            skipped++;
            continue;
        }
        existing.add(keyOf(w));
        const { id, username, ...rest } = w;
        toAdd.push(rest);
    }

    await storage.workouts.addMany(toAdd);

    return { added: toAdd.length, skipped };
}

// Export for other scripts (if using ES modules, otherwise these are global)
window.DB = {
    initDB,
    reloadExercises,
	updateExerciseLibrary,
    getAllExercises,
    getExerciseMap,
    getWorkouts,
    insertWorkout,
    getSetting,
    setSetting,
	getDBStatus,
    parseTimestamp,
    getAllWorkouts,
    deleteWorkout,
    importWorkouts,
    requestPersistentStorage,
    isNative: NATIVE
};
