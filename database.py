import sqlite3
import datetime
import os
import json
import glob

# Configuration
DB_FOLDER = "data"
DB_NAME = "workout_app.db"
DB_PATH = os.path.join(DB_FOLDER, DB_NAME)
EXERCISE_DIR = "exercises"

def get_db():
    os.makedirs(DB_FOLDER, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """
    Initializes the database.
    If the 'exercises' table is empty, it loads data from JSON files (One-time seed).
    """
    conn = get_db()
    c = conn.cursor()
    
    # 1. Table: The Master Exercise List
    c.execute('''
        CREATE TABLE IF NOT EXISTS exercises (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            muscle TEXT,
            body_part TEXT,
            body_weight BOOLEAN DEFAULT 1,
            variants TEXT,
            type TEXT,
            equipment TEXT,
            link TEXT,
            active BOOLEAN DEFAULT 1,
            alternate_name TEXT,
            intensity INTEGER DEFAULT 5,
            ab_workout BOOLEAN DEFAULT 0,
            image TEXT,
            description TEXT
        )
    ''')

    # 2. Table: Workout Headers
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

    # 3. Table: Workout Log (Junction Table)
    c.execute('''
        CREATE TABLE IF NOT EXISTS workout_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id INTEGER,
            exercise_id INTEGER,
            order_index INTEGER,
            FOREIGN KEY(workout_id) REFERENCES workouts(id),
            FOREIGN KEY(exercise_id) REFERENCES exercises(id)
        )
    ''')
    
    conn.commit()
    
    # --- SEEDING LOGIC ---
    c.execute("SELECT count(*) FROM exercises")
    if c.fetchone()[0] == 0:
        print("--- Database empty. Seeding exercises from JSON files... ---")
        seed_exercises_from_json(c)
        conn.commit()
        print("--- Seeding complete. ---")
    
    conn.close()

def seed_exercises_from_json(cursor):
    """Reads JSON files and inserts them into the SQLite exercises table."""
    if not os.path.exists(EXERCISE_DIR):
        print(f"Warning: {EXERCISE_DIR} not found. Skipping seed.")
        return

    json_files = glob.glob(os.path.join(EXERCISE_DIR, "*.json"))
    
    for filepath in json_files:
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                
                ex_id = int(data.get("id"))
                name = data.get("name", "Unknown")
                muscle = data.get("muscle", "Other")
                body_part = data.get("body_part", "full")
                
                bw = data.get("body_weight", True)
                body_weight = 1 if bw else 0
                
                variants = data.get("variants", "")
                ex_type = data.get("type", "strength")
                equipment = data.get("equipment", "")
                link = data.get("link", "")
                
                act = data.get("active", True)
                active = 1 if act else 0
                
                alternate_name = data.get("alternate_name", "")
                intensity = data.get("intensity", 5)
                
                ab = data.get("ab_workout", False)
                ab_workout = 1 if ab else 0
                
                image = data.get("image", "")
                description = data.get("description", "")

                cursor.execute('''
                    INSERT OR IGNORE INTO exercises 
                    (id, name, muscle, body_part, body_weight, variants, type, 
                     equipment, link, active, alternate_name, intensity, ab_workout, image, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (ex_id, name, muscle, body_part, body_weight, variants, ex_type, 
                      equipment, link, active, alternate_name, intensity, ab_workout, image, description))
        except Exception as e:
            print(f"Error loading {filepath}: {e}")

# --- READ OPERATIONS ---

def get_all_exercises(workout_type="any"):
    """Fetches available exercises from DB."""
    conn = get_db()
    c = conn.cursor()
    
    query = "SELECT * FROM exercises WHERE active = 1"
    
    if workout_type == "core":
        query += " AND ab_workout = 1"
    elif workout_type == "cardio":
        query += " AND type = 'cardio'" 
        
    c.execute(query)
    rows = c.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_exercise_map():
    """Returns a dictionary {id: exercise_dict} for fast lookups."""
    exercises = get_all_exercises(workout_type="any")
    return {ex['id']: ex for ex in exercises}

def get_workouts_for_user(username):
    """Returns workouts with exercises joined from the master table."""
    conn = get_db()
    c = conn.cursor()
    
    c.execute('SELECT * FROM workouts WHERE username = ? ORDER BY timestamp DESC', (username,))
    workout_rows = c.fetchall()
    
    results = []
    
    for w_row in workout_rows:
        w_dict = dict(w_row)
        
        c.execute('''
            SELECT 
                we.exercise_id, 
                e.name, 
                e.muscle 
            FROM workout_exercises we
            LEFT JOIN exercises e ON we.exercise_id = e.id
            WHERE we.workout_id = ? 
            ORDER BY we.order_index ASC
        ''', (w_dict['id'],))
        
        ex_rows = c.fetchall()
        
        exercises = []
        for r in ex_rows:
            ex_data = {
                "id": r['exercise_id'],
                "name": r['name'] if r['name'] else f"Unknown ({r['exercise_id']})",
                "muscle": r['muscle']
            }
            exercises.append(ex_data)
        
        w_dict['exercises'] = exercises
        results.append(w_dict)
        
    conn.close()
    return results

def get_all_users():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT DISTINCT username FROM workouts")
    rows = c.fetchall()
    conn.close()
    return sorted([row['username'] for row in rows])

# --- WRITE OPERATIONS ---

def insert_workout(username, exercises, num_sets, ex_duration, rest_duration, set_rest, location="home", rpe=5, notes=""):
    conn = get_db()
    c = conn.cursor()
    
    timestamp = datetime.datetime.now().isoformat(timespec="seconds")
    
    c.execute('''
        INSERT INTO workouts 
        (username, timestamp, num_sets, exercise_duration, rest_duration, set_rest, location, rpe, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (username, timestamp, num_sets, ex_duration, rest_duration, set_rest, location, rpe, notes))
    
    workout_id = c.lastrowid
    
    for idx, ex in enumerate(exercises):
        c.execute('''
            INSERT INTO workout_exercises (workout_id, exercise_id, order_index)
            VALUES (?, ?, ?)
        ''', (workout_id, ex.get("id"), idx))
        
    conn.commit()
    conn.close()

# --- BACKUP OPERATIONS ---

def backup_db():
    """Backs up the database to data/backup with a timestamp."""
    backup_dir = os.path.join(DB_FOLDER, "backup")
    
    # Create backup folder if it doesn't exist
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"workout_app_{timestamp}.db"
    backup_path = os.path.join(backup_dir, backup_filename)
    
    if not os.path.exists(DB_PATH):
        # No DB to backup yet
        return

    try:
        # Use SQLite's native backup API for safety
        source = get_db()
        dest = sqlite3.connect(backup_path)
        source.backup(dest)
        dest.close()
        source.close()
        print(f"--- Database backed up to {backup_path} ---")
    except Exception as e:
        print(f"Error creating database backup: {e}")