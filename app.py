from flask import Flask, render_template, request, session, jsonify, redirect, url_for
import os, json, random, datetime
from collections import defaultdict
import database  # Import the new database module

app = Flask(__name__)
app.secret_key = "supersecret"

EXERCISE_DIR = "exercises"

def get_existing_users():
    return database.get_all_users()

def load_exercises(workout_type="any"):
    exercises = []
    if not os.path.exists(EXERCISE_DIR):
        return []
        
    for file in os.listdir(EXERCISE_DIR):
        if file.endswith(".json"):
            fpath = os.path.join(EXERCISE_DIR, file)
            with open(fpath, 'r') as f:
                exercise_active = True
                exercise_loaded = json.load(f)
                if "active" in exercise_loaded and not exercise_loaded["active"]:
                    exercise_active = False
                new_field = "intensity"
                default_val = 5
                if new_field not in exercise_loaded:
                    exercise_loaded[new_field] = default_val

                # Filter based on workout type
                if workout_type == "core":
                    if not exercise_loaded.get("ab_workout", False):
                        continue
                elif workout_type == "cardio":
                    if exercise_loaded.get("type", "").lower() != "cardio":
                        continue

                if exercise_active:
                    exercises.append(exercise_loaded)
    return exercises

def save_workout(workout, num_sets, ex_duration, rest_duration, set_rest):
    username = session.get("username", "Bruno")
    # Simplify workout list to just ID and Name for storage
    slimmed = [{"id": ex["id"], "name": ex["name"]} for ex in workout]
    
    # Save to SQLite
    database.insert_workout(
        username=username,
        exercises=slimmed,
        num_sets=num_sets,
        ex_duration=ex_duration,
        rest_duration=rest_duration,
        set_rest=set_rest,
        location="home",
        rpe=5,
        notes=""
    )

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
    workout_type = request.form.get("workout_type", session.get("workout_type", "any"))
    session["workout_type"] = workout_type
    exercises = load_exercises(workout_type=workout_type)
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

    new_username = request.form.get("new_username", "").strip()
    if new_username:
        session["username"] = new_username or "Bruno"
    elif request.form.get("username"):
        session["username"] = request.form.get("username") or "Bruno"

    # normalize and ensure locked_ids in session
    if "locked_ids" not in session:
        session["locked_ids"] = []
    else:
        session["locked_ids"] = [str(x) for x in session.get("locked_ids", [])]

    if request.method == "POST":
        # ---------- GENERATE / REDRAW ----------
        if "generate" in request.form:
            exercise_order_raw = request.form.get("exercise_order", "")
            order_ids = [s for s in exercise_order_raw.split(",") if s.strip() != ""]
            order_ids = [str(s) for s in order_ids]

            old_workout = session.get("current_workout", []) or []
            old_by_id = {str(ex.get("id")): ex for ex in old_workout}

            if order_ids:
                old_in_order = []
                for oid in order_ids:
                    if oid in old_by_id:
                        old_in_order.append(old_by_id[oid])
                for ex in old_workout:
                    sid = str(ex.get("id"))
                    if sid not in order_ids:
                        old_in_order.append(ex)
            else:
                old_in_order = old_workout[:]

            if 'locked_ids' in request.form:
                locked_ids_raw = request.form.get("locked_ids", "")
                if locked_ids_raw and locked_ids_raw.strip() != "":
                    locked_ids = [s for s in locked_ids_raw.split(",") if s.strip() != ""]
                else:
                    locked_ids = []
            else:
                locked_ids = session.get("locked_ids", [])
            locked_ids = [str(x) for x in locked_ids]
            session["locked_ids"] = locked_ids

            new_workout = [None] * max(0, num_exercises)
            combined_map = {str(e.get("id")): e for e in exercises}
            combined_map.update(old_by_id)

            for idx, ex in enumerate(old_in_order):
                exid = str(ex.get("id"))
                if exid in locked_ids:
                    if idx < len(new_workout):
                        candidate = combined_map.get(exid, ex)
                        new_workout[idx] = candidate

            for lid in locked_ids:
                if any((item and str(item.get("id")) == lid) for item in new_workout):
                    continue
                candidate = combined_map.get(lid)
                if candidate:
                    try:
                        first_none = new_workout.index(None)
                        new_workout[first_none] = candidate
                    except ValueError:
                        new_workout.append(candidate)

            used_ids = set(str(e.get("id")) for e in new_workout if e)
            pool = [e for e in exercises if str(e.get("id")) not in used_ids and str(e.get("id")) not in locked_ids]

            slots_to_fill = [i for i, v in enumerate(new_workout) if v is None]
            chosen = []
            if pool:
                take = min(len(pool), len(slots_to_fill))
                chosen = random.sample(pool, take)
            if len(chosen) < len(slots_to_fill):
                non_locked_pool = [e for e in exercises if str(e.get("id")) not in locked_ids]
                while len(chosen) < len(slots_to_fill) and non_locked_pool:
                    chosen.append(random.choice(non_locked_pool))

            for pos_idx, slot in enumerate(slots_to_fill):
                if pos_idx < len(chosen):
                    new_workout[slot] = chosen[pos_idx]
                else:
                    new_workout[slot] = None

            final_workout = [e for e in new_workout if e is not None]
            if len(final_workout) < num_exercises:
                non_locked_pool = [e for e in exercises if str(e.get("id")) not in locked_ids]
                while len(final_workout) < num_exercises and non_locked_pool:
                    final_workout.append(random.choice(non_locked_pool))

            if len(final_workout) > num_exercises:
                final_workout = final_workout[:num_exercises]

            session["current_workout"] = final_workout
            session["num_sets"] = num_sets
            session["ex_duration"] = ex_duration
            session["rest_duration"] = rest_duration
            session["set_rest"] = set_rest
            message = ""
            workout = final_workout

        # ---------- START ----------
        elif "start" in request.form and workout:
            exercise_order = request.form.get("exercise_order", "")
            if exercise_order:
                order_ids = [s for s in exercise_order.split(",") if s.strip() != ""]
                order_ids = [str(s) for s in order_ids]
                current = session.get("current_workout", [])
                by_id = {str(ex.get("id")): ex for ex in current}
                new_list = []
                for oid in order_ids:
                    if oid in by_id:
                        new_list.append(by_id[oid])
                for ex in current:
                    if str(ex.get("id")) not in order_ids:
                        new_list.append(ex)
                workout = new_list
            session["current_workout"] = workout
            session["num_sets"] = num_sets
            session["ex_duration"] = ex_duration
            session["rest_duration"] = rest_duration
            session["set_rest"] = set_rest
            return redirect(url_for("timer"))

        # ---------- SAVE ----------
        elif "save" in request.form and workout:
            exercise_order = request.form.get("exercise_order", "")
            if exercise_order:
                order_ids = [s for s in exercise_order.split(",") if s.strip() != ""]
                order_ids = [str(s) for s in order_ids]
                current = session.get("current_workout", [])
                by_id = {str(ex.get("id")): ex for ex in current}
                new_list = []
                for oid in order_ids:
                    if oid in by_id:
                        new_list.append(by_id[oid])
                for ex in current:
                    if str(ex.get("id")) not in order_ids:
                        new_list.append(ex)
                workout = new_list
                session["current_workout"] = workout
            save_workout(workout, num_sets, ex_duration, rest_duration, set_rest)
            session.pop("current_workout", None)
            message = "Workout Saved!"

    # Update total_time if we have a workout
    if workout:
        total_time_sec = calculate_total_time(len(workout), num_sets, ex_duration, rest_duration, set_rest)
        total_time = format_time(total_time_sec)
        session["num_sets"] = num_sets
        session["ex_duration"] = ex_duration
        session["rest_duration"] = rest_duration
        session["set_rest"] = set_rest

    return render_template(
        "index.html",
        workout=session.get("current_workout", []),
        num_exercises=num_exercises,
        num_sets=num_sets,
        ex_duration=ex_duration,
        rest_duration=rest_duration,
        set_rest=set_rest,
        message=message,
        total_time=total_time,
        username=session["username"],
        existing_users=get_existing_users(),
        workout_type=session.get("workout_type", "any")
    )

