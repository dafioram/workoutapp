from flask import Flask, render_template, request, session
import os, json, random, datetime

app = Flask(__name__)
app.secret_key = "supersecret"  # needed for session storage

EXERCISE_DIR = "exercises"
WORKOUT_LOG = "workouts.json"

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

def save_workout(workout):
    slimmed = [{"id": ex["id"], "name": ex["name"]} for ex in workout]
    entry = {
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "exercises": slimmed
    }
    data = load_workouts()
    data.append(entry)
    with open(WORKOUT_LOG, "w") as f:
        json.dump(data, f, indent=2)

@app.route("/", methods=["GET", "POST"])
def index():
    exercises = load_exercises()
    workout = session.get("current_workout", [])
    num = int(request.form.get("num", 5))
    message = ""

    if request.method == "POST":
        if "generate" in request.form:
            # redraw workout
            workout = random.sample(exercises, min(num, len(exercises)))
            session["current_workout"] = workout
            message = ""
        elif "save" in request.form and workout:
            save_workout(workout)
            session.pop("current_workout", None)
            workout = []
            message = "Workout Saved!"

    return render_template("index.html", workout=workout, num=num, message=message)

@app.route("/history")
def history():
    workouts = load_workouts()
    workouts = sorted(workouts, key=lambda w: w["timestamp"], reverse=True)
    return render_template("history.html", workouts=workouts)

if __name__ == "__main__":
    app.run(debug=True)