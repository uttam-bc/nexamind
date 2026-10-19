import sqlite3

def migrate():
    conn = sqlite3.connect("backend/nexamind.db")
    c = conn.cursor()
    cols = [x[1] for x in c.execute("PRAGMA table_info(users)").fetchall()]
    if "username" not in cols:
        c.execute("ALTER TABLE users ADD COLUMN username VARCHAR(50);")
        print("Added username column")
    c.execute("UPDATE users SET username = LOWER(REPLACE(name, ' ', '_')) WHERE username IS NULL OR username = '';")
    conn.commit()
    ai_tables = [t[0] for t in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%';").fetchall()]
    print("AI tables:", ai_tables)
    users = c.execute("SELECT name, username, email FROM users;").fetchall()
    print("Users:", users)
    conn.close()

if __name__ == "__main__":
    migrate()
