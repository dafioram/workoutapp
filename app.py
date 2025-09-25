from flask import Flask, render_template, request, session
import os, json, random, datetime

app = Flask(__name__)
app.secret_key = "supersecret"

EXERCISE_DIR = "exercises"
WORKOUT_LOG = "workout_log.json"

def load_exercises():
    exercises = []
    for file in os.listdir(EXERCISE_DIR):
        if file.endswith(".json"):
            with open(os.path.join(EXERCISE_DIR, file)) as f:
                exercises.append(json.load(f))
    return exercises

def load_workouts():
    try:
        return json.load(open(WORKOUT_LOG))
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_workout(workout, num_sets, ex_duration, rest_duration, set_rest):
    slimmed = [{"id": ex["id"], "name": ex["name"]} for ex in workout]
    entry = {
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "exercises": slimmed,
        "num_sets": num_sets,
        "exercise_duration": ex_duration,
        "rest_duration": rest_duration,
        "set_rest": set_rest
    }
    data = load_workouts()
    data.append(entry)
    with open(WORKOUT_LOG, "w") as f:
        json.dump(data, f, indent=2)

def calculate_total_time(num_exercises, num_sets, ex_duration, rest_duration, set_rest):
    if num_exercises <= 0 or num_sets <= 0:
        return 0
    # Total time per set: exercises + rest between exercises
    time_per_set = (num_exercises * ex_duration) + ((num_exercises - 1) * rest_duration)
    # Total workout: num_sets * time_per_set + rest between sets (after each set except last)
    total = (num_sets * time_per_set) + ((num_sets - 1) * set_rest)
    return total

def format_time(seconds):
    mins, sec = divmod(seconds, 60)
    return f"{mins}m {sec}s"

@app.route('/exercises')
def exercises():
    import glob

    exercise_files = glob.glob("exercises/*.json")
    exercises = []
    for fpath in exercise_files:
        with open(fpath, 'r') as f:
            exercises.append(json.load(f))

    # sort by muscle
    grouped = {}
    for ex in sorted(exercises, key=lambda e: e.get("muscle", "")):
        muscle = ex.get("muscle", "Other")
        grouped.setdefault(muscle, []).append(ex)

    return render_template('exercises.html', grouped_exercises=grouped) 

@app.route("/", methods=["GET", "POST"])
def index():
    exercises = load_exercises()
    workout = session.get("current_workout", [])
    num_exercises = int(request.form.get("num_exercises", 5))
    num_sets = int(request.form.get("num_sets", 1))
    ex_duration = int(request.form.get("ex_duration", 30))
    rest_duration = int(request.form.get("rest_duration", 15))
    set_rest_input = float(request.form.get("set_rest", 1))
    set_rest = int(set_rest_input * 60)
    message = ""
    total_time = 0

    if request.method == "POST":
        if "generate" in request.form:
            workout = random.sample(exercises, min(num_exercises, len(exercises)))
            session["current_workout"] = workout
            message = ""
        elif "save" in request.form and workout:
            save_workout(workout, num_sets, ex_duration, rest_duration, set_rest)
            session.pop("current_workout", None)
            workout = []
            message = "Workout Saved!"

    if workout:
        total_time_sec = calculate_total_time(num_exercises, num_sets, ex_duration, rest_duration, set_rest)
        total_time = format_time(total_time_sec)

    return render_template("index.html", workout=workout,
                           num_exercises=num_exercises,
                           num_sets=num_sets,
                           ex_duration=ex_duration,
                           rest_duration=rest_duration,
                           set_rest=set_rest,
                           message=message,
                           total_time=total_time)

@app.route("/history")
def history():
    workouts = load_workouts()
    workouts = sorted(workouts, key=lambda w: w["timestamp"], reverse=True)
    # add total_time formatted for each saved workout
    for w in workouts:
        total_sec = calculate_total_time(len(w["exercises"]), w.get("num_sets",1),
                                         w.get("exercise_duration",30),
                                         w.get("rest_duration",15),
                                         w.get("set_rest",60))
        w["total_time"] = format_time(total_sec)
    return render_template("history.html", workouts=workouts)

if __name__ == "__main__":
    app.run(debug=True) 