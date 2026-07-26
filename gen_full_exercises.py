import glob, json
exercises = []
for f in glob.glob("exercises/*.json"):
    with open(f, 'r') as file:
        exercises.append(json.load(file))
with open("static/exercises.js", "w") as out:
    out.write("window.EXERCISES = ")
    json.dump(exercises, out, indent=2)
    out.write(";")