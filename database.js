// database.js

const DB_NAME = "WorkoutAppDB";
const DB_VERSION = 3;

const EXERCISE_SOURCE =
    "https://dafioram.github.io/exercise-data/static/exercises.json";
	
const EXERCISE_META_SOURCE =
    "https://dafioram.github.io/exercise-data/static/version.json";

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

async function getRemoteExerciseVersion() {
    const response = await fetch(EXERCISE_META_SOURCE, {
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

    // Existing database:
    // app works even without internet
    try {
        const remoteVersion = await getRemoteExerciseVersion();
        const localVersion = await getSetting("exerciseVersion");

        if (remoteVersion !== localVersion) {
            await reloadExercises();
            await setSetting("exerciseVersion", remoteVersion);
        }

    } catch(err) {
        console.warn(
            "Skipping exercise update check. Offline mode.",
            err
        );
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
            store.put({
                ...ex,
                active: ex.active !== false ? 1 : 0,
                ab_workout: ex.ab_workout ? 1 : 0
            });
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
            } else if (workoutType === "cardio") {
                exercises = exercises.filter(ex => ex.type === "cardio");
            }
            resolve(exercises);
        };
    });
}

async function reloadExercises() {
    const db = await dbPromise;

    const response = await fetch(EXERCISE_SOURCE);

    if (!response.ok) {
        throw new Error("Failed to load exercises.json");
    }

    const exercises = await response.json();

    if (!Array.isArray(exercises) || exercises.length === 0) {
        throw new Error("Invalid exercise library");
    }

    return new Promise((resolve, reject) => {

        const tx = db.transaction(
            "exercises",
            "readwrite"
        );

        const store = tx.objectStore("exercises");

        const clearRequest = store.clear();

        clearRequest.onerror = () => {
            reject(clearRequest.error);
        };

        for (const ex of exercises) {
            store.put({
                ...ex,
                active: ex.active !== false ? 1 : 0,
                ab_workout: ex.ab_workout ? 1 : 0
            });
        }

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
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

async function getWorkoutsForUser(username) {
    const db = await dbPromise;
    return new Promise((resolve) => {
        const tx = db.transaction("workouts", "readonly");
        const store = tx.objectStore("workouts");
        const index = store.index("username");
        const request = index.getAll(IDBKeyRange.only(username));
        
        request.onsuccess = () => {
            // Sort descending by timestamp like the SQL query
            const workouts = request.result.sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );
            resolve(workouts);
        };
    });
}

async function getAllUsers() {
    const db = await dbPromise;
    return new Promise((resolve) => {
        const tx = db.transaction("workouts", "readonly");
        const store = tx.objectStore("workouts");
        const request = store.getAll();
        
        request.onsuccess = () => {
            const users = new Set(request.result.map(w => w.username));
            resolve(Array.from(users).sort());
        };
    });
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
async function insertWorkout(username, exercises, numSets, exDuration, restDuration, setRest, location = "home", rpe = 5, notes = "") {
    const db = await dbPromise;

    const workoutData = {
        username,
        timestamp: new Date().toISOString().split('.')[0],
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

// Export for other scripts (if using ES modules, otherwise these are global)
window.DB = {
    initDB,
    reloadExercises,
    replaceExercises,
	updateExerciseLibrary,
    getAllExercises,
    getExerciseMap,
    getWorkoutsForUser,
    getAllUsers,
    insertWorkout,
    getSetting,
    setSetting,
	getDBStatus
};