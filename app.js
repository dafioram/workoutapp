// app.js

// The Android app bundles its files, so it doesn't need a service worker
if ("serviceWorker" in navigator && !window.DB?.isNative) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js")
            .then(reg => {
                console.log(
                    "Service worker registered:",
                    reg.scope
                );
            })
            .catch(err => {
                console.error(
                    "Service worker failed:",
                    err
                );
            });
    });
}

// --- SESSION MANAGEMENT (Mimics Flask session) ---
const Session = {
	get: (key, def = null) => {
		const val = sessionStorage.getItem(key);

		if (val === null) {
			return def;
		}

		try {
			return JSON.parse(val);
		} catch (e) {
			// Handle old unencoded sessionStorage values
			return val;
		}
	},
    set: (key, val) => {
        sessionStorage.setItem(key, JSON.stringify(val));
    },
    remove: (key) => sessionStorage.removeItem(key)
};

// --- HELPER FUNCTIONS ---
function calculateTotalTime(numExercises, numSets, exDuration, restDuration, setRest) {
    if (numExercises <= 0 || numSets <= 0) return 0;
    const timePerSet = (numExercises * exDuration) + ((numExercises - 1) * restDuration);
    const total = (numSets * timePerSet) + ((numSets - 1) * setRest);
    return total;
}

