from flask import Flask, render_template, request, session, jsonify, redirect, url_for
import os, json, random, datetime
from collections import defaultdict

app = Flask(__name__)
app.secret_key = "supersecret"

EXERCISE_DIR = "exercises"
WORKOUT_LOG_DIR = "workout_log"

def get_workout_log_path():
    username = session.get("username", "Bruno")
    return os.path.join(WORKOUT_LOG_DIR, f"workout_log_{username}.json")

def get_existing_users():
    os.makedirs(WORKOUT_LOG_DIR, exist_ok=True)
    users = []
    for file in os.listdir(WORKOUT_LOG_DIR):
        if file.startswith("workout_log_") and file.endswith(".json"):
            username = file[len("workout_log_"):-len(".json")]
            users.append(username)
    return sorted(users)

def load_exercises():
    exercises = []
    for file in os.listdir(EXERCISE_DIR):
        if file.endswith(".json"):
            fpath = os.path.join(EXERCISE_DIR, file)
            with open(fpath, 'r') as f:
                exercise_active = True
                exercise_loaded = json.load(f)
                if "active" in exercise_loaded:
                    if exercise_loaded["active"] == False:
                        exercise_active = False
                new_field = "intensity"
                default_val = 5
                if new_field not in exercise_loaded:
                    exercise_loaded[new_field] = default_val
                if exercise_active:
                    exercises.append(exercise_loaded)
    return exercises

def load_workouts():
    try:
        return json.load(open(get_workout_log_path()))
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_workout(workout, num_sets, ex_duration, rest_duration, set_rest):
    os.makedirs(WORKOUT_LOG_DIR, exist_ok=True)
    slimmed = [{"id": ex["id"], "name": ex["name"]} for ex in workout]
    entry = {
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "exercises": slimmed,
        "num_sets": num_sets,
        "exercise_duration": ex_duration,
        "rest_duration": rest_duration,
        "location": "home",
        "RPE": 5,
        "set_rest": set_rest,
        "notes": ""
    }
    data = load_workouts()
    data.append(entry)
    with open(get_workout_log_path(), "w") as f:
        json.dump(data, f, indent=2)

def calculate_total_time(num_exercises, num_sets, ex_duration, rest_duration, set_rest):
    if num_exercises <= 0 or num_sets <= 0:
        return 0
    time_per_set = (num_exercises * ex_duration) + ((num_exercises - 1) * rest_duration)
    total = (num_sets * time_per_set) + ((num_sets - 1) * set_rest)
    return total

def format_time(seconds):
    mins, sec = divmod(seconds, 60)
    return f"{mins}m {sec}s"

@app.route("/timer")
def timer():
    workout = session.get("current_workout")
    if not workout:
        return redirect(url_for("index"))
    num_sets = session.get("num_sets", 1)
    ex_duration = session.get("ex_duration", 30)
    rest_duration = session.get("rest_duration", 15)
    set_rest = session.get("set_rest", 60)
    return render_template("timer.html",
                           workout=workout,
                           num_sets=num_sets,
                           ex_duration=ex_duration,
                           rest_duration=rest_duration,
                           set_rest=set_rest,
                           username=session.get("username", "Bruno"))

@app.route("/save_current_workout", methods=["POST"])
def save_current_workout():
    workout = session.get("current_workout")
    if not workout:
        return jsonify({"status": "no workout"})
    num_sets = session.get("num_sets", 1)
    ex_duration = session.get("ex_duration", 30)
    rest_duration = session.get("rest_duration", 15)
    set_rest = session.get("set_rest", 60)
    save_workout(workout, num_sets, ex_duration, rest_duration, set_rest)
    session.pop("current_workout", None)
    return jsonify({"status": "saved"})

@app.route('/exercises')
def exercises():
    import glob
    exercises = load_exercises()
    grouped = {}
    for ex in sorted(exercises, key=lambda e: e.get("muscle", "")):
        muscle = ex.get("muscle", "Other")
        grouped.setdefault(muscle, []).append(ex)
    return render_template('exercises.html', grouped_exercises=grouped)