@app.route("/history")
def history():
    username = session.get("username", "Bruno")
    # Fetch from DB (Static History)
    workouts = database.get_workouts_for_user(username)
    
    for w in workouts:
        total_sec = calculate_total_time(len(w.get("exercises", [])), 
                                         w.get("num_sets", 1),
                                         w.get("exercise_duration", 30),
                                         w.get("rest_duration", 15),
                                         w.get("set_rest", 60))
        w["total_time"] = format_time(total_sec)
    
    return render_template("history.html", workouts=workouts, username=username)

@app.route("/warm_up")
def warm_up():
    return render_template("warm_up.html")

@app.route('/analysis')
def analysis():
    import glob
    from datetime import datetime
    
    username = session.get("username", "Bruno")
    # Fetch from DB (Dynamic Analytics)
    workouts = database.get_workouts_for_user(username)

    def parse_dt(s):
        return datetime.fromisoformat(s)

    # Sort ASC for trend lines
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
                totals[key] = {"exercise": 0, "rest": 0, "muscles": {}, "workout_count": 0}
            
            num_ex = len(w.get("exercises", []))
            num_sets = int(w.get("num_sets", 1))
            ex_dur = int(w.get("exercise_duration", 0))
            rest_dur = int(w.get("rest_duration", 0))
            set_rest = int(w.get("set_rest", 0))
            
            exercise_time = num_sets * num_ex * ex_dur
            rest_time = num_sets * max(0, num_ex - 1) * rest_dur + max(0, num_sets - 1) * set_rest
            
            totals[key]["exercise"] += exercise_time
            totals[key]["rest"] += rest_time
            totals[key]["workout_count"] += 1
            
            # Use 'glob' to find the current live JSON definition for analysis
            for ex in w.get("exercises", []):
                ex_id = ex.get("id")
                muscle = "Other"
                # This works because your files are named "101_pushups.json" and your ID is 101.
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
    weekly_workout_counts = {k: v["workout_count"] for k, v in weekly_totals.items()}
    monthly_workout_counts = {k: v["workout_count"] for k, v in monthly_totals.items()}
    
    return render_template(
        "analysis.html",
        trend_labels=trend_labels,
        trend_exercise=trend_exercise,
        trend_rest=trend_rest,
        weekly=weekly_totals,
        monthly=monthly_totals,
        weekly_workout_counts=weekly_workout_counts,
        monthly_workout_counts=monthly_workout_counts,
        username=username
    )

if __name__ == "__main__":
    import os
    
    # Initialize DB tables in 'data/' folder on startup
    database.init_db()
    
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)