// "YYYY-MM-DD HH:MM" in the phone's local time
function formatLocalDateTime(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ` +
           `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${mins}m ${sec}s`;
}

// --- ANALYSIS AGGREGATION LOGIC ---
// Replaces the Python logic found in @app.route('/analysis')
function getISOWeek(dateObj) {
    const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

async function getAnalysisData() {
    const workouts = await window.DB.getWorkouts();
    const exerciseMap = await window.DB.getExerciseMap();
    
    // Sort asc for charts
    const workoutsSorted = [...workouts].reverse();
    
    let trendLabels = [];
    let trendExercise = [];
    let trendRest = [];
    
    const aggregate = (by = "week") => {
        const totals = {};
        
        workoutsSorted.forEach(w => {
            if (!w.timestamp) return;
            const dt = window.DB.parseTimestamp(w.timestamp);
            
            const key = by === "week" ? getISOWeek(dt) : `${dt.getFullYear()}-${(dt.getMonth()+1).toString().padStart(2, '0')}`;
            
            if (!totals[key]) {
                totals[key] = { exercise: 0, rest: 0, muscles: {}, workout_count: 0 };
            }
            
            const numSets = parseInt(w.num_sets || 1);
            const exDur = parseInt(w.exercise_duration || 0);
            const restDur = parseInt(w.rest_duration || 0);
            const setRest = parseInt(w.set_rest || 0);
            const numEx = w.exercises ? w.exercises.length : 0;
            
            const exTime = numSets * numEx * exDur;
            const rTime = (numSets * Math.max(0, numEx - 1) * restDur) + (Math.max(0, numSets - 1) * setRest);
            
            totals[key].exercise += exTime;
            totals[key].rest += rTime;
            totals[key].workout_count += 1;
            
            // Build Trend Arrays while iterating (only need to do it once)
            if (by === "week") {
                trendLabels.push(formatLocalDateTime(dt));
                trendExercise.push(exTime);
                trendRest.push(rTime);
            }
            
            // Muscle calculations
            w.exercises.forEach(ex => {
                let muscle = ex.muscle || "Other";
                if (muscle === "Other" || !muscle) {
                    const dbEx = exerciseMap[ex.id];
                    if (dbEx) muscle = dbEx.muscle || "Other";
                }
                const t = numSets * exDur;
                totals[key].muscles[muscle] = (totals[key].muscles[muscle] || 0) + t;
            });
        });
        
        // Sort the object keys naturally
        return Object.keys(totals).sort().reduce(
            (obj, key) => { 
                obj[key] = totals[key]; 
                return obj;
            }, 
            {}
        );
    };

    const weekly = aggregate("week");
    const monthly = aggregate("month");

    return {
        trendLabels, trendExercise, trendRest, weekly, monthly
    };
}

// --- WORKOUT FILES (export / import) ---
// One format for a single workout and for a full backup:
//   {
//     "app": "workoutapp",
//     "version": 2,
//     "kind": "workout" | "backup",
//     "exported": "<ISO time>",
//     "workouts": [{
//       "timestamp": "<ISO time with zone>",
//       "num_sets": 3, "exercise_duration": 40, "rest_duration": 20, "set_rest": 60,
//       "location": "home", "rpe": 5, "notes": "",
//       "exercises": [{ "id": 102, "name": "Squats", "muscle": "quads", "order_index": 0 }]
//     }]
//   }
// Older files are upgraded on import:
//   version 1 - backups from before this format: {"format": 1, "workouts": [...]},
//               or a bare list of workouts. May carry a "username" and
//               timestamps without a time zone (which were UTC).
// When the format changes, bump WORKOUT_FILE_VERSION and add a step to
// WORKOUT_FILE_UPGRADES that turns the previous version into the new one.
const WORKOUT_FILE_VERSION = 2;

const WORKOUT_FILE_UPGRADES = {
  // 1 -> 2
  1: (w) => {
    if (!w || typeof w !== "object") return w;
    const { username, id, ...rest } = w;
    return rest;
  },
};

function workoutFile(workouts, kind) {
  return {
    app: "workoutapp",
    version: WORKOUT_FILE_VERSION,
    kind,
    exported: new Date().toISOString(),
    workouts: workouts.map(({ id, username, ...w }) => w),
  };
}

// Checks one workout from a file and returns it in the stored shape,
// or null if it can't be recorded correctly.
function cleanImportedWorkout(w) {
  if (!w || typeof w !== "object") return null;
  if (typeof w.timestamp !== "string") return null;
  const when = window.DB.parseTimestamp(w.timestamp);
  if (isNaN(when)) return null;

  const numSets = Number(w.num_sets);
  const exDuration = Number(w.exercise_duration);
  const restDuration = Number(w.rest_duration ?? 0);
  const setRest = Number(w.set_rest ?? 0);
  if (!Number.isInteger(numSets) || numSets < 1) return null;
  if (!(exDuration > 0) || !(restDuration >= 0) || !(setRest >= 0)) return null;

  if (!Array.isArray(w.exercises) || w.exercises.length === 0) return null;
  const exercises = [];
  for (const [idx, ex] of w.exercises.entries()) {
    if (!ex || typeof ex.name !== "string" || !ex.name.trim()) return null;
    const id = Number(ex.id);
    if (!Number.isFinite(id)) return null;
    exercises.push({
      id,
      name: ex.name,
      muscle: typeof ex.muscle === "string" && ex.muscle ? ex.muscle : "Other",
      order_index: Number.isInteger(ex.order_index) ? ex.order_index : idx,
    });
  }
  exercises.sort((a, b) => a.order_index - b.order_index);

  return {
    timestamp: when.toISOString(),
    num_sets: numSets,
    exercise_duration: exDuration,
    rest_duration: restDuration,
    set_rest: setRest,
    location: typeof w.location === "string" ? w.location : "home",
    rpe: Number.isFinite(Number(w.rpe)) ? Number(w.rpe) : 5,
    notes: typeof w.notes === "string" ? w.notes : "",
    exercises,
  };
}

// Reads a parsed JSON file. Returns { workouts, invalid } or throws an Error
// with a message suitable for showing to the user.
function readWorkoutFile(data) {
  let version;
  let workouts;
  if (Array.isArray(data)) {
    version = 1;
    workouts = data;
  } else if (data && typeof data === "object" && Array.isArray(data.workouts)) {
    version = data.version ?? data.format ?? 1;
    workouts = data.workouts;
  } else {
    throw new Error("This isn't a workout file.");
  }

  if (!Number.isInteger(version) || version < 1) {
    throw new Error("This isn't a workout file.");
  }
  if (version > WORKOUT_FILE_VERSION) {
    throw new Error("This file is from a newer version of the app. Update the app and try again.");
  }

  for (let v = version; v < WORKOUT_FILE_VERSION; v++) {
    workouts = workouts.map(WORKOUT_FILE_UPGRADES[v]);
  }

  const cleaned = workouts.map(cleanImportedWorkout);
  return {
    workouts: cleaned.filter(Boolean),
    invalid: cleaned.filter((w) => !w).length,
  };
}

// Saves a JSON file: the share sheet where it can take files (iPhone/iPad,
// whose home-screen apps can't download), otherwise a download.
// Returns "shared", "downloaded" or "cancelled".
async function saveJsonFile(data, filename, title) {
  const file = new File([JSON.stringify(data, null, 2)], filename, { type: "application/json" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
      throw err;
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

// e.g. workout_2026-10-12_1830.json, in local time
function workoutFilename(workout) {
  const stamp = formatLocalDateTime(window.DB.parseTimestamp(workout.timestamp))
    .replace(" ", "_").replace(":", "");
  return `workout_${stamp}.json`;
}

async function exportWorkout(workout) {
  return saveJsonFile(workoutFile([workout], "workout"), workoutFilename(workout), "Workout");
}

const WORKOUT_START_DELAY = 7;

window.AppReady = (async () => {
    try {
        await DB.initDB();
    } catch (err) {
        console.error("Failed to initialize database:", err);
        throw err;
    }
})();

window.AppLogic = {
    Session,
    WORKOUT_START_DELAY,
    calculateTotalTime,
    formatTime,
    formatLocalDateTime,
    getAnalysisData,
    workoutFile,
    readWorkoutFile,
    saveJsonFile,
    exportWorkout
};