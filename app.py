from flask import Flask, render_template, request, session, jsonify, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
import random
import database  # Uses the new DB logic

app = Flask(__name__)

app.wsgi_app = ProxyFix(
    app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1
)

app.secret_key = "supersecret"

# --- HELPER FUNCTIONS ---

def calculate_total_time(num_exercises, num_sets, ex_duration, rest_duration, set_rest):
    if num_exercises <= 0 or num_sets <= 0:
        return 0
    time_per_set = (num_exercises * ex_duration) + ((num_exercises - 1) * rest_duration)
    total = (num_sets * time_per_set) + ((num_sets - 1) * set_rest)
    return total

def save_workout(workout, num_sets, ex_duration, rest_duration, set_rest):
    """Helper to save the workout to the database."""
    database.insert_workout(
        username=session.get("username", "Bruno"),
        exercises=workout,
        num_sets=num_sets,
        ex_duration=ex_duration,
        rest_duration=rest_duration,
        set_rest=set_rest
    )

def format_time(seconds):
    mins, sec = divmod(seconds, 60)
    return f"{mins}m {sec}s"

# --- ROUTES ---

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
    
    # Save to DB
    database.insert_workout(
        username=session.get("username", "Bruno"),
        exercises=workout, 
        num_sets=num_sets,
        ex_duration=ex_duration,
        rest_duration=rest_duration,
        set_rest=set_rest
    )
    
    session.pop("current_workout", None)
    return jsonify({"status": "saved"})

@app.route('/exercises')
def exercises():
    # Load from DB instead of JSON
    all_ex = database.get_all_exercises()
    
    grouped = {}
    for ex in sorted(all_ex, key=lambda e: e.get("muscle", "")):
        muscle = ex.get("muscle", "Other")
        grouped.setdefault(muscle, []).append(ex)
        
    return render_template('exercises.html', grouped_exercises=grouped)

@app.route("/", methods=["GET", "POST"])
def index():
    if "username" not in session:
        session["username"] = "Bruno"

    workout_type = request.form.get("workout_type", session.get("workout_type", "any"))
    session["workout_type"] = workout_type
    
    # LOAD EXERCISES FROM DB
    available_exercises = database.get_all_exercises(workout_type=workout_type)

    # Inputs / Session Management
    try:
        num_exercises = int(request.form.get("num_exercises", 5))
        num_sets = int(request.form.get("num_sets", session.get("num_sets", 1)))
        ex_duration = int(request.form.get("ex_duration", session.get("ex_duration", 30)))
        rest_duration = int(request.form.get("rest_duration", session.get("rest_duration", 15)))
        set_rest_input = float(request.form.get("set_rest", session.get("set_rest", 60) / 60))
        set_rest = int(set_rest_input * 60)
    except ValueError:
        num_exercises = 5
        num_sets = 1
        ex_duration = 30
        rest_duration = 15
        set_rest = 60

    new_username = request.form.get("new_username", "").strip()
    if new_username:
        session["username"] = new_username
    elif request.form.get("username"):
        session["username"] = request.form.get("username")

    if "locked_ids" not in session:
        session["locked_ids"] = []
    session["locked_ids"] = [int(x) for x in session.get("locked_ids", [])]

    workout = session.get("current_workout", [])
    message = ""

    if request.method == "POST":
        if "generate" in request.form:
            locked_ids_raw = request.form.get("locked_ids", "")
            if locked_ids_raw.strip():
                locked_ids = [int(s) for s in locked_ids_raw.split(",") if s.strip()]
            else:
                locked_ids = []
            session["locked_ids"] = locked_ids

            old_workout = session.get("current_workout", [])
            
            # --- FIX: READ ORDER FROM FORM BEFORE LOCKING ---
            # This ensures that if you dragged an item to slot 2, it stays in slot 2.
            exercise_order = request.form.get("exercise_order", "")
            if exercise_order:
                order_ids = [int(s) for s in exercise_order.split(",") if s.strip()]
                current_map = {int(ex["id"]): ex for ex in old_workout}
                reordered = []
                # 1. Add exercises in the order the user sees on screen
                for oid in order_ids:
                    if oid in current_map:
                        reordered.append(current_map[oid])
                # 2. Add any that might be missing (just in case)
                for ex in old_workout:
                    if int(ex["id"]) not in order_ids:
                        reordered.append(ex)
                old_workout = reordered
            # ------------------------------------------------

            old_by_id = {int(ex["id"]): ex for ex in old_workout}

            combined_map = {int(e["id"]): e for e in available_exercises}
            combined_map.update(old_by_id)

            new_workout = [None] * num_exercises
            
            # 1. Place Locked exercises using the UPDATED order
            for i, ex in enumerate(old_workout):
                if i < num_exercises and int(ex["id"]) in locked_ids:
                    new_workout[i] = combined_map.get(int(ex["id"]))

            # 2. Fill specific locked IDs that might have been lost in resizing
            for lid in locked_ids:
                if not any(item and int(item["id"]) == lid for item in new_workout):
                     cand = combined_map.get(lid)
                     if cand:
                         try:
                             idx = new_workout.index(None)
                             new_workout[idx] = cand
                         except ValueError:
                             new_workout.append(cand)

            # 3. Fill remaining slots
            used_ids = set(int(ex["id"]) for ex in new_workout if ex)
            pool = [e for e in available_exercises if int(e["id"]) not in used_ids and int(e["id"]) not in locked_ids]
            
            slots_needed = new_workout.count(None)
            if pool:
                chosen = random.sample(pool, min(len(pool), slots_needed))
                for c in chosen:
                    idx = new_workout.index(None)
                    new_workout[idx] = c
            
            non_locked_pool = [e for e in available_exercises if int(e["id"]) not in locked_ids]
            while None in new_workout and non_locked_pool:
                idx = new_workout.index(None)
                new_workout[idx] = random.choice(non_locked_pool)

            final_workout = [x for x in new_workout if x is not None]
            final_workout = final_workout[:num_exercises]

            session["current_workout"] = final_workout
            session["num_sets"] = num_sets
            session["ex_duration"] = ex_duration
            session["rest_duration"] = rest_duration
            session["set_rest"] = set_rest
            workout = final_workout

        elif ("start" in request.form or "save" in request.form) and workout:
            exercise_order = request.form.get("exercise_order", "")
            if exercise_order:
                order_ids = [int(s) for s in exercise_order.split(",") if s.strip()]
                current_map = {int(ex["id"]): ex for ex in workout}
                reordered = []
                for oid in order_ids:
                    if oid in current_map:
                        reordered.append(current_map[oid])
                for ex in workout:
                    if int(ex["id"]) not in order_ids:
                        reordered.append(ex)
                workout = reordered
                session["current_workout"] = workout

            if "start" in request.form:
                return redirect(url_for("timer"))
            elif "save" in request.form:
                save_workout(workout, num_sets, ex_duration, rest_duration, set_rest)
                session.pop("current_workout", None)
                message = "Workout Saved!"
                workout = []

    total_time = "0m 0s"
    if workout:
        total_sec = calculate_total_time(len(workout), num_sets, ex_duration, rest_duration, set_rest)
        total_time = format_time(total_sec)

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
        existing_users=database.get_all_users(),
        workout_type=session.get("workout_type", "any"),
        locked_ids=session.get("locked_ids", [])
    )