@app.route("/", methods=["GET", "POST"])
def index():
    exercises = load_exercises()
    workout = session.get("current_workout", [])
    if "username" not in session:
        session["username"] = "Bruno"
    try:
        num_exercises = int(request.form.get("num_exercises", 5))
    except ValueError:
        num_exercises = 5
    try:
        num_sets = int(request.form.get("num_sets", session.get("num_sets", 1)))
    except ValueError:
        num_sets = session.get("num_sets", 1)
    try:
        ex_duration = int(request.form.get("ex_duration", session.get("ex_duration", 30)))
    except ValueError:
        ex_duration = session.get("ex_duration", 30)
    try:
        rest_duration = int(request.form.get("rest_duration", session.get("rest_duration", 15)))
    except ValueError:
        rest_duration = session.get("rest_duration", 15)
    try:
        set_rest_input = float(request.form.get("set_rest", session.get("set_rest", 60) / 60))
    except ValueError:
        set_rest_input = session.get("set_rest", 60) / 60.0
    set_rest = int(set_rest_input * 60)
    message = ""
    total_time = 0
    # Update username: prioritize new_username if provided, else use dropdown selection
    new_username = request.form.get("new_username", "").strip()
    if new_username:
        session["username"] = new_username or "Bruno"  # Fallback to Bruno if empty
    elif request.form.get("username"):
        session["username"] = request.form.get("username") or "Bruno"

    if request.method == "POST":
        if "generate" in request.form:
            workout = random.sample(exercises, min(num_exercises, len(exercises)))
            session["current_workout"] = workout
            session["num_sets"] = num_sets
            session["ex_duration"] = ex_duration
            session["rest_duration"] = rest_duration
            session["set_rest"] = set_rest
            message = ""
        elif "start" in request.form and workout:
            exercise_order = request.form.get("exercise_order")
            if exercise_order:
                order_indices = [int(i) for i in exercise_order.split(",") if i.strip().isdigit()]
                if len(order_indices) == len(workout) and all(0 <= i < len(workout) for i in order_indices):
                    workout = [workout[i] for i in order_indices]
            session["current_workout"] = workout
            session["num_sets"] = num_sets
            session["ex_duration"] = ex_duration
            session["rest_duration"] = rest_duration
            session["set_rest"] = set_rest
            return redirect(url_for("timer"))
        elif "save" in request.form and workout:
            exercise_order = request.form.get("exercise_order")
            if exercise_order:
                order_indices = [int(i) for i in exercise_order.split(",") if i.strip().isdigit()]
                if len(order_indices) == len(workout) and all(0 <= i < len(workout) for i in order_indices):
                    workout = [workout[i] for i in order_indices]
                    session["current_workout"] = workout
            save_workout(workout, num_sets, ex_duration, rest_duration, set_rest)
            session.pop("current_workout", None)
            workout = []
            message = "Workout Saved!"
    if workout:
        total_time_sec = calculate_total_time(len(workout), num_sets, ex_duration, rest_duration, set_rest)
        total_time = format_time(total_time_sec)
        session["num_sets"] = num_sets
        session["ex_duration"] = ex_duration
        session["rest_duration"] = rest_duration
        session["set_rest"] = set_rest
    return render_template("index.html", workout=workout,
                           num_exercises=num_exercises,
                           num_sets=num_sets,
                           ex_duration=ex_duration,
                           rest_duration=rest_duration,
                           set_rest=set_rest,
                           message=message,
                           total_time=total_time,
                           username=session["username"],
                           existing_users=get_existing_users())

@app.route("/history")
def history():
    workouts = load_workouts()
    workouts = sorted(workouts, key=lambda w: w["timestamp"], reverse=True)
    for w in workouts:
        total_sec = calculate_total_time(len(w["exercises"]), w.get("num_sets",1),
                                         w.get("exercise_duration",30),
                                         w.get("rest_duration",15),
                                         w.get("set_rest",60))
        w["total_time"] = format_time(total_sec)
    return render_template("history.html", workouts=workouts, username=session.get("username", "Bruno"))

@app.route("/warm_up")
def warm_up():
    return render_template("warm_up.html")

@app.route('/analysis')
def analysis():
    import glob
    from datetime import datetime
    if not os.path.exists(get_workout_log_path()):
        workouts = []
    else:
        with open(get_workout_log_path(), "r") as f:
            workouts = json.load(f)
    def parse_dt(s):
        return datetime.fromisoformat(s)
    workouts_sorted = sorted([w for w in workouts if w.get("timestamp")], key=lambda w: w["timestamp"])
    trend_labels = []
    trend_exercise = []
    trend_rest = []
    for w in workouts_sorted:
        ts = w.get("timestamp")
        dt = parse_dt(ts)
        trend_labels.append(dt.strftime("%Y-%m-%d %H:%M"))
        num_ex = len(w.get("exercises", []))
        num_sets = int(w.get("num_sets", 1))
        ex_dur = int(w.get("exercise_duration", 0))
        rest_dur = int(w.get("rest_duration", 0))
        set_rest = int(w.get("set_rest", 0))
        exercise_time = num_sets * num_ex * ex_dur
        rest_time = num_sets * max(0, num_ex - 1) * rest_dur + max(0, num_sets - 1) * set_rest
        trend_exercise.append(exercise_time)
        trend_rest.append(rest_time)
    def bucket_key(dt, by="week"):
        if by == "week":
            y, wn, _ = dt.isocalendar()
            return f"{y}-W{wn:02d}"
        else:
            return dt.strftime("%Y-%m")
    def aggregate(by="week"):
        totals = {}
        for w in workouts:
            ts = w.get("timestamp")
            if not ts:
                continue
            dt = parse_dt(ts)
            key = bucket_key(dt, by)
            if key not in totals:
                totals[key] = {"exercise": 0, "rest": 0, "muscles": {}}
            num_ex = len(w.get("exercises", []))
            num_sets = int(w.get("num_sets", 1))
            ex_dur = int(w.get("exercise_duration", 0))
            rest_dur = int(w.get("rest_duration", 0))
            set_rest = int(w.get("set_rest", 0))
            exercise_time = num_sets * num_ex * ex_dur
            rest_time = num_sets * max(0, num_ex - 1) * rest_dur + max(0, num_sets - 1) * set_rest
            totals[key]["exercise"] += exercise_time
            totals[key]["rest"] += rest_time
            for ex in w.get("exercises", []):
                ex_id = ex.get("id")
                muscle = "Other"
                matches = glob.glob(f"exercises/{ex_id}_*.json")
                if matches:
                    try:
                        with open(matches[0], "r") as ef:
                            ed = json.load(ef)
                            muscle = ed.get("muscle", "Other")
                    except Exception:
                        muscle = "Other"
                t = num_sets * ex_dur
                totals[key]["muscles"][muscle] = totals[key]["muscles"].get(muscle, 0) + t
        ordered = dict(sorted(totals.items()))
        return ordered
    weekly_totals = aggregate("week")
    monthly_totals = aggregate("month")
    return render_template(
        "analysis.html",
        trend_labels=trend_labels,
        trend_exercise=trend_exercise,
        trend_rest=trend_rest,
        weekly=weekly_totals,
        monthly=monthly_totals,
        username=session.get("username", "Bruno")
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)