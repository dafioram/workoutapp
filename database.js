// database.js

const DB_NAME = "WorkoutAppDB";
const DB_VERSION = 1;

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
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
});

// --- SEEDING LOGIC ---
async function initDB() {
    const db = await dbPromise;

    const tx = db.transaction("exercises");
    const count = await new Promise(resolve => {
        const req = tx.objectStore("exercises").count();
        req.onsuccess = () => resolve(req.result);
    });

    if (count === 0) {
        await reloadExercises();
    }
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

    await new Promise((resolve, reject) => {
        const tx = db.transaction("exercises", "readwrite");
        tx.objectStore("exercises").clear();

        tx.oncomplete = resolve;
        tx.onerror = reject;
    });

    const tx = db.transaction("exercises", "readwrite");
    const store = tx.objectStore("exercises");

	const exercises = window.EXERCISES;

	if (!Array.isArray(exercises)) {
		throw new Error(
			"Exercises have not been loaded. Make sure static/exercises.js is included before database.js."
		);
	}

	for (const ex of exercises) {
    store.put({
        ...ex,
        active: ex.active !== false ? 1 : 0,
        ab_workout: ex.ab_workout ? 1 : 0
    });
	}

    return new Promise(resolve => {
        tx.oncomplete = resolve;
    });
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
    getAllExercises,
    getExerciseMap,
    getWorkoutsForUser,
    getAllUsers,
    insertWorkout
};