@app.route("/history")
def history():
    username = session.get("username", "Bruno")
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
    from datetime import datetime
    
    username = session.get("username", "Bruno")
    workouts = database.get_workouts_for_user(username)
    exercise_map = database.get_exercise_map()

    def parse_dt(s):
        return datetime.fromisoformat(s)

    workouts_sorted = sorted([w for w in workouts if w.get("timestamp")], key=lambda w: w["timestamp"])
    
    trend_labels = []
    trend_exercise = []
    trend_rest = []
    
    for w in workouts_sorted:
        dt = parse_dt(w["timestamp"])
        trend_labels.append(dt.strftime("%Y-%m-%d %H:%M"))
        
        num_ex = len(w.get("exercises", []))
        num_sets = int(w.get("num_sets", 1))
        ex_dur = int(w.get("exercise_duration", 0))
        rest_dur = int(w.get("rest_duration", 0))
        set_rest = int(w.get("set_rest", 0))
        
        ex_time = num_sets * num_ex * ex_dur
        r_time = num_sets * max(0, num_ex - 1) * rest_dur + max(0, num_sets - 1) * set_rest
        
        trend_exercise.append(ex_time)
        trend_rest.append(r_time)

    def bucket_key(dt, by="week"):
        if by == "week":
            y, wn, _ = dt.isocalendar()
            return f"{y}-W{wn:02d}"
        return dt.strftime("%Y-%m")

    def aggregate(by="week"):
        totals = {}
        for w in workouts:
            if not w.get("timestamp"): continue
            dt = parse_dt(w["timestamp"])
            key = bucket_key(dt, by)
            
            if key not in totals:
                totals[key] = {"exercise": 0, "rest": 0, "muscles": {}, "workout_count": 0}
            
            num_sets = int(w.get("num_sets", 1))
            ex_dur = int(w.get("exercise_duration", 0))
            rest_dur = int(w.get("rest_duration", 0))
            set_rest = int(w.get("set_rest", 0))
            num_ex = len(w.get("exercises", []))

            ex_time = num_sets * num_ex * ex_dur
            r_time = num_sets * max(0, num_ex - 1) * rest_dur + max(0, num_sets - 1) * set_rest
            
            totals[key]["exercise"] += ex_time
            totals[key]["rest"] += r_time
            totals[key]["workout_count"] += 1
            
            for ex in w.get("exercises", []):
                muscle = ex.get("muscle", "Other")
                if muscle == "Other" or not muscle:
                    db_ex = exercise_map.get(ex["id"])
                    if db_ex:
                        muscle = db_ex.get("muscle", "Other")
                
                t = num_sets * ex_dur
                totals[key]["muscles"][muscle] = totals[key]["muscles"].get(muscle, 0) + t
        
        return dict(sorted(totals.items()))

    weekly = aggregate("week")
    monthly = aggregate("month")
    
    return render_template(
        "analysis.html",
        trend_labels=trend_labels,
        trend_exercise=trend_exercise,
        trend_rest=trend_rest,
        weekly=weekly,
        monthly=monthly,
        weekly_workout_counts={k: v["workout_count"] for k,v in weekly.items()},
        monthly_workout_counts={k: v["workout_count"] for k,v in monthly.items()},
        username=username
    )

if __name__ == "__main__":
    import os
    database.init_db()
    database.backup_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)