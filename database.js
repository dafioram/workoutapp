// database.js

const DB_NAME = "WorkoutAppDB";
const DB_VERSION = 3;

const EXERCISE_SOURCE =
    "https://dafioram.github.io/exercise-data/static/exercises.json";
	
const EXERCISE_META_SOURCE =
    "https://dafioram.github.io/exercise-data/static/version.json";

// Exercise image paths in the library are relative to the exercise-data site
const EXERCISE_DATA_BASE = "https://dafioram.github.io/exercise-data/";

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
        tv_friendly: ex.tv_friendly ? 1 : 0
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

const dbPromise = new Promise((resolve, reject) => {
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
            wkStore.createIndex("username", "username", { unique: false });
            wkStore.createIndex("timestamp", "timestamp", { unique: false });
        }
		
		// 3. Store: Settings
		if (!db.objectStoreNames.contains("settings")) {
			db.createObjectStore("settings", { keyPath: "key" });
		}
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
});

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
    const db = await dbPromise;

    requestPersistentStorage();

    const count = await new Promise(resolve => {
        const tx = db.transaction("exercises");
        const req = tx.objectStore("exercises").count();

        req.onsuccess = () => resolve(req.result);
    });

    // First install requires download
	if (count === 0) {
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
    const db = await dbPromise;

    return new Promise((resolve, reject) => {
        const tx = db.transaction("exercises", "readwrite");
        const store = tx.objectStore("exercises");

        const clearRequest = store.clear();

        clearRequest.onerror = () => {
            reject(clearRequest.error);
        };

        for (const ex of exercises) {
            store.put(toStoredExercise(ex));
        }

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// --- READ OPERATIONS ---
async function getAllExercises(workoutType = "any") {
    const db = await dbPromise;
    return new Promise((resolve) => {
        const tx = db.transaction("exercises", "readonly");
        const store = tx.objectStore("exercises");
        const request = store.getAll();
        
        request.onsuccess = () => {
            let exercises = request.result.filter(ex => ex.active === 1);
            
            if (workoutType === "core") {
                exercises = exercises.filter(ex => ex.ab_workout === 1);
            } else if (workoutType === "tv") {
                exercises = exercises.filter(ex => ex.tv_friendly === 1);
            } else if (workoutType === "cardio") {
                exercises = exercises.filter(ex => ex.type === "cardio");
            }
            resolve(exercises);
        };
    });
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

async function getDBStatus(){

    const db = await dbPromise;

    return {
        version: db.version,
        stores:[...db.objectStoreNames]
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
    const db = await dbPromise;

    return new Promise((resolve) => {
        const tx = db.transaction("settings", "readonly");
        const store = tx.objectStore("settings");
        const request = store.get(key);

        request.onsuccess = () => {
            resolve(request.result ? request.result.value : null);
        };
    });
}


async function setSetting(key, value) {
    const db = await dbPromise;

    return new Promise((resolve, reject) => {
        const tx = db.transaction("settings", "readwrite");
        const store = tx.objectStore("settings");

        store.put({
            key,
            value
        });

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

// --- WRITE OPERATIONS ---
async function insertWorkout(exercises, numSets, exDuration, restDuration, setRest, location = "home", rpe = 5, notes = "") {
    const db = await dbPromise;

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

    console.log("Saving workout:", workoutData);

    return new Promise((resolve, reject) => {
        const tx = db.transaction("workouts", "readwrite");
        const store = tx.objectStore("workouts");

        store.add(workoutData);

        tx.oncomplete = () => {
            console.log("Workout transaction complete");
            resolve();
        };

        tx.onerror = () => {
            console.error("Workout transaction failed", tx.error);
            reject(tx.error);
        };
    });
}

// --- BACKUP ---
async function getAllWorkouts() {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction("workouts", "readonly");
        const request = tx.objectStore("workouts").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
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
        const { id, ...rest } = w;
        toAdd.push(rest);
    }

    const db = await dbPromise;
    await new Promise((resolve, reject) => {
        const tx = db.transaction("workouts", "readwrite");
        const store = tx.objectStore("workouts");
        toAdd.forEach(w => store.add(w));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

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
    importWorkouts,
    requestPersistentStorage
};