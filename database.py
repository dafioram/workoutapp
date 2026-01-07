import sqlite3
import datetime
import os

# Configuration: Save DB in a 'data' folder
DB_FOLDER = "data"
DB_NAME = "workout_app.db"
DB_PATH = os.path.join(DB_FOLDER, DB_NAME)

def get_db():
    # Ensure the folder exists before connecting
    os.makedirs(DB_FOLDER, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes the database with workouts and workout_exercises tables."""
    conn = get_db()
    c = conn.cursor()
    
    # Table for the overall workout session (The "Header")
    c.execute('''
        CREATE TABLE IF NOT EXISTS workouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            num_sets INTEGER,
            exercise_duration INTEGER,
            rest_duration INTEGER,
            set_rest INTEGER,
            location TEXT,
            rpe INTEGER,
            notes TEXT
        )
    ''')

    # Table for individual exercises within a workout (The "Line Items")
    # 'order_index' ensures we remember the sequence (e.g., Pushups 1st, Squats 2nd)
    c.execute('''
        CREATE TABLE IF NOT EXISTS workout_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id INTEGER,
            exercise_id TEXT,
            exercise_name TEXT,
            order_index INTEGER,
            FOREIGN KEY(workout_id) REFERENCES workouts(id)
        )
    ''')
    
    conn.commit()
    conn.close()

def insert_workout(username, exercises, num_sets, ex_duration, rest_duration, set_rest, location="home", rpe=5, notes=""):
    """
    Saves a workout.
    exercises: list of dicts (must contain 'id' and 'name')
    """
    conn = get_db()
    c = conn.cursor()
    
    timestamp = datetime.datetime.now().isoformat(timespec="seconds")
    
    # 1. Insert the workout header
    c.execute('''
        INSERT INTO workouts 
        (username, timestamp, num_sets, exercise_duration, rest_duration, set_rest, location, rpe, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (username, timestamp, num_sets, ex_duration, rest_duration, set_rest, location, rpe, notes))
    
    workout_id = c.lastrowid
    
    # 2. Insert each exercise with its order index
    for idx, ex in enumerate(exercises):
        c.execute('''
            INSERT INTO workout_exercises (workout_id, exercise_id, exercise_name, order_index)
            VALUES (?, ?, ?, ?)
        ''', (workout_id, ex.get("id"), ex.get("name"), idx))
        
    conn.commit()
    conn.close()

def get_workouts_for_user(username):
    """
    Returns a list of workout dictionaries formatted exactly like your old JSON structure
    so that History and Analysis pages work without HTML changes.
    """
    conn = get_db()
    c = conn.cursor()
    
    # Get all workouts for user, sorted by newest first
    c.execute('SELECT * FROM workouts WHERE username = ? ORDER BY timestamp DESC', (username,))
    workout_rows = c.fetchall()
    
    results = []
    
    for w_row in workout_rows:
        w_dict = dict(w_row)
        
        # Get exercises for this specific workout, ordered correctly
        c.execute('''
            SELECT exercise_id, exercise_name 
            FROM workout_exercises 
            WHERE workout_id = ? 
            ORDER BY order_index ASC
        ''', (w_dict['id'],))
        
        ex_rows = c.fetchall()
        
        # Reconstruct exercise list
        exercises = [{"id": r['exercise_id'], "name": r['exercise_name']} for r in ex_rows]
        
        w_dict['exercises'] = exercises
        results.append(w_dict)
        
    conn.close()
    return results

def get_all_users():
    """Returns a sorted list of distinct usernames found in the database."""
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT DISTINCT username FROM workouts")
    rows = c.fetchall()
    conn.close()
    
    users = [row['username'] for row in rows]
    return sorted(users)