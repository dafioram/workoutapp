// app.js

if ("serviceWorker" in navigator) {
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
    getAnalysisData
};