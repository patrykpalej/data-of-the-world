import json
import os
import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
COUNTRIES_FILE = BASE_DIR / "countries.json"

_default_repo_db = BASE_DIR.parent / "src" / "data" / "dataoftheworld.db"
DB_FILE = _default_repo_db if _default_repo_db.parent.exists() else BASE_DIR / "dataoftheworld.db"


def load_json(filepath: Path) -> list[dict]:
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def get_valid_country_codes(countries: list[dict]) -> set[str]:
    return {c["country_code"] for c in countries}


def create_countries_table(conn: sqlite3.Connection, countries: list[dict]):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS countries (
            country_code TEXT PRIMARY KEY,
            country_name TEXT NOT NULL,
            flag TEXT,
            continent TEXT
        )
    """)
    conn.executemany(
        "INSERT OR REPLACE INTO countries (country_code, country_name, flag, continent) VALUES (?, ?, ?, ?)",
        [(c["country_code"], c["country_name"], c["flag"], c["continent"]) for c in countries]
    )


def create_index_table(conn: sqlite3.Connection, table_name: str, data: list[dict], valid_codes: set[str]):
    filtered_data = [(d["country_code"], d["year"], d["value"])
                     for d in data if d["country_code"] in valid_codes]

    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{table_name}" (
            country_code TEXT NOT NULL,
            year INTEGER NOT NULL,
            value REAL,
            PRIMARY KEY (country_code, year),
            FOREIGN KEY (country_code) REFERENCES countries(country_code)
        )
    """)
    conn.executemany(
        f'INSERT OR REPLACE INTO "{table_name}" (country_code, year, value) VALUES (?, ?, ?)',
        filtered_data
    )
    conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table_name}_year" ON "{table_name}"(year)')
    conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table_name}_country" ON "{table_name}"(country_code)')


def create_all_data_view(conn: sqlite3.Connection, index_tables: list[str]):
    if not index_tables:
        return

    base_table = index_tables[0]
    select_columns = ["b.country_code", "b.year"]
    joins = []

    for i, table in enumerate(index_tables):
        alias = f"t{i}"
        select_columns.append(f'"{alias}".value AS "{table}"')
        if i == 0:
            joins.append(f'"{table}" AS "{alias}"')
        else:
            joins.append(
                f'LEFT JOIN "{table}" AS "{alias}" ON b.country_code = "{alias}".country_code AND b.year = "{alias}".year'
            )

    base_query = f"""
        SELECT DISTINCT country_code, year FROM "{base_table}"
        {"UNION SELECT DISTINCT country_code, year FROM " + " UNION SELECT DISTINCT country_code, year FROM ".join(f'"{t}"' for t in index_tables[1:]) if len(index_tables) > 1 else ""}
    """

    view_sql = f"""
        CREATE VIEW IF NOT EXISTS all_data AS
        SELECT
            b.country_code,
            b.year,
            {", ".join(f'"{t}".value AS "{t}"' for t in index_tables)}
        FROM ({base_query}) AS b
        {" ".join(f'LEFT JOIN "{t}" ON b.country_code = "{t}".country_code AND b.year = "{t}".year' for t in index_tables)}
        ORDER BY b.country_code, b.year
    """

    conn.execute("DROP VIEW IF EXISTS all_data")
    conn.execute(view_sql)


def create_database():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    if DB_FILE.exists():
        DB_FILE.unlink()

    countries = load_json(COUNTRIES_FILE)
    valid_codes = get_valid_country_codes(countries)

    json_files = sorted(DATA_DIR.glob("*.json"))
    index_tables = []

    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA synchronous=NORMAL")

        create_countries_table(conn, countries)

        for json_file in json_files:
            table_name = json_file.stem
            data = load_json(json_file)
            create_index_table(conn, table_name, data, valid_codes)
            index_tables.append(table_name)
            print(f"Created table: {table_name}")

        create_all_data_view(conn, index_tables)
        print("Created view: all_data")

        conn.execute("ANALYZE")
        conn.commit()

    print(f"\nDatabase created: {DB_FILE}")


if __name__ == "__main__":
    create_database